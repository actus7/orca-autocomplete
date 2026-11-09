// Predicting the next edit with a model. The person changed something; the model is shown the lines around
// it and says, if the same kind of change is wanted on another line, which line and what it becomes.
//
// A model can invent a line, so the answer is never trusted: it must repeat the line it means word for
// word, and only then is it an edit. Pure request/response logic; src/main.ts wires it to Orca.
import { buildChatRequest, extractText, isChatFormat, looksInjected, ProviderHttpError, type FetchLike, type Provider } from './complete.ts'
import { findSecretAround } from './neversend.ts'

export interface PredictInput {
  path: string
  languageId: string
  /** The line number (1-based) of the first line of `text`. */
  startLine: number
  /** The lines around where the person is editing. */
  text: string
  /** The lines the person just changed, so the model does not have to guess what they did. */
  recent: { line: number; before: string; after: string }[]
}

/** Replace the whole text of `line`, which is `old`, with `new`. */
export interface PredictedEdit {
  line: number
  old: string
  new: string
}

// Why caps: everything here is sent to the provider and waited for, and the page is not trusted with the size.
const TEXT_MAX_CHARS = 6000
const RECENT_MAX = 3
const RECENT_LINE_MAX_CHARS = 300
const NEW_LINE_MAX_CHARS = 500
const MAX_TOKENS = 200

/** The request as the page sent it, or null when it is not the shape it promises: a page is not trusted with types or sizes. */
export function asPredictInput(value: unknown): PredictInput | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { path, languageId, startLine, text, recent } = value as Record<string, unknown>
  if (typeof path !== 'string' || typeof languageId !== 'string' || typeof text !== 'string' || !Array.isArray(recent)) {
    return null
  }
  if (!Number.isInteger(startLine) || (startLine as number) < 1) {
    return null
  }
  const changes: PredictInput['recent'] = []
  for (const change of recent.slice(0, RECENT_MAX)) {
    const { line, before, after } = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>
    if (!Number.isInteger(line) || typeof before !== 'string' || typeof after !== 'string') {
      return null
    }
    changes.push({ line: line as number, before: before.slice(0, RECENT_LINE_MAX_CHARS), after: after.slice(0, RECENT_LINE_MAX_CHARS) })
  }
  return { path, languageId, startLine: startLine as number, text: text.slice(0, TEXT_MAX_CHARS), recent: changes }
}

const SYSTEM_PROMPT =
  'You predict the next small edit in a code file. The user shows an excerpt with line numbers and the changes they just made. ' +
  'If the same change is clearly also needed on ANOTHER line of the excerpt that they have not changed (a rename carried over, ' +
  'the same fix, a call or a name that must match what they changed), answer with one JSON object: ' +
  '{"line": <line number>, "old": <that line exactly as shown, without the number>, "new": <that line after the change>}. ' +
  'Change only that one line and keep its indentation. If no such edit is clearly needed, answer {}. ' +
  'Answer with the JSON only: no explanation and no markdown fences.'

export function buildPredictPrompt(input: PredictInput): string {
  const lines = input.text
    .slice(0, TEXT_MAX_CHARS)
    .split('\n')
    .map((line, index) => `${input.startLine + index}| ${line}`)
    .join('\n')
  const recent = input.recent
    .slice(0, RECENT_MAX)
    .map((change) => `- line ${change.line}: \`${change.before.slice(0, RECENT_LINE_MAX_CHARS)}\` became \`${change.after.slice(0, RECENT_LINE_MAX_CHARS)}\``)
    .join('\n')
  return `File: ${input.path} (${input.languageId})\n\nWhat the person just changed:\n${recent}\n\nExcerpt:\n${lines}`
}

/** The JSON object in an answer that may be wrapped in a fence or in a sentence. */
function jsonIn(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

/** The edit an answer asks for, or null when it asks for nothing or for something that does not hold up. */
export function parsePrediction(raw: string, input: PredictInput): PredictedEdit | null {
  const answer = jsonIn(raw)
  if (typeof answer !== 'object' || answer === null) {
    return null
  }
  const { line, old, new: replacement } = answer as Record<string, unknown>
  if (!Number.isInteger(line) || typeof old !== 'string' || typeof replacement !== 'string') {
    return null
  }
  const lines = input.text.slice(0, TEXT_MAX_CHARS).split('\n')
  const at = (line as number) - input.startLine
  // The line must exist in what was sent, repeat word for word, and not be one the person already changed.
  if (at < 0 || at >= lines.length || lines[at].replace(/\r$/, '') !== old.replace(/\r$/, '')) {
    return null
  }
  if (input.recent.some((change) => change.line === line)) {
    return null
  }
  if (replacement === old || replacement.includes('\n') || replacement.length > NEW_LINE_MAX_CHARS) {
    return null
  }
  return { line: line as number, old, new: replacement }
}

/** Asks the provider for the next edit. Only chat formats can be asked this; the others answer nothing. */
export async function predictEdit(provider: Provider, input: PredictInput, signal: AbortSignal, fetchImpl: FetchLike = fetch): Promise<PredictedEdit | null> {
  if (!isChatFormat(provider.format) || input.recent.length === 0) {
    return null
  }
  // Why here: every request of this kind goes through this function. What is sent is the excerpt and the
  // changes, and a change can be a secret the person has just deleted, so both are checked.
  const sent = [input.text.slice(0, TEXT_MAX_CHARS), ...input.recent.slice(0, RECENT_MAX).flatMap((change) => [change.before, change.after])]
  if (findSecretAround(sent.join('\n'), '', input.path)) {
    return null
  }
  const { url, init } = buildChatRequest(provider, SYSTEM_PROMPT, buildPredictPrompt(input), MAX_TOKENS)
  const response = await fetchImpl(url, { ...init, signal })
  if (!response.ok) {
    throw new ProviderHttpError(response.status)
  }
  const raw = extractText(provider.format, await response.json())
  return looksInjected(raw) ? null : parsePrediction(raw, input)
}
