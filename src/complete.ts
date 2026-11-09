// Pure request/response logic for both provider formats; src/main.ts wires it to Orca.

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
const ANTHROPIC_VERSION = '2023-06-01'

const SYSTEM_PROMPT =
  `You are a code completion engine. The user sends a file with ${CURSOR} marking the cursor. ` +
  'Reply with ONLY the text to insert at the cursor: no explanation, no markdown fences, ' +
  'and do not repeat code that is already before or after the cursor. Reply with nothing if unsure.'

export function buildUserPrompt(ctx: CompletionContext): string {
  const language = ctx.languageId ? ` (${ctx.languageId})` : ''
  const prefix = ctx.prefix.slice(-PREFIX_CHARS)
  const suffix = ctx.suffix.slice(0, SUFFIX_CHARS)
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
      max_tokens: provider.maxTokens,
      system: SYSTEM_PROMPT,
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
    max_tokens: provider.maxTokens,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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

/** Strips a markdown fence some models add despite the instructions. */
export function cleanSuggestion(raw: string): string {
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(raw)
  return fenced ? fenced[1] : raw
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
  const { url, init } = buildRequest(provider, ctx)
  const response = await fetchImpl(url, { ...init, signal })
  if (!response.ok) {
    // Why status only: the body can echo the prompt, which holds the person's code.
    throw new Error(`provider answered HTTP ${response.status}`)
  }
  return cleanSuggestion(extractText(provider.format, await response.json()))
}
