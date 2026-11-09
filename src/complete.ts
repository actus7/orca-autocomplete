// Pure request/response logic for both provider formats; src/main.ts wires it to Orca.
import { findSecret } from './neversend.ts'

export type ProviderFormat = 'openai' | 'anthropic'

export type Provider = {
  format: ProviderFormat
  /** For `openai`, the root that holds `/chat/completions` (usually ends in `/v1`). */
  baseUrl: string
  model: string
  /** Empty for local servers that need none. */
  apiKey: string
  maxTokens: number
}

export type CompletionContext = {
  path: string
  languageId?: string
  prefix: string
  suffix: string
}

const CURSOR = '<CURSOR>'
const PREFIX_CHARS = 6000
const SUFFIX_CHARS = 2000
export const ANTHROPIC_VERSION = '2023-06-01'

const SYSTEM_PROMPT =
  `You are a code completion engine. The user sends a file with ${CURSOR} marking the cursor. ` +
  'Reply with ONLY the text to insert at the cursor: usually the rest of the current line or ' +
  'statement, or a short block when the cursor sits in an empty body. Stop where the cursor\'s ' +
  'statement ends: never write code that belongs after it, and never repeat code that is already ' +
  'before or after the cursor. No explanation and no markdown fences. Reply with nothing if unsure.'

// Why a margin: a secret that starts just outside what is sent and reaches into it (a token cut in half,
// the body of a key whose first line is above) would go out in part if only the sent text were checked.
const SECRET_MARGIN_CHARS = 2000

/** The part of the file that is sent: the text just before the cursor and just after it, capped. */
function windowOf(ctx: CompletionContext): { prefix: string; suffix: string } {
  return { prefix: ctx.prefix.slice(-PREFIX_CHARS), suffix: ctx.suffix.slice(0, SUFFIX_CHARS) }
}

/** Writing, not code: the answer is plain words, so it is asked for and cleaned up differently. */
export function isProse(languageId: string | undefined): boolean {
  return languageId === 'markdown' || languageId === 'plaintext'
}

const PROSE_SYSTEM_PROMPT =
  `You continue a text someone is writing. The user sends a document with ${CURSOR} marking where they are writing. ` +
  'Reply with ONLY the words to insert at the cursor: usually the rest of the sentence, and at most one more short sentence. ' +
  'Write in the same language, tone and format (headings, lists, links) as the text around the cursor. ' +
  'Never repeat text that is already before or after the cursor, and never invent facts, names or numbers the document does not give. ' +
  'No explanation, no quotation marks around your answer, and no markdown fences unless the cursor is already inside one. Reply with nothing if unsure.'
// Why shorter: a sentence ahead is a help; a paragraph is a distraction in prose.
const PROSE_MAX_TOKENS = 48

