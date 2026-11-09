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
}

export const PRESETS: readonly Preset[] = [
  { id: 'openai', format: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyKind: 'required' },
  { id: 'anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', keyKind: 'required' },
  { id: 'openrouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'mistralai/codestral-2508', keyKind: 'required' },
  { id: 'ollama', format: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:1.5b', keyKind: 'none' },
  { id: 'custom-openai', format: 'openai', baseUrl: null, model: '', keyKind: 'optional' },
  { id: 'custom-anthropic', format: 'anthropic', baseUrl: null, model: '', keyKind: 'optional' }
]

function sameUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()
}

/** The preset a saved format and base URL correspond to; a custom one when none matches. */
export function presetFor(format: ProviderFormat, baseUrl: string): Preset {
  const known = PRESETS.find((p) => p.baseUrl !== null && p.format === format && sameUrl(baseUrl, p.baseUrl))
  const fallback = PRESETS.find((p) => p.id === `custom-${format}`)
  return known ?? fallback ?? PRESETS[0]
}

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
