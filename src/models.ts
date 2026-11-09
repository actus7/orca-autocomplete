// Lists the models a provider offers, so people can pick one instead of typing its name.
import { ANTHROPIC_VERSION, ProviderHttpError, type Provider } from './complete.ts'

type ListTarget = Pick<Provider, 'format' | 'baseUrl' | 'apiKey'>

// Why: providers list embedding, speech and image models too; none of them can complete code.
const NOT_FOR_CODE = /embed|tts|whisper|asr|transcribe|speech|moderation|dall-e|image|rerank|guard/i
export const MODEL_LIST_MAX_SHOWN = 100

export function buildModelsRequest(target: ListTarget): {
  url: string
  init: { method: 'GET'; headers: Record<string, string> }
} {
  const base = target.baseUrl.trim().replace(/\/+$/, '')
  if (target.format === 'anthropic') {
    const root = base.endsWith('/v1') ? base : `${base}/v1`
    const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION }
    if (target.apiKey) {
      headers['x-api-key'] = target.apiKey
    }
    // Why: Anthropic returns 20 models unless asked for more.
    return { url: `${root}/models?limit=1000`, init: { method: 'GET', headers } }
  }
  const headers: Record<string, string> = {}
  if (target.apiKey) {
    headers.authorization = `Bearer ${target.apiKey}`
  }
  return { url: `${base}/models`, init: { method: 'GET', headers } }
}

/** Model ids from a `{ data: [{ id }] }` answer, without non-code models, sorted and unique. */
export function extractModelIds(json: unknown): string[] {
  const data = typeof json === 'object' && json !== null ? (json as { data?: unknown }).data : null
  if (!Array.isArray(data)) {
    return []
  }
  const ids = data
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && !NOT_FOR_CODE.test(id))
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

export type GetFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function listModels(
  target: ListTarget,
  signal: AbortSignal,
  fetchImpl: GetFetch = fetch
): Promise<string[]> {
  const { url, init } = buildModelsRequest(target)
  const response = await fetchImpl(url, { ...init, signal })
  if (!response.ok) {
    throw new ProviderHttpError(response.status)
  }
  return extractModelIds(await response.json())
}

/** The models that match what is typed: all of them when it is empty or already a model's id. */
export function filterModels(all: readonly string[], typed: string): string[] {
  const query = typed.trim().toLowerCase()
  const exact = all.some((id) => id.toLowerCase() === query)
  return !query || exact ? [...all] : all.filter((id) => id.toLowerCase().includes(query))
}
