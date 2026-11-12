import type { OrcaEditorSettings, PluginEvents } from 'orca'
import type { Activate, OrcaWorkerApi } from 'orca/worker'
import { complete, parseFormat, type CompletionContext, type Provider, type ProviderFormat } from './complete.ts'
import { asPredictInput, predictEdit } from './nextedit.ts'
import { errorMessage, explainFailure, hostOf, isLoopbackHost } from './explain.ts'
import { pickLocale, translator, type Translate } from './i18n.ts'
import { LspManager } from './lsp/manager.ts'
import { BENCH_BATCH_SIZE, isExpectedAnswer, listModels, median } from './models.ts'
import { presetFor, sameAddress } from './presets.ts'
import { REQUEST_TIMEOUT_MS, STATE_TONES, type State } from './status.ts'
import { bump, emptyStats, EVENT_KINDS, isStats, summarize, withLatency, type Stats as Metrics } from './metrics.ts'

const SECRET_KEY = 'apiKey'
const LOCALE_KEY = 'locale'
// The address the saved key belongs to: a key is never used for any other provider.
const KEY_ADDRESS = 'keyAddress'
const STATUS_ITEM = 'status'
const CACHE_SIZE = 50
// The next edit is not typed over, so it can take a little longer than a suggestion; but it costs a request
// each time, so asks are spaced out.
const NEXT_EDIT_TIMEOUT_MS = 4000
const NEXT_EDIT_MIN_GAP_MS = 1500
const TEST_TIMEOUT_MS = 15_000
const MODELS_TIMEOUT_MS = 10_000
// Why: a model slower than REQUEST_TIMEOUT_MS is still worth showing, so the person sees how slow it is.
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
// How suggestions did in real use (shown, accepted, kept ...), kept on this computer only.
const STATS_KEY = 'stats'
// A suggestion is judged for about half a minute after it is shown; its id is only needed that long.
const SUGGESTION_IDS_KEPT = 200

type Usage = Record<string, number[]>

function isUsage(value: unknown): value is Usage {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => Array.isArray(v) && v.every((n) => typeof n === 'number'))
  )
}

/** Where usage and statistics of a model are kept: the provider's host and the model. */
const modelKey = (baseUrl: string, model: string): string => `${hostOf(baseUrl)}|${model}`

type Suggestion = { text: string; model: string }
const NO_SUGGESTION: Suggestion = { text: '', model: '' }

