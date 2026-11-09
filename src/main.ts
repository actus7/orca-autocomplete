import type { Activate, OrcaWorkerApi } from 'orca/worker'
import { complete, type CompletionContext, type Provider, type ProviderFormat } from './complete.ts'
import { explainFailure } from './explain.ts'
import { pickLocale, translator, type Translate } from './i18n.ts'
import { BENCH_BATCH_SIZE, isExpectedAnswer, listModels, median } from './models.ts'
import { presetFor } from './presets.ts'

const SECRET_KEY = 'apiKey'
const LOCALE_KEY = 'locale'
// The address the saved key belongs to: a key is never used for any other provider.
const KEY_ADDRESS = 'keyAddress'
const STATUS_ITEM = 'status'
// Why: Orca drops a hook still running after 2 s; stop the request just before that.
const REQUEST_TIMEOUT_MS = 1800
const CACHE_SIZE = 50
const TEST_TIMEOUT_MS = 15_000
const MODELS_TIMEOUT_MS = 10_000
// Why: a model slower than the hook's limit is still worth showing, so the person sees how slow it is.
const BENCH_TIMEOUT_MS = 6000
const BENCH_MAX_TOKENS = 32
// The same small request for "Test connection" and for timing models, so the numbers compare.
const TEST_EVENT = {
  path: 'test.ts',
  languageId: 'typescript',
  prefix: 'function add(a: number, b: number) {\n  return ',
  suffix: '\n}'
}
const ERROR_TEXT_CHARS = 120
const LOG_REPEAT_MS = 60_000
// Real suggestion latencies per provider and model: enough samples for a median, few enough to stay small.
const USAGE_KEY = 'usage'
const USAGE_SAMPLES = 9
const USAGE_MODELS = 40

type Usage = Record<string, number[]>

function isUsage(value: unknown): value is Usage {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => Array.isArray(v) && v.every((n) => typeof n === 'number'))
  )
}

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

/** The saved key, but only for the provider it was saved for. */
async function savedKey(orca: OrcaWorkerApi, baseUrl: string): Promise<string> {
  const key = (await orca.secrets.get(SECRET_KEY)) ?? ''
  const pinned = await orca.storage.get(KEY_ADDRESS)
  const foreign = typeof pinned === 'string' && pinned !== '' && !sameAddress(pinned, baseUrl)
  return key && !foreign ? key : ''
}

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
      apiKey: await savedKey(orca, baseUrl),
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

