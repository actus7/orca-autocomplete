import type { Activate, OrcaWorkerApi } from 'orca/worker'
import { complete, type Provider, type ProviderFormat } from './complete.ts'

const SECRET_KEY = 'apiKey'
// Why: Orca drops a hook still running after 2 s; stop the request just before that.
const REQUEST_TIMEOUT_MS = 1800
const CACHE_SIZE = 50
const TEST_TIMEOUT_MS = 15_000

type Config = { enabled: boolean; provider: Provider }

async function readConfig(orca: OrcaWorkerApi): Promise<Config | null> {
  const settings = await orca.settings.get()
  const baseUrl = String(settings.baseUrl ?? '').trim()
  const model = String(settings.model ?? '').trim()
  if (!/^https?:\/\//i.test(baseUrl) || !model) {
    return null
  }
  const format: ProviderFormat = settings.format === 'anthropic' ? 'anthropic' : 'openai'
  return {
    enabled: settings.enabled !== false,
    provider: {
      format,
      baseUrl,
      model,
      apiKey: (await orca.secrets.get(SECRET_KEY)) ?? '',
      maxTokens: Math.max(1, Math.floor(Number(settings.maxTokens) || 96))
    }
  }
}

const activate: Activate = (orca) => {
  // ponytail: insertion-ordered Map as LRU; swap for a real cache only if hit rate matters.
  const cache = new Map<string, string>()
  let inflight: AbortController | null = null

  orca.hooks.on('editor.inlineCompletion', async (event, next) => {
    const config = await readConfig(orca)
    if (!config?.enabled) {
      return
    }
    const key = `${event.path}\n${event.prefix.slice(-300)}\n${event.suffix.slice(0, 100)}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return next({ ...event, suggestion: cached })
    }
    // Why: only the newest keystroke's answer is ever shown, so stop the older request.
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const suggestion = await complete(config.provider, event, signal)
      if (!suggestion) {
        return
      }
      cache.set(key, suggestion)
      if (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string)
      }
      return next({ ...event, suggestion })
    } catch (error) {
      if (!controller.signal.aborted) {
        orca.log(`completion failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    } finally {
      if (inflight === controller) {
        inflight = null
      }
    }
  })

  orca.panels.handle('key.status', async () => ({
    hasKey: Boolean(await orca.secrets.get(SECRET_KEY))
  }))

  orca.panels.handle('key.set', async ({ key }) => {
    const trimmed = key.trim()
    if (trimmed) {
      await orca.secrets.set(SECRET_KEY, trimmed)
    } else {
      await orca.secrets.delete(SECRET_KEY)
    }
    cache.clear()
    return { hasKey: Boolean(trimmed) }
  })

  orca.panels.handle('provider.test', async () => {
    const config = await readConfig(orca)
    if (!config) {
      return { ok: false, message: 'Set a base URL (http or https) and a model in Settings first.' }
    }
    try {
      const sample = await complete(
        config.provider,
        {
          path: 'test.ts',
          languageId: 'typescript',
          prefix: 'function add(a: number, b: number) {\n  return ',
          suffix: '\n}'
        },
        AbortSignal.timeout(TEST_TIMEOUT_MS)
      )
      return { ok: true, message: sample ? `Got: ${sample.slice(0, 80)}` : 'Connected, empty answer.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}

export default activate
