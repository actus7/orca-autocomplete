import type { Activate, OrcaWorkerApi } from 'orca/worker'
import { complete, type Provider, type ProviderFormat } from './complete.ts'
import { explainFailure } from './explain.ts'
import { pickLocale, translator, type Translate } from './i18n.ts'
import { listModels } from './models.ts'
import { presetFor } from './presets.ts'

const SECRET_KEY = 'apiKey'
const LOCALE_KEY = 'locale'
const STATUS_ITEM = 'status'
// Why: Orca drops a hook still running after 2 s; stop the request just before that.
const REQUEST_TIMEOUT_MS = 1800
const CACHE_SIZE = 50
const TEST_TIMEOUT_MS = 15_000
const MODELS_TIMEOUT_MS = 10_000
const ERROR_TEXT_CHARS = 120
const LOG_REPEAT_MS = 60_000

type Config = { enabled: boolean; provider: Provider }
type Stats = {
  suggested: number
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

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function keyMissing(config: Config): boolean {
  return presetFor(config.provider.format, config.provider.baseUrl).keyKind === 'required' && !config.provider.apiKey
}

function stateOf(config: Config | null, stats: Stats): State {
  if (!config) {
    return 'setup'
  }
  if (!config.enabled) {
    return 'off'
  }
  if (keyMissing(config)) {
    return 'setup'
  }
  if (stats.lastSlow) {
    return 'slow'
  }
  return stats.lastError ? 'error' : 'on'
}

function tooltipOf(state: State, config: Config | null, stats: Stats, t: Translate): string {
  const where = config ? `${new URL(config.provider.baseUrl).host} · ${config.provider.model}` : ''
  const seconds = REQUEST_TIMEOUT_MS / 1000
  switch (state) {
    case 'setup':
      return t('tip.setup')
    case 'off':
      return t('tip.off')
    case 'slow':
      return t('tip.slow', { seconds, where })
    case 'error':
      return t('tip.error', { reason: stats.lastError ?? '' })
    default:
      return stats.lastMs === null
        ? t('tip.onFresh', { where })
        : t('tip.on', { where, ms: stats.lastMs, count: stats.suggested })
  }
}

const activate: Activate = (orca) => {
  // ponytail: insertion-ordered Map as LRU; swap for a real cache only if hit rate matters.
  const cache = new Map<string, string>()
  const stats: Stats = { suggested: 0, slow: 0, lastMs: null, lastError: null, lastSlow: false }
  let lastLog = { message: '', at: 0 }
  let inflight: AbortController | null = null

  async function translate(): Promise<Translate> {
    // The panel stores Orca's UI language; before it ever opened, fall back to the OS language.
    const stored = await orca.storage.get(LOCALE_KEY)
    const tag = typeof stored === 'string' ? stored : Intl.DateTimeFormat().resolvedOptions().locale
    return translator(pickLocale(tag))
  }

  // Why: a provider that is down would otherwise log on every typing pause.
  function logFailure(message: string): void {
    const now = Date.now()
    if (message === lastLog.message && now - lastLog.at < LOG_REPEAT_MS) {
      return
    }
    lastLog = { message, at: now }
    orca.log(`completion failed: ${message}`)
  }

  async function snapshot() {
    const config = await readConfig(orca)
    const state = stateOf(config, stats)
    return {
      state,
      lastMs: stats.lastMs,
      suggested: stats.suggested,
      reason: stats.lastError,
      host: config ? new URL(config.provider.baseUrl).host : '',
      model: config?.provider.model ?? '',
      hasKey: Boolean(await orca.secrets.get(SECRET_KEY))
    }
  }

  async function refreshStatus(): Promise<void> {
    const [config, t] = [await readConfig(orca), await translate()]
    const state = stateOf(config, stats)
    const text =
      state === 'on' && stats.lastMs !== null
        ? `${(stats.lastMs / 1000).toFixed(1)}s`
        : state === 'on'
          ? t('state.on')
          : t(`bar.${state}` as 'bar.off')
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM,
        tone: TONES[state],
        text,
        tooltip: tooltipOf(state, config, stats, t)
      })
    } catch (error) {
      // Why: an Orca without status bar support must not break completion.
      orca.log(`status bar update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    orca.panels.post('status.changed', await snapshot())
  }

  async function runTest(): Promise<{ ok: boolean; message: string; ms: number | null }> {
    const [config, t] = [await readConfig(orca), await translate()]
    if (!config) {
      return { ok: false, message: t('test.needsSetup'), ms: null }
    }
    if (keyMissing(config)) {
      return { ok: false, message: t('setup.withKey'), ms: null }
    }
    const startedAt = Date.now()
    try {
      await complete(
        config.provider,
        {
          path: 'test.ts',
          languageId: 'typescript',
          prefix: 'function add(a: number, b: number) {\n  return ',
          suffix: '\n}'
        },
        AbortSignal.timeout(TEST_TIMEOUT_MS)
      )
      return { ok: true, message: '', ms: Date.now() - startedAt }
    } catch (error) {
      const host = new URL(config.provider.baseUrl).host
      return { ok: false, message: explainFailure(error, t, host, TEST_TIMEOUT_MS), ms: null }
    }
  }

  orca.hooks.on('editor.inlineCompletion', async (event, next) => {
    const config = await readConfig(orca)
    if (!config?.enabled || keyMissing(config)) {
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
        logFailure(error instanceof Error ? error.message : String(error))
        const host = new URL(config.provider.baseUrl).host
        stats.lastError = explainFailure(error, await translate(), host, REQUEST_TIMEOUT_MS).slice(
          0,
          ERROR_TEXT_CHARS
        )
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

  orca.panels.handle('status.get', snapshot)

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

  orca.panels.handle('provider.test', async () => {
    const result = await runTest()
    stats.lastError = result.ok ? null : result.message.slice(0, ERROR_TEXT_CHARS)
    stats.lastSlow = false
    void refreshStatus()
    return result
  })

  orca.panels.handle('models.list', async ({ format, baseUrl, key }) => {
    const t = await translate()
    const url = baseUrl.trim()
    if (!/^https?:\/\//i.test(url) || !hostOf(url)) {
      return { ok: false, models: [], message: t('test.needsSetup') }
    }
    // Why: the draft key lets people pick a model before saving; it is used once and not stored.
    const apiKey = key.trim() || (await orca.secrets.get(SECRET_KEY)) || ''
    try {
      const models = await listModels(
        { format: format === 'anthropic' ? 'anthropic' : 'openai', baseUrl: url, apiKey },
        AbortSignal.timeout(MODELS_TIMEOUT_MS)
      )
      return { ok: true, models, message: '' }
    } catch (error) {
      return {
        ok: false,
        models: [],
        message: explainFailure(error, t, hostOf(url), MODELS_TIMEOUT_MS)
      }
    }
  })

  orca.commands.register('toggle', async () => {
    const enabled = (await orca.settings.get('enabled')) !== false
    await orca.settings.set('enabled', !enabled)
    stats.lastError = null
    stats.lastSlow = false
    await refreshStatus()
    return (await translate())(enabled ? 'cmd.off' : 'cmd.on')
  })

  orca.commands.register('test', async () => {
    const [result, t] = [await runTest(), await translate()]
    stats.lastError = result.ok ? null : result.message.slice(0, ERROR_TEXT_CHARS)
    await refreshStatus()
    return result.ok
      ? t('cmd.testOk', { seconds: ((result.ms ?? 0) / 1000).toFixed(1) })
      : t('cmd.testFail', { reason: result.message })
  })

  orca.settings.onDidChange(() => void refreshStatus())
  orca.storage.onDidChange(() => void refreshStatus())
  void refreshStatus()
}

export default activate