function sameAddress(a: string, b: string): boolean {
  const normalize = (url: string): string => {
    try {
      return new URL(url.trim()).href.replace(/\/+$/, '').toLowerCase()
    } catch {
      return ''
    }
  }
  return normalize(a) !== '' && normalize(a) === normalize(b)
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
      hasKey: Boolean(await savedKey(orca, String((await orca.settings.get('baseUrl')) ?? '')))
    }
  }

  async function readUsage(): Promise<Usage> {
    const stored = await orca.storage.get(USAGE_KEY)
    return isUsage(stored) ? stored : {}
  }

  // ponytail: read-modify-write without a lock; two overlapping suggestions may drop one sample.
  async function recordUsage(baseUrl: string, model: string, ms: number): Promise<void> {
    const key = `${hostOf(baseUrl)}|${model}`
    const usage = await readUsage()
    const { [key]: previous = [], ...rest } = usage
    // Why: re-inserting puts this model last, so the oldest ones are the ones dropped.
    const next = { ...rest, [key]: [...previous, ms].slice(-USAGE_SAMPLES) }
    const keys = Object.keys(next)
    for (const old of keys.slice(0, Math.max(0, keys.length - USAGE_MODELS))) {
      delete next[old]
    }
    await orca.storage.set(USAGE_KEY, next)
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

  /**
   * The key to send when listing models. The typed key may go anywhere the person points it, but
   * the saved one only goes back to the provider it was saved for, and servers that need no key
   * never get one.
   */
  async function keyForListing(format: ProviderFormat, url: string, typed: string): Promise<string> {
    if (presetFor(format, url).keyKind === 'none') {
      return ''
    }
    if (typed) {
      return typed
    }
    const saved = await orca.settings.get()
    const savedFormat: ProviderFormat = saved.format === 'anthropic' ? 'anthropic' : 'openai'
    const sameProvider =
      savedFormat === format && sameAddress(String(saved.baseUrl ?? ''), url)
    return sameProvider ? await savedKey(orca, url) : ''
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

  /** One suggestion for the text around a cursor; '' when there is none. Shared by the native hook and the editor. */
  async function suggest(event: CompletionContext): Promise<string> {
    const config = await readConfig(orca)
    if (!config?.enabled || keyMissing(config)) {
      return ''
    }
    const key = `${event.path}\n${event.prefix.slice(-300)}\n${event.suffix.slice(0, 100)}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
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
      void recordUsage(config.provider.baseUrl, config.provider.model, stats.lastMs).catch(() => undefined)
      if (!suggestion) {
        void refreshStatus()
        return ''
      }
      stats.suggested += 1
      void refreshStatus()
      cache.set(key, suggestion)
      if (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string)
      }
      return suggestion
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        // Why: slowness is expected with some providers and is shown on the status item, not logged.
        stats.slow += 1
        stats.lastSlow = true
        // Why: a timeout is a real data point; leaving it out would make a slow model look fast.
        void recordUsage(config.provider.baseUrl, config.provider.model, REQUEST_TIMEOUT_MS).catch(() => undefined)
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
      return ''
    } finally {
      if (inflight === controller) {
        inflight = null
      }
    }
  }

  // Why: an Orca older than the hook rejects the declaration; the editor path then still works.
  try {
    orca.hooks.on('editor.inlineCompletion', async (event, next) => {
      const suggestion = await suggest(event)
      return suggestion ? next({ ...event, suggestion }) : undefined
    })
  } catch (error) {
    orca.log(`native inline completion hook unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  orca.panels.handle('completion.ask', async (context) => ({ suggestion: await suggest(context) }))

  orca.panels.handle('status.get', snapshot)

  orca.panels.handle('key.set', async ({ key }) => {
    const trimmed = key.trim()
    if (trimmed) {
      await orca.secrets.set(SECRET_KEY, trimmed)
      await orca.storage.set(KEY_ADDRESS, String((await orca.settings.get('baseUrl')) ?? ''))
    } else {
      await orca.secrets.delete(SECRET_KEY)
      await orca.storage.delete(KEY_ADDRESS)
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
    const asked: ProviderFormat = format === 'anthropic' ? 'anthropic' : 'openai'
    const apiKey = await keyForListing(asked, url, key.trim())
    try {
      const models = await listModels(
        { format: asked, baseUrl: url, apiKey },
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

  orca.panels.handle('models.usage', async ({ baseUrl }) => {
    const prefix = `${hostOf(baseUrl)}|`
    const usage: Record<string, { ms: number; uses: number }> = {}
    for (const [key, samples] of Object.entries(await readUsage())) {
      if (key.startsWith(prefix) && samples.length > 0) {
        usage[key.slice(prefix.length)] = { ms: median(samples), uses: samples.length }
      }
    }
    return { usage }
  })

  orca.panels.handle('models.bench', async ({ format, baseUrl, key, models }) => {
    const t = await translate()
    const url = baseUrl.trim()
    if (!/^https?:\/\//i.test(url) || !hostOf(url)) {
      return { results: [], message: t('test.needsSetup') }
    }
    const asked: ProviderFormat = format === 'anthropic' ? 'anthropic' : 'openai'
    const apiKey = await keyForListing(asked, url, key.trim())
    const ids = models
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .slice(0, BENCH_BATCH_SIZE)
    const results = await Promise.all(
      ids.map(async (model) => {
        const provider: Provider = { format: asked, baseUrl: url, model, apiKey, maxTokens: BENCH_MAX_TOKENS }
        const startedAt = Date.now()
        try {
          const suggestion = await complete(provider, TEST_EVENT, AbortSignal.timeout(BENCH_TIMEOUT_MS))
          // Why: the test has a known answer; a model that replies with prose or nothing is no use for code.
          return { model, ok: isExpectedAnswer(suggestion), ms: Date.now() - startedAt }
        } catch {
          return { model, ok: false, ms: null }
        }
      })
    )
    return { results, message: '' }
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

  // Why: a key saved before keys were pinned belongs to the provider configured now.
  async function pinExistingKey(): Promise<void> {
    if ((await orca.secrets.get(SECRET_KEY)) && (await orca.storage.get(KEY_ADDRESS)) === null) {
      await orca.storage.set(KEY_ADDRESS, String((await orca.settings.get('baseUrl')) ?? ''))
    }
  }

  orca.settings.onDidChange(() => void refreshStatus())
  orca.storage.onDidChange(() => void refreshStatus())
  void pinExistingKey().then(() => refreshStatus())
}

export default activate
