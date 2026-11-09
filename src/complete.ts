// Pure request/response logic for every provider format; src/main.ts wires it to Orca.
import { findSecretAround } from './neversend.ts'

/**
 * How a provider is asked:
 * - `openai`: a chat model (`/chat/completions`), told to answer with only the code to insert;
 * - `anthropic`: the same through `/v1/messages`;
 * - `ollama`: Ollama's `/api/generate` with a prompt and a suffix, so the model fills in the middle itself;
 * - `mistral-fim`: Mistral's `/v1/fim/completions` (Codestral), the same idea.
 */
export type ProviderFormat = 'openai' | 'anthropic' | 'ollama' | 'mistral-fim'
const FORMATS: readonly ProviderFormat[] = ['openai', 'anthropic', 'ollama', 'mistral-fim']

/** A stored or typed value as a format; anything unknown is the chat format. */
export function parseFormat(value: unknown): ProviderFormat {
  return FORMATS.find((format) => format === value) ?? 'openai'
}

export type Provider = {
  format: ProviderFormat
  /** The root of the API: for `openai` the one that holds `/chat/completions` (usually ending in `/v1`). */
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
  /** Declarations from other files the code near the cursor uses, one per line, to help the model write calls that fit. */
  related?: string
}

// Why a cap: this is a hint, and every character of it is sent to the provider and waited for.
const RELATED_MAX_CHARS = 2500

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
  const related = ctx.related
    ? `Declarations from other files the code below uses, for reference only (never repeat them):\n${ctx.related.slice(0, RELATED_MAX_CHARS)}\n\n`
    : ''
  return `${related}File: ${ctx.path}${language}\n\n${prefix}${CURSOR}${suffix}`
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

type Built = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }

/** `https://host` and `https://host/v1` both name the same API root; this gives the one that ends in `/v1`. */
export function withV1(base: string): string {
  const root = base.replace(/\/+$/, '')
  return root.endsWith('/v1') ? root : `${root}/v1`
}

/** Ollama serves its own API beside the `/v1` one, so the person may have given either address. */
function withoutV1(base: string): string {
  return base.replace(/\/+$/, '').replace(/\/v1$/, '')
}

const post = (url: string, headers: Record<string, string>, body: object): Built => ({
  url,
  init: { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }
})
const bearer = (apiKey: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {})

// Why a low temperature for the fill-in-the-middle formats: they continue code, and a steady answer is the useful one.
// The chat formats send none: current Claude and OpenAI reasoning models reject it with HTTP 400.
const FIM_TEMPERATURE = 0.2

export function buildRequest(provider: Provider, ctx: CompletionContext): Built {
  const maxTokens = isProse(ctx.languageId) ? Math.min(provider.maxTokens, PROSE_MAX_TOKENS) : provider.maxTokens
  const { prefix, suffix } = windowOf(ctx)
  switch (provider.format) {
    case 'anthropic':
      return post(
        joinUrl(withV1(provider.baseUrl), '/messages'),
        { 'anthropic-version': ANTHROPIC_VERSION, ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}) },
        {
          model: provider.model,
          max_tokens: maxTokens,
          system: isProse(ctx.languageId) ? PROSE_SYSTEM_PROMPT : SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(ctx) }]
        }
      )
    case 'ollama':
      // Why `stream: false`: Ollama streams by default, and one JSON answer is what is read here.
      return post(joinUrl(withoutV1(provider.baseUrl), '/api/generate'), bearer(provider.apiKey), {
        model: provider.model,
        prompt: prefix,
        suffix,
        stream: false,
        options: { num_predict: maxTokens, temperature: FIM_TEMPERATURE }
      })
    case 'mistral-fim':
      return post(joinUrl(withV1(provider.baseUrl), '/fim/completions'), bearer(provider.apiKey), {
        model: provider.model,
        prompt: prefix,
        suffix,
        max_tokens: maxTokens,
        temperature: FIM_TEMPERATURE,
        stream: false
      })
    default:
      return post(joinUrl(provider.baseUrl, '/chat/completions'), bearer(provider.apiKey), {
        model: provider.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: isProse(ctx.languageId) ? PROSE_SYSTEM_PROMPT : SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(ctx) }
        ]
      })
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
  if (format === 'ollama') {
    return typeof json.response === 'string' ? json.response : ''
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

// Some gateways add instructions of their own to every request, and a model that follows them answers with tool-call
// markup instead of code. That is never code, and shown as a suggestion it would be gray text in the person's file.
const TOOL_MARKUP = /<tool_call>|<function=|<parameter=|<\/(?:tool_call|function|parameter)>/

/** Whether an answer is tool-call markup that a gateway's instructions drew out of the model, not code. */
export function looksInjected(answer: string): boolean {
  return TOOL_MARKUP.test(answer)
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
  const before = ctx.prefix.slice(-(PREFIX_CHARS + SECRET_MARGIN_CHARS))
  const after = ctx.suffix.slice(0, SUFFIX_CHARS + SECRET_MARGIN_CHARS)
  // The related declarations are sent too, so they are checked like the rest.
  if (findSecretAround(before, after, `${ctx.path}\n${ctx.related ?? ''}`)) {
    return ''
  }
  const { url, init } = buildRequest(provider, ctx)
  const response = await fetchImpl(url, { ...init, signal })
  if (!response.ok) {
    // Why status only: the body can echo the prompt, which holds the person's code.
    throw new ProviderHttpError(response.status)
  }
  const raw = extractText(provider.format, await response.json())
  if (looksInjected(raw)) {
    return ''
  }
  // Why not for prose: a fenced block is a legitimate thing to write in a document, not wrapping to strip.
  const cleaned = isProse(ctx.languageId) ? raw : cleanSuggestion(raw)
  return trimSuffixOverlap(trimPrefixEcho(cleaned, ctx.prefix), ctx.suffix)
}