type Config = { enabled: boolean; provider: Provider }
type Stats = {
  suggested: number
  lastMs: number | null
  lastError: string | null
  lastSlow: boolean
}
/** The saved key, but only for the provider it was saved for. */
async function savedKey(orca: OrcaWorkerApi, baseUrl: string): Promise<string> {
  const [key, pinned] = await Promise.all([orca.secrets.get(SECRET_KEY).then((value) => value ?? ''), orca.storage.get(KEY_ADDRESS)])
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
  const format = parseFormat(settings.format)
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

function keyMissing(config: Config): boolean {
  return presetFor(config.provider.format, config.provider.baseUrl).keyKind === 'required' && !config.provider.apiKey
}

/** Whether any code leaves the computer, and if so where: what the person most wants to know about a provider. */
function destinationOf(config: Config | null): 'none' | 'local' | 'remote' {
  if (!config || !config.enabled || keyMissing(config)) {
    return 'none'
  }
  return isLoopbackHost(hostOf(config.provider.baseUrl)) ? 'local' : 'remote'
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
  const where = config ? `${hostOf(config.provider.baseUrl)} · ${config.provider.model}` : ''
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

// The language servers belong to the running worker; deactivate stops them with it.
let lspManager: LspManager | null = null

export function deactivate(): void {
  lspManager?.dispose()
  lspManager = null
}

type Typography = PluginEvents['editor.typography.changed']

/** Orca's answer as the editor takes it: the full CSS font stack, as Orca's own editor renders it. */
export function fromTypography(typography: Typography): OrcaEditorSettings {
  return {
    fontFamily: typography.cssFontFamily,
    fontSize: typography.fontSize,
    fontWeight: typography.fontWeight,
    lineHeight: typography.lineHeight,
    fontLigatures: typography.fontLigatures,
    wordWrap: typography.wordWrap === 'on',
    minimap: typography.minimap
  }
}

const WORKSPACE_ROOTS_CACHE_MS = 5000

/** Orca names this computer's own host `local` (older builds leave the host out). Remote hosts are out of reach. */
const isLocalHost = (hostId: string | null): boolean => hostId === null || hostId === 'local'

const activate: Activate = (orca) => {
  // ponytail: insertion-ordered Map as LRU; swap for a real cache only if hit rate matters.
  const cache = new Map<string, string>()
  const stats: Stats = { suggested: 0, lastMs: null, lastError: null, lastSlow: false }
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

  async function snapshot(known?: Config | null) {
    const config = known === undefined ? await readConfig(orca) : known
    const state = stateOf(config, stats)
    return {
      state,
      lastMs: stats.lastMs,
      suggested: stats.suggested,
      reason: stats.lastError,
      host: config ? hostOf(config.provider.baseUrl) : '',
      model: config?.provider.model ?? '',
      destination: destinationOf(config),
      // Why not just the config's key: with no model chosen yet there is no config, and a key may still be saved.
      hasKey: Boolean(config ? config.provider.apiKey : await savedKey(orca, String((await orca.settings.get('baseUrl')) ?? '')))
    }
  }

  async function readUsage(): Promise<Usage> {
    const stored = await orca.storage.get(USAGE_KEY)
    return isUsage(stored) ? stored : {}
  }

  // ponytail: read-modify-write without a lock; two overlapping suggestions may drop one sample.
  async function recordUsage(baseUrl: string, model: string, ms: number): Promise<void> {
    const key = modelKey(baseUrl, model)
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

  // Statistics: events arrive close together and each one is a read-modify-write, so they go one at a time.
  let statsQueue: Promise<void> = Promise.resolve()
  function updateStats(change: (metrics: Metrics) => Metrics): void {
    statsQueue = statsQueue
      .then(async () => {
        const stored = await orca.storage.get(STATS_KEY)
        await orca.storage.set(STATS_KEY, change(isStats(stored) ? stored : emptyStats(Date.now())))
      })
      .catch(() => undefined)
  }

  // Which model a suggestion on screen came from, so what the editor reports about it lands on that model.
  const suggestionModels = new Map<number, string>()
  let lastSuggestionId = 0
  function remember(model: string): number {
    lastSuggestionId += 1
    suggestionModels.set(lastSuggestionId, model)
    if (suggestionModels.size > SUGGESTION_IDS_KEPT) {
      suggestionModels.delete(suggestionModels.keys().next().value as number)
    }
    return lastSuggestionId
  }

  async function refreshStatus(): Promise<void> {
    const [config, t] = await Promise.all([readConfig(orca), translate()])
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
        tone: STATE_TONES[state],
        text,
        tooltip: tooltipOf(state, config, stats, t)
      })
    } catch (error) {
      // Why: an Orca without status bar support must not break completion.
      orca.log(`status bar update failed: ${errorMessage(error)}`)
    }
    orca.panels.post('status.changed', await snapshot(config))
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
    const savedFormat = parseFormat(saved.format)
    const sameProvider =
      savedFormat === format && sameAddress(String(saved.baseUrl ?? ''), url)
    return sameProvider ? await savedKey(orca, url) : ''
  }

  async function runTest(): Promise<{ ok: boolean; message: string; ms: number | null }> {
    const [config, t] = await Promise.all([readConfig(orca), translate()])
    if (!config) {
      return { ok: false, message: t('test.needsSetup'), ms: null }
    }
    if (keyMissing(config)) {
      return { ok: false, message: t('setup.withKey'), ms: null }
    }
    const startedAt = Date.now()
    try {
      await complete(config.provider, TEST_EVENT, AbortSignal.timeout(TEST_TIMEOUT_MS))
      return { ok: true, message: '', ms: Date.now() - startedAt }
    } catch (error) {
      const host = hostOf(config.provider.baseUrl)
      return { ok: false, message: explainFailure(error, t, host, TEST_TIMEOUT_MS, config.provider.format), ms: null }
    }
  }

  /** One suggestion for the text around a cursor; '' when there is none. */
  async function suggest(event: CompletionContext): Promise<Suggestion> {
    const config = await readConfig(orca)
    if (!config?.enabled || keyMissing(config)) {
      return NO_SUGGESTION
    }
    const model = modelKey(config.provider.baseUrl, config.provider.model)
    // Why the provider is in the key: after switching model, the old model's answers must not come back.
    const key = `${config.provider.baseUrl}|${config.provider.model}\n${event.path}\n${event.prefix.slice(-300)}\n${event.suffix.slice(0, 100)}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return { text: cached, model }
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
        return NO_SUGGESTION
      }
      stats.suggested += 1
      updateStats((metrics) => withLatency(metrics, model, stats.lastMs ?? 0))
      void refreshStatus()
      cache.set(key, suggestion)
      if (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string)
      }
      return { text: suggestion, model }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        // Why: slowness is expected with some providers and is shown on the status item, not logged.
        stats.lastSlow = true
        // Why: a timeout is a real data point; leaving it out would make a slow model look fast.
        void recordUsage(config.provider.baseUrl, config.provider.model, REQUEST_TIMEOUT_MS).catch(() => undefined)
        updateStats((metrics) => withLatency(metrics, model, REQUEST_TIMEOUT_MS))
        void refreshStatus()
      } else if (controller.signal.aborted) {
        // A newer keystroke asked again, so this answer was never going to be shown.
        updateStats((metrics) => bump(metrics, model, 'stale'))
      } else {
        logFailure(errorMessage(error))
        const host = hostOf(config.provider.baseUrl)
        stats.lastError = explainFailure(error, await translate(), host, REQUEST_TIMEOUT_MS, config.provider.format).slice(
          0,
          ERROR_TEXT_CHARS
        )
        stats.lastSlow = false
        void refreshStatus()
      }
      return NO_SUGGESTION
    } finally {
      if (inflight === controller) {
        inflight = null
      }
    }
  }

  // Workspace folders on this computer: a language server needs a project folder, and a remote one is out of reach.
  let roots: { at: number; paths: string[] } = { at: 0, paths: [] }
  async function workspaceRoots(): Promise<string[]> {
    if (Date.now() - roots.at < WORKSPACE_ROOTS_CACHE_MS) {
      return roots.paths
    }
    try {
      const { workspaces } = await orca.host.call('workspace.list', {})
      roots = { at: Date.now(), paths: workspaces.filter((w) => isLocalHost(w.hostId)).map((w) => w.path) }
    } catch (error) {
      orca.log(`workspace list unavailable: ${errorMessage(error)}`)
      roots = { at: Date.now(), paths: [] }
    }
    return roots.paths
  }

  lspManager = new LspManager({
    workspaceRoots,
    post: ((event: 'lsp.diagnostics' | 'lsp.status', payload: never) => orca.panels.post(event, payload)) as never,
    log: (message) => orca.log(message)
  })
  const lsp = lspManager

  orca.panels.handle('lsp.attach', async (input) => {
    if ((await orca.settings.get('languageServers')) === false) {
      return { status: { state: 'off' as const } }
    }
    return { status: await lsp.attach(input) }
  })
  orca.panels.handle('lsp.sync', async ({ docId, text }) => {
    lsp.sync(docId, text)
    return {}
  })
  orca.panels.handle('lsp.request', async ({ docId, method, params }) => {
    if (!lsp.has(docId)) {
      return { result: null, detached: true }
    }
    try {
      return { result: await lsp.request(docId, method, params) }
    } catch (error) {
      return { result: null, error: errorMessage(error) }
    }
  })
  orca.panels.handle('lsp.detach', async ({ docId }) => {
    lsp.detach(docId)
    return {}
  })

  // How Orca's own editor looks right now (font, size, wrap, minimap ...), as Orca itself reports it, so
  // the plugin's editor can match it and follow every change. null when it cannot be read: the plugin's
  // own settings apply then.
  let editorLook: OrcaEditorSettings | null = null
  // Why the event first: it can arrive while the first read is on its way, and it is the newer value.
  orca.events.on('editor.typography.changed', (typography) => {
    editorLook = fromTypography(typography)
    orca.panels.post('editor.settings.changed', { settings: editorLook })
  })
  const firstLook = orca.host
    .call('editor.readTypography', {})
    .then((typography) => {
      editorLook ??= fromTypography(typography)
    })
    .catch(() => undefined)
  orca.panels.handle('editor.settings', async () => {
    await firstLook
    return { settings: editorLook }
  })

  orca.panels.handle('completion.ask', async (context) => {
    const { text, model } = await suggest(context)
    return { suggestion: text, id: text ? remember(model) : 0 }
  })

  // The next edit, asked of the model only when the person turned it on and the provider is a chat one. It
  // sits apart from suggestions: it never touches their statistics, latency or status, and a failure is silent.
  let nextEditAbort: AbortController | null = null
  let nextEditAskedAt = 0
  orca.panels.handle('edits.predict', async (raw) => {
    const none = { edit: null }
    const input = asPredictInput(raw)
    if (!input || (await orca.settings.get('nextEdit')) !== true || Date.now() - nextEditAskedAt < NEXT_EDIT_MIN_GAP_MS) {
      return none
    }
    const config = await readConfig(orca)
    // Why no format check here: predictEdit answers nothing for a provider that only fills in the middle.
    if (!config?.enabled || keyMissing(config)) {
      return none
    }
    nextEditAskedAt = Date.now()
    nextEditAbort?.abort()
    const controller = new AbortController()
    nextEditAbort = controller
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(NEXT_EDIT_TIMEOUT_MS)])
      return { edit: await predictEdit(config.provider, input, signal) }
    } catch (error) {
      // A newer ask or a slow answer is expected; anything else is worth a line in the log.
      if (!controller.signal.aborted && !(error instanceof Error && error.name === 'TimeoutError')) {
        logFailure(`next edit failed: ${errorMessage(error)}`)
      }
      return none
    } finally {
      if (nextEditAbort === controller) {
        nextEditAbort = null
      }
    }
  })

  orca.panels.handle('metrics.event', async ({ id, kind }) => {
    const model = suggestionModels.get(id)
    // Why check: the message comes from a page, so an unknown id or kind is ignored rather than trusted.
    if (model && EVENT_KINDS.includes(kind)) {
      updateStats((metrics) => bump(metrics, model, kind))
    }
    return {}
  })

  orca.panels.handle('stats.get', async () => {
    const config = await readConfig(orca)
    const model = config ? modelKey(config.provider.baseUrl, config.provider.model) : ''
    await statsQueue
    const stored = await orca.storage.get(STATS_KEY)
    const metrics = isStats(stored) ? stored : emptyStats(Date.now())
    return { model, since: metrics.since, summary: summarize(metrics, model) }
  })

  orca.panels.handle('stats.reset', async () => {
    statsQueue = statsQueue.then(() => orca.storage.delete(STATS_KEY)).catch(() => undefined)
    await statsQueue
    return {}
  })

  orca.panels.handle('status.get', () => snapshot())

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
    const asked = parseFormat(format)
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
        message: explainFailure(error, t, hostOf(url), MODELS_TIMEOUT_MS, asked)
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
    const asked = parseFormat(format)
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
  // Why the filter: usage and statistics are written on every suggestion, and none of it changes the status.
  orca.storage.onDidChange(({ key }) => {
    if (key !== USAGE_KEY && key !== STATS_KEY) {
      void refreshStatus()
    }
  })
  void pinExistingKey().then(() => refreshStatus())
}

export default activate
