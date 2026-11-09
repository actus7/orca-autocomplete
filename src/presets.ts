// Known providers, so people pick a name instead of typing URLs.
import type { ProviderFormat } from './complete.ts'

export type PresetId =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'custom-openai'
  | 'custom-anthropic'

export type Preset = {
  id: PresetId
  format: ProviderFormat
  /** Null for the custom presets: the person types it. */
  baseUrl: string | null
  /** A starting point, shown as the model when the provider is picked. */
  model: string
  keyKind: 'required' | 'optional' | 'none'
  /**
   * Whether timing models is worth offering: not for providers with an obvious small-model choice,
   * everything for a short local list, a handful of search results for long aggregator lists.
   */
  bench: 'off' | 'all' | 'some'
}

export const PRESETS: readonly Preset[] = [
  { id: 'openai', format: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyKind: 'required', bench: 'off' },
  { id: 'anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', keyKind: 'required', bench: 'off' },
  { id: 'openrouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'mistralai/codestral-2508', keyKind: 'required', bench: 'some' },
  { id: 'ollama', format: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:1.5b', keyKind: 'none', bench: 'all' },
  { id: 'custom-openai', format: 'openai', baseUrl: null, model: '', keyKind: 'optional', bench: 'some' },
  { id: 'custom-anthropic', format: 'anthropic', baseUrl: null, model: '', keyKind: 'optional', bench: 'some' }
]

/** Whether two base URLs are the same address, whatever the case, the trailing slash or the spelling of the host. */
export function sameAddress(a: string, b: string): boolean {
  const normalize = (url: string): string => {
    try {
      return new URL(url.trim()).href.replace(/\/+$/, '').toLowerCase()
    } catch {
      return ''
    }
  }
  return normalize(a) !== '' && normalize(a) === normalize(b)
}

/** The preset a saved format and base URL correspond to; a custom one when none matches. */
export function presetFor(format: ProviderFormat, baseUrl: string): Preset {
  const known = PRESETS.find((p) => p.baseUrl !== null && p.format === format && sameAddress(baseUrl, p.baseUrl))
  const fallback = PRESETS.find((p) => p.id === `custom-${format}`)
  return known ?? fallback ?? PRESETS[0]
}

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
