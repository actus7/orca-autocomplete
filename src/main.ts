import type { Activate, OrcaWorkerApi } from 'orca/worker'
import { complete, type Provider, type ProviderFormat } from './complete.ts'

const SECRET_KEY = 'apiKey'
const STATUS_ITEM = 'status'
// Why: Orca drops a hook still running after 2 s; stop the request just before that.
const REQUEST_TIMEOUT_MS = 1800
const CACHE_SIZE = 50
const TEST_TIMEOUT_MS = 15_000
const ERROR_TEXT_CHARS = 60
const LOG_REPEAT_MS = 60_000

type Config = { enabled: boolean; provider: Provider }
type Stats = {
  suggested: number
  errors: number
  slow: number
  lastMs: number | null
  lastError: string | null
  lastSlow: boolean
}
type State = 'on' | 'off' | 'setup' | 'error' | 'slow'

const TONES = { on: 'success', off: 'neutral', setup: 'warning', error: 'danger', slow: 'warning' } as const

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

function statusOf(config: Config | null, stats: Stats): { state: State; tooltip: string } {
  if (!config) {
    return {
      state: 'setup',
      tooltip:
        'Autocomplete needs setup: set the base URL and model in Settings, and the API key in the Autocomplete panel (right sidebar).'
    }
  }
  if (!config.enabled) {
    return { state: 'off', tooltip: 'Autocomplete is off. Click to turn it on.' }
  }
  const where = `${new URL(config.provider.baseUrl).host} · ${config.provider.model}`
  if (stats.lastError) {
    return {
      state: 'error',
      tooltip: `Autocomplete: last request failed (${stats.lastError}) · ${where} · click to turn off`
    }
  }
  if (stats.lastSlow) {
    return {
      state: 'slow',
      tooltip: `Autocomplete: the provider answered too slowly (over ${REQUEST_TIMEOUT_MS / 1000} s) · ${where} · ${stats.slow} slow · try a faster model`
    }
  }
  const last = stats.lastMs === null ? 'no request yet' : `last ${stats.lastMs} ms`
  return {
    state: 'on',
    tooltip: `Autocomplete on · ${where} · ${last} · ${stats.suggested} suggested · ${stats.errors} errors · click to turn off`
  }
}

const activate: Activate = (orca) => {
  // ponytail: insertion-ordered Map as LRU; swap for a real cache only if hit rate matters.
  const cache = new Map<string, string>()
  const stats: Stats = { suggested: 0, errors: 0, slow: 0, lastMs: null, lastError: null, lastSlow: false }
  let lastLog = { message: '', at: 0 }
  let inflight: AbortController | null = null

  // Why: a provider that is down would otherwise log on every typing pause.
  function logFailure(message: string): void {
    const now = Date.now()
    if (message === lastLog.message && now - lastLog.at < LOG_REPEAT_MS) {
      return
    }
    lastLog = { message, at: now }
    orca.log(`completion failed: ${message}`)
  }

  async function refreshStatus(): Promise<void> {
    const { state, tooltip } = statusOf(await readConfig(orca), stats)
    const text = state === 'on' && stats.lastMs !== null ? `${(stats.lastMs / 1000).toFixed(1)}s` : state
    try {
      await orca.host.call('statusBar.update', { id: STATUS_ITEM, tone: TONES[state], text, tooltip })
    } catch (error) {
      // Why: an Orca without status bar support must not break completion.
      orca.log(`status bar update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function runTest(): Promise<{ ok: boolean; message: string }> {
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
  }

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
    const startedAt = Date.now()
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const suggestion = await complete(config.provider, event, signal)
      stats.lastMs = Date.now() - startedAt
      stats.lastError = null
      stats.lastSlow = false
      if (!suggestion) {
        void refreshStatus()
        return
      }
      stats.suggested += 1
      void refreshStatus()
      cache.set(key, suggestion)
      if (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string)
      }
      return next({ ...event, suggestion })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        // Why: slowness is expected with some providers and is shown on the status item, not logged.
        stats.slow += 1
        stats.lastSlow = true
        void refreshStatus()
      } else if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        logFailure(message)
        stats.errors += 1
        stats.lastError = message.slice(0, ERROR_TEXT_CHARS)
        stats.lastSlow = false
        void refreshStatus()
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
    stats.lastError = null
    stats.lastSlow = false
    void refreshStatus()
    return { hasKey: Boolean(trimmed) }
  })

  orca.panels.handle('provider.test', runTest)

  orca.commands.register('toggle', async () => {
    const enabled = (await orca.settings.get('enabled')) !== false
    await orca.settings.set('enabled', !enabled)
    stats.lastError = null
    stats.lastSlow = false
    await refreshStatus()
    return `Autocomplete ${enabled ? 'off' : 'on'}`
  })

  orca.commands.register('test', async () => {
    const { ok, message } = await runTest()
    stats.lastError = ok ? null : message.slice(0, ERROR_TEXT_CHARS)
    await refreshStatus()
    return `Autocomplete test ${ok ? 'passed' : 'failed'}: ${message}`
  })

  orca.settings.onDidChange(() => void refreshStatus())
  void refreshStatus()
}

export default activate
