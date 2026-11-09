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

/** One model's speed test: `ms` is how long a real completion took, null when it failed. */
export type Speed = { ok: boolean; ms: number | null }
export type Speeds = Readonly<Record<string, Speed>>

// Why: each test is a real request to the provider; a cap keeps a free plan from being burnt on 400 models.
export const BENCH_MAX_MODELS = 12
export const BENCH_BATCH_SIZE = 4
export const RECOMMENDED_COUNT = 3

/** Answered, and fast enough that Orca would keep the suggestion. */
export function isFast(speed: Speed | undefined, limitMs: number): boolean {
  return Boolean(speed?.ok && speed.ms !== null && speed.ms <= limitMs)
}

function tier(speed: Speed | undefined, limitMs: number): number {
  if (isFast(speed, limitMs)) {
    return 0
  }
  if (speed?.ok) {
    return 1
  }
  return speed ? 2 : 3
}

/** Fastest first, then slow answers, then failures (so no result is hidden), then untested models. */
export function rankModels(models: readonly string[], speeds: Speeds, limitMs: number): string[] {
  const order = new Map(models.map((id, index) => [id, index]))
  return [...models].sort((a, b) => {
    const [sa, sb] = [speeds[a], speeds[b]]
    const byTier = tier(sa, limitMs) - tier(sb, limitMs)
    if (byTier !== 0) {
      return byTier
    }
    const byMs = (sa?.ms ?? 0) - (sb?.ms ?? 0)
    return byMs !== 0 ? byMs : (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

/** The model's id with what its test showed: `★ id · 0.4s` for the fastest, `id · ✕` for a failure. */
export function modelLabel(id: string, speed: Speed | undefined, recommended: boolean): string {
  if (!speed) {
    return id
  }
  if (!speed.ok || speed.ms === null) {
    return `${id} · ✕`
  }
  return `${recommended ? '★ ' : ''}${id} · ${(speed.ms / 1000).toFixed(1)}s`
}

/** The fastest models that answered in time: the ones to suggest. */
export function recommendedModels(models: readonly string[], speeds: Speeds, limitMs: number): string[] {
  return rankModels(models, speeds, limitMs)
    .filter((id) => isFast(speeds[id], limitMs))
    .slice(0, RECOMMENDED_COUNT)
}

// Why: names say a lot about speed; trying the likely-fast models first finds a good one in one round.
const LIKELY_FAST = /haiku|mini|flash|lite|nano|small|instant|turbo|codestral|devstral|coder|\b([1-9]|1[0-4])b\b/i
const LIKELY_SLOW = /opus|\bpro\b|thinking|reason|large|ultra|high|max|\b(70|120|405)b\b|\b(r1|o1|o3)\b/i

/**
 * The models to time next: untested ones, at most `limit`. The model in use goes first, so there is
 * always a number to compare against; then likely-fast names, each group in the provider's order.
 */
export function pickCandidates(
  models: readonly string[],
  speeds: Speeds,
  limit: number = BENCH_MAX_MODELS,
  current = ''
): string[] {
  const score = (id: string): number => {
    if (id === current) {
      return -1
    }
    return LIKELY_FAST.test(id) && !LIKELY_SLOW.test(id) ? 0 : 1
  }
  // Array.prototype.sort is stable, so each group keeps the provider's order.
  return models
    .filter((id) => !speeds[id])
    .sort((a, b) => score(a) - score(b))
    .slice(0, limit)
}
