// Counters for how the suggestions do in real use, kept on this computer only: nothing here is sent
// anywhere. Pure functions over a plain object, so the worker can store it as JSON and tests can read it.

/**
 * What the editor can tell the worker about a suggestion it showed:
 * `shown` it appeared, `accepted` the whole of it was taken, `partial` a word or line of it was taken,
 * `kept` the accepted text was still there half a minute later, `undone` it was removed within seconds,
 * `stale` it arrived after the text or cursor had already moved on.
 */
export const EVENT_KINDS = ['shown', 'accepted', 'partial', 'kept', 'undone', 'stale'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export type ModelStats = {
  shown: number
  accepted: number
  partial: number
  kept: number
  undone: number
  stale: number
  /** How long answers took, in ms, newest last; a timeout counts as the time it waited. */
  latency: number[]
}
export type Stats = { since: number; models: Record<string, ModelStats> }

export type Summary = Omit<ModelStats, 'latency'> & { p50: number | null; p95: number | null; samples: number }

// Enough samples for a p95 to mean something, few enough to stay small in storage.
const LATENCY_SAMPLES = 50
const MODELS_KEPT = 40

const emptyModel = (): ModelStats => ({ shown: 0, accepted: 0, partial: 0, kept: 0, undone: 0, stale: 0, latency: [] })

export function emptyStats(now: number): Stats {
  return { since: now, models: {} }
}

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function isStats(value: unknown): value is Stats {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { since, models } = value as Partial<Stats>
  if (!isCount(since) || typeof models !== 'object' || models === null) {
    return false
  }
  return Object.values(models).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      EVENT_KINDS.every((kind) => isCount((entry as Record<string, unknown>)[kind])) &&
      Array.isArray(entry.latency) &&
      entry.latency.every(isCount)
  )
}

/** The model's entry changed by `change`, moved last so the oldest models are the ones dropped. */
function updated(stats: Stats, key: string, change: (entry: ModelStats) => ModelStats): Stats {
  const { [key]: previous = emptyModel(), ...rest } = stats.models
  const next = { ...rest, [key]: change(previous) }
  const keys = Object.keys(next)
  for (const old of keys.slice(0, Math.max(0, keys.length - MODELS_KEPT))) {
    delete next[old]
  }
  return { ...stats, models: next }
}

export function bump(stats: Stats, key: string, kind: EventKind): Stats {
  return updated(stats, key, (entry) => ({ ...entry, [kind]: entry[kind] + 1 }))
}

export function withLatency(stats: Stats, key: string, ms: number): Stats {
  return updated(stats, key, (entry) => ({ ...entry, latency: [...entry.latency, Math.round(ms)].slice(-LATENCY_SAMPLES) }))
}

/** Nearest-rank percentile (`p` from 0 to 100); null when there are no samples. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) {
    return null
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]
}

export function summarize(stats: Stats, key: string): Summary {
  const { latency, ...counts } = stats.models[key] ?? emptyModel()
  return { ...counts, p50: percentile(latency, 50), p95: percentile(latency, 95), samples: latency.length }
}