export function buildUserPrompt(ctx: CompletionContext): string {
  const language = ctx.languageId ? ` (${ctx.languageId})` : ''
  const { prefix, suffix } = windowOf(ctx)
  return `File: ${ctx.path}${language}\n\n${prefix}${CURSOR}${suffix}`
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

// Why no temperature: current Claude and OpenAI reasoning models reject it with HTTP 400.
export function buildRequest(
  provider: Provider,
  ctx: CompletionContext
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const user = buildUserPrompt(ctx)
  const system = isProse(ctx.languageId) ? PROSE_SYSTEM_PROMPT : SYSTEM_PROMPT
  const maxTokens = isProse(ctx.languageId) ? Math.min(provider.maxTokens, PROSE_MAX_TOKENS) : provider.maxTokens
  if (provider.format === 'anthropic') {
    // Why: accept both `https://host` and `https://host/v1` as the base.
    const base = provider.baseUrl.replace(/\/+$/, '')
    const url = joinUrl(base, base.endsWith('/v1') ? '/messages' : '/v1/messages')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION
    }
    if (provider.apiKey) {
      headers['x-api-key'] = provider.apiKey
    }
    const body = {
      model: provider.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    }
    return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (provider.apiKey) {
    headers.authorization = `Bearer ${provider.apiKey}`
  }
  const body = {
    model: provider.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }
  return {
    url: joinUrl(provider.baseUrl, '/chat/completions'),
    init: { method: 'POST', headers, body: JSON.stringify(body) }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The model's text from a response body, or '' when the shape is not what the format promises. */
export function extractText(format: ProviderFormat, json: unknown): string {
  if (!isRecord(json)) {
    return ''
  }
  if (format === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : []
    return blocks
      .map((block) => (isRecord(block) && block.type === 'text' ? String(block.text ?? '') : ''))
      .join('')
  }
  const choices = Array.isArray(json.choices) ? json.choices : []
  const first = choices[0]
  const message = isRecord(first) && isRecord(first.message) ? first.message : null
  return typeof message?.content === 'string' ? message.content : ''
}

/** Keeps the first fenced block when a model wraps its answer, and drops chatter after it. */
export function cleanSuggestion(raw: string): string {
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```[\s\S]*$/.exec(raw)
  return fenced ? fenced[1] : raw
}

const ECHO_MAX_LINES = 5
const ECHO_MIN_CHARS = 3

/**
 * Chat models often start by repeating the code that is already before the cursor. Cuts that
 * repeat: the longest tail of the prefix (up to a few whole lines, ending at the cursor) the
 * suggestion begins with. A very short tail is left alone, since it may just be a coincidence.
 */
export function trimPrefixEcho(suggestion: string, prefix: string): string {
  const lines = prefix.split('\n')
  for (let count = Math.min(lines.length, ECHO_MAX_LINES); count >= 1; count -= 1) {
    const tail = lines.slice(-count).join('\n')
    if (tail.trim().length >= ECHO_MIN_CHARS && suggestion.startsWith(tail)) {
      return suggestion.slice(tail.length)
    }
  }
  return suggestion
}

const OVERLAP_PROBE_CHARS = 30
const OVERLAP_MIN_PROBE_CHARS = 8

/**
 * Chat models often re-emit code that already follows the cursor. Cuts that repeat: where the
 * suggestion contains the start of the suffix, or ends with whole lines the suffix begins with.
 * Same-line tails such as a closing paren are left alone, since they may be legitimate.
 */
export function trimSuffixOverlap(suggestion: string, suffix: string): string {
  const probe = suffix.trimStart().slice(0, OVERLAP_PROBE_CHARS)
  if (probe.length >= OVERLAP_MIN_PROBE_CHARS) {
    const at = suggestion.indexOf(probe)
    if (at > 0) {
      return suggestion.slice(0, at).trimEnd()
    }
  }
  for (let length = Math.min(suffix.length, suggestion.length); length >= 2; length -= 1) {
    const head = suffix.slice(0, length)
    if (head.startsWith('\n') && suggestion.endsWith(head)) {
      return suggestion.slice(0, suggestion.length - length)
    }
  }
  return suggestion
}

/** The provider answered, but not with success; carries the status so it can be explained. */
export class ProviderHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`provider answered HTTP ${status}`)
    this.name = 'ProviderHttpError'
    this.status = status
  }
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

export async function complete(
  provider: Provider,
  ctx: CompletionContext,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  // Why here: every request to a provider goes through this function.
  const around = `${ctx.prefix.slice(-(PREFIX_CHARS + SECRET_MARGIN_CHARS))}\n${ctx.suffix.slice(0, SUFFIX_CHARS + SECRET_MARGIN_CHARS)}`
  if (findSecret(around)) {
    return ''
  }
  const { url, init } = buildRequest(provider, ctx)
  const response = await fetchImpl(url, { ...init, signal })
  if (!response.ok) {
    // Why status only: the body can echo the prompt, which holds the person's code.
    throw new ProviderHttpError(response.status)
  }
  const raw = extractText(provider.format, await response.json())
  // Why not for prose: a fenced block is a legitimate thing to write in a document, not wrapping to strip.
  const cleaned = isProse(ctx.languageId) ? raw : cleanSuggestion(raw)
  return trimSuffixOverlap(trimPrefixEcho(cleaned, ctx.prefix), ctx.suffix)
}
