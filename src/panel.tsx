import {
  atom,
  Badge,
  Button,
  Callout,
  Collapsible,
  env,
  Heading,
  Input,
  plugin,
  Progress,
  read,
  Row,
  Select,
  set,
  settings,
  Spinner,
  Stack,
  storage,
  Switch,
  Tab,
  Tabs,
  Text,
  type PanelContext,
  type StatsSnapshot,
  type StatusSnapshot
} from 'orca'
import { pickLocale, translator } from './i18n.ts'
import {
  BENCH_BATCH_SIZE,
  BENCH_MAX_MODELS,
  filterModels,
  MODEL_LIST_MAX_SHOWN,
  modelLabel,
  pickCandidates,
  rankModels,
  recommendedModels,
  SHORT_LIST_MAX,
  type Speeds
} from './models.ts'
import { PRESETS, presetById, presetFor, type PresetId } from './presets.ts'

const tr = translator(pickLocale(env.locale))
const SLOW_SECONDS = 1.8
const TONES = { on: 'success', off: 'neutral', setup: 'warning', error: 'danger', slow: 'warning' } as const

type Outcome = { ok: boolean; message: string; ms: number | null }

const status = atom<StatusSnapshot | null>(null)
const stats = atom<StatsSnapshot | null>(null)
const enabled = atom(true)
const presetId = atom<PresetId>('openai')
const baseUrl = atom('')
const model = atom('')
const draftKey = atom('')
const testing = atom(false)
const outcome = atom<Outcome | null>(null)
const providerOpen = atom<boolean | null>(null)
const models = atom<string[]>([])
const modelsPhase = atom<'idle' | 'loading' | 'done' | 'failed'>('idle')
const modelsMessage = atom('')
const modelMode = atom<'list' | 'type'>('list')
const modelSearch = atom('')
const speeds = atom<Speeds>({})
const usage = atom<Speeds>({})
const typeOpen = atom(false)
const bench = atom<{ done: number; total: number } | null>(null)
let modelsRun = 0
let benchRun = 0

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

async function loadSettings(): Promise<void> {
  const saved = await settings.get()
  const format = saved.format === 'anthropic' ? 'anthropic' : 'openai'
  const url = String(saved.baseUrl ?? '')
  set(enabled, saved.enabled !== false)
  set(presetId, presetFor(format, url).id)
  set(baseUrl, url)
  set(model, String(saved.model ?? ''))
}

/** Whether asking the provider for its models can work: an address, and a key when one is needed. */
function canLoadModels(hasKey: boolean): boolean {
  const kind = presetById(read(presetId)).keyKind
  return Boolean(hostOf(read(baseUrl))) && (kind !== 'required' || hasKey || read(draftKey).trim() !== '')
}

async function loadModels(): Promise<void> {
  const run = ++modelsRun
  set(modelsPhase, 'loading')
  set(modelsMessage, '')
  try {
    const result = await plugin.request('models.list', {
      format: presetById(read(presetId)).format,
      baseUrl: read(baseUrl),
      key: read(draftKey)
    })
    if (run === modelsRun) {
      set(models, result.models)
      set(modelsPhase, result.ok ? 'done' : 'failed')
      set(modelsMessage, result.message)
    }
  } catch (error) {
    if (run === modelsRun) {
      set(modelsPhase, 'failed')
      set(modelsMessage, error instanceof Error ? error.message : String(error))
    }
  }
}

function forgetModels(): void {
  modelsRun += 1
  benchRun += 1
  set(models, [])
  set(modelsPhase, 'idle')
  set(modelSearch, '')
  set(speeds, {})
  set(bench, null)
  set(typeOpen, false)
}

/** What each model gave in real use against this address: a median, so one slow request is not it. */
async function loadUsage(): Promise<void> {
  const answer = await plugin.request('models.usage', { baseUrl: read(baseUrl) })
  set(
    usage,
    Object.fromEntries(Object.entries(answer.usage).map(([id, u]) => [id, { ok: true, ms: u.ms, uses: u.uses }]))
  )
}

async function loadStats(): Promise<void> {
  set(stats, await plugin.request('stats.get', {}))
}

async function resetStats(): Promise<void> {
  await plugin.request('stats.reset', {})
  await loadStats()
}

/** Times the given models a few at a time, so results (and the order of the list) fill in as they arrive. */
async function benchModels(ids: string[]): Promise<void> {
  const run = ++benchRun
  const format = presetById(read(presetId)).format
  set(bench, { done: 0, total: ids.length })
  for (let start = 0; start < ids.length; start += BENCH_BATCH_SIZE) {
    const batch = ids.slice(start, start + BENCH_BATCH_SIZE)
    let results: { model: string; ok: boolean; ms: number | null }[]
    try {
      const answer = await plugin.request('models.bench', {
        format,
        baseUrl: read(baseUrl),
        key: read(draftKey),
        models: batch
      })
      results = answer.results
    } catch {
      // Why: a request that could not even be sent counts as a failed test for these models.
      results = batch.map((model) => ({ model, ok: false, ms: null }))
    }
    if (run !== benchRun) {
      return
    }
    const found = Object.fromEntries(results.map((r) => [r.model, { ok: r.ok, ms: r.ms }]))
    set(speeds, { ...read(speeds), ...found })
    set(bench, { done: Math.min(start + batch.length, ids.length), total: ids.length })
  }
  set(bench, null)
}

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  // Why: the worker has no UI language of its own; it reads this to speak the person's language.
  void storage.set('locale', env.locale).catch(() => undefined)
  void (async () => {
    await loadSettings()
    const snapshot = await plugin.request('status.get', {})
    set(status, snapshot)
    void loadUsage().catch(() => undefined)
    void loadStats().catch(() => undefined)
    if (canLoadModels(snapshot.hasKey)) {
      await loadModels()
    }
  })().catch(() => undefined)
  ctx.subscriptions.push(
    plugin.on('status.changed', (snapshot) => {
      set(status, snapshot)
      void loadUsage().catch(() => undefined)
      void loadStats().catch(() => undefined)
    }),
    settings.onDidChange(() => void loadSettings().catch(() => undefined))
  )
}

function choosePreset(id: string): void {
  const preset = presetById(id)
  set(presetId, preset.id)
  set(outcome, null)
  forgetModels()
  if (preset.baseUrl !== null) {
    set(baseUrl, preset.baseUrl)
    set(model, preset.model)
  }
  void loadUsage().catch(() => undefined)
  if (preset.keyKind === 'none') {
    void loadModels()
  }
}

function editBaseUrl(value: string): void {
  set(baseUrl, value)
  // Why: typing a known address makes it that provider; any other address is a custom one.
  set(presetId, presetFor(presetById(read(presetId)).format, value).id)
  set(outcome, null)
  forgetModels()
  void loadUsage().catch(() => undefined)
}

async function saveAndTest(): Promise<void> {
  if (read(testing)) {
    return
  }
  set(testing, true)
  set(outcome, null)
  try {
    const preset = presetById(read(presetId))
    await settings.set('format', preset.format)
    await settings.set('baseUrl', read(baseUrl).trim())
    await settings.set('model', read(model).trim())
    const key = read(draftKey).trim()
    if (key) {
      await plugin.request('key.set', { key })
      set(draftKey, '')
    }
    const result = await plugin.request('provider.test', {})
    set(outcome, result)
    if (result.ok) {
      set(providerOpen, false)
      void loadModels()
    }
  } catch (error) {
    set(outcome, { ok: false, message: error instanceof Error ? error.message : String(error), ms: null })
  } finally {
    set(testing, false)
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/** The one message that matters right now, or nothing when everything is fine. */
function Notice() {
  const result = read(outcome)
  const current = read(status)
  if (result) {
    return result.ok ? (
      <Callout tone="success" icon="check" title={tr('test.ok.title')}>
        {tr('test.ok.body', { seconds: seconds(result.ms ?? 0) })}
      </Callout>
    ) : (
      <Callout tone="danger" icon="error" title={tr('test.fail.title')}>
        {result.message}
      </Callout>
    )
  }
  if (current?.state === 'setup') {
    const needsKey = presetById(read(presetId)).keyKind === 'required'
    return (
      <Callout tone="warning" icon="info" title={tr('setup.title')}>
        {needsKey ? tr('setup.withKey') : tr('setup.noKey')}
      </Callout>
    )
  }
  if (current?.state === 'slow') {
    return (
      <Callout tone="warning" icon="warning" title={tr('slow.title')}>
        {tr('slow.body', { seconds: SLOW_SECONDS })}
      </Callout>
    )
  }
  if (current?.state === 'error') {
    return (
      <Callout tone="danger" icon="error" title={tr('error.title')}>
        {current.reason ?? ''}
      </Callout>
    )
  }
  return null
}

function BaseUrlField() {
  const preset = presetById(read(presetId))
  return (
    <Stack gap="xs">
      <Input
        label={tr('baseUrl')}
        placeholder="https://"
        value={read(baseUrl)}
        onChange={editBaseUrl}
        onSubmit={() => void saveAndTest()}
      />
      <Text muted size="sm">{preset.baseUrl === null ? tr('baseUrl.hint') : tr('baseUrl.known')}</Text>
    </Stack>
  )
}

function KeyField(props: { hasKey: boolean }) {
  const preset = presetById(read(presetId))
  if (preset.keyKind === 'none') {
    return <Text muted size="sm">{tr('apiKey.local')}</Text>
  }
  const host = hostOf(read(baseUrl))
  return (
    <Stack gap="xs">
      <Input
        label={tr('apiKey')}
        type="password"
        placeholder={props.hasKey ? tr('apiKey.saved') : tr('apiKey.empty')}
        value={read(draftKey)}
        onChange={(value) => {
          set(draftKey, value)
          set(outcome, null)
        }}
        onSubmit={() => void saveAndTest()}
      />
      <Text muted size="sm">
        {preset.keyKind === 'optional' || !host ? tr('apiKey.optional') : tr('apiKey.hint', { host })}
      </Text>
    </Stack>
  )
}

/** The plain text field for a model name: always there when there is no list to pick from. */
function ModelInput() {
  const preset = presetById(read(presetId))
  return (
    <Stack gap="xs">
      <Input
        label={tr('model')}
        placeholder={preset.model}
        value={read(model)}
        onChange={(value) => {
          set(model, value)
          set(outcome, null)
        }}
        onSubmit={() => void saveAndTest()}
      />
      <Text muted size="sm">{tr('model.typeHint')}</Text>
    </Stack>
  )
}

/** Why there is no list yet (loading, failed, no key) and the way to load it. */
function ModelStatus(props: { hasKey: boolean }) {
  const phase = read(modelsPhase)
  const needsKey = presetById(read(presetId)).keyKind === 'required' && !props.hasKey && read(draftKey).trim() === ''
  return (
    <Stack gap="xs">
      {phase === 'loading' ? <Spinner label={tr('models.loading')} /> : null}
      {phase === 'failed' ? <Text tone="danger" size="sm">{tr('models.failed', { reason: read(modelsMessage) })}</Text> : null}
      {phase === 'done' ? <Text muted size="sm">{tr('models.none')}</Text> : null}
      {phase === 'idle' && needsKey ? <Text muted size="sm">{tr('models.needKey')}</Text> : null}
      <Row>
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          disabled={phase === 'loading' || !canLoadModels(props.hasKey)}
          onPress={() => void loadModels()}
        >
          {tr('models.load')}
        </Button>
      </Row>
    </Stack>
  )
}

/** The provider's models, fastest first once timed, with the speed test where it is worth offering. */
function ModelList(props: { hasKey: boolean; compact: boolean }) {
  const phase = read(modelsPhase)
  const all = read(models)
  // Why: real usage beats a single test, so it wins where both exist.
  const timings: Speeds = { ...read(speeds), ...read(usage) }
  const running = read(bench)
  const policy = presetById(read(presetId)).bench
  const limitMs = SLOW_SECONDS * 1000
  const matched = filterModels(all, read(modelSearch))
  const ranked = rankModels(matched, timings, limitMs)
  const best = recommendedModels(ranked, timings, limitMs)
  const chosen = all.includes(read(model).trim()) ? read(model).trim() : ''
  const capped = ranked.slice(0, MODEL_LIST_MAX_SHOWN)
  // Why: the chosen model must stay in the list even when it ranks beyond the first page.
  const shown = chosen && !capped.includes(chosen) ? [chosen, ...capped.slice(0, -1)] : capped
  const untested = pickCandidates(ranked, timings, policy === 'all' ? ranked.length : BENCH_MAX_MODELS, chosen)
  const tested = matched.some((id) => timings[id])
  const usedReal = matched.some((id) => timings[id]?.uses)
  const fastest = best[0]
  return (
    <Stack gap="xs">
      {phase === 'loading' ? <Spinner label={tr('models.loading')} /> : null}
      {!props.compact ? (
        <Input
          label={tr('models.search')}
          type="search"
          placeholder={tr('models.search')}
          value={read(modelSearch)}
          onChange={(value) => set(modelSearch, value)}
        />
      ) : null}
      {shown.length > 0 ? (
        <Select
          label={tr('models.pick')}
          placeholder={tr('models.placeholder')}
          value={chosen}
          options={shown.map((id) => ({ value: id, label: modelLabel(id, timings[id], best.includes(id)) }))}
          onChange={(value) => {
            set(model, value)
            set(outcome, null)
          }}
        />
      ) : null}
      {running ? (
        <Progress
          label={tr('models.benching', { done: running.done, total: running.total })}
          value={Math.round((running.done / running.total) * 100)}
        />
      ) : null}
      {!running && fastest && fastest !== chosen ? (
        <Button
          size="sm"
          icon="zap"
          onPress={() => {
            set(model, fastest)
            set(outcome, null)
          }}
        >
          {tr('models.useFastest', { model: fastest, seconds: seconds(timings[fastest]?.ms ?? 0) })}
        </Button>
      ) : null}
      {!running && policy !== 'off' && tested && best.length === 0 ? (
        <Text tone="warning" size="sm">{tr('models.noneFast', { seconds: SLOW_SECONDS })}</Text>
      ) : null}
      {matched.length > shown.length ? (
        <Text muted size="sm">{tr('models.count', { shown: shown.length, total: matched.length })}</Text>
      ) : null}
      {policy !== 'off' && !running ? (
        <Text muted size="sm">
          {untested.length === 0 && tested
            ? tr(props.compact ? 'models.allTestedShort' : 'models.allTested')
            : tr('models.benchHint')}
        </Text>
      ) : null}
      {usedReal ? <Text muted size="sm">{tr('models.usedHint')}</Text> : null}
      <Row>
        {policy !== 'off' ? (
          <Button
            variant="outline"
            size="sm"
            icon="gauge"
            disabled={Boolean(running) || untested.length === 0}
            onPress={() => void benchModels(untested)}
          >
            {tr('models.bench', { count: untested.length })}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          disabled={phase === 'loading' || Boolean(running) || !canLoadModels(props.hasKey)}
          onPress={() => void loadModels()}
        >
          {tr('models.load')}
        </Button>
      </Row>
    </Stack>
  )
}

/**
 * Picking a model, in the simplest form the list allows: just a text field when there is no list,
 * a plain picker for a short list, and a searchable list plus a typing tab for a long one.
 */
function ModelField(props: { hasKey: boolean }) {
  const phase = read(modelsPhase)
  const all = read(models)
  const typed = read(model).trim()
  if (all.length === 0 || (phase !== 'done' && phase !== 'loading')) {
    return (
      <Stack gap="xs">
        <ModelInput />
        <ModelStatus hasKey={props.hasKey} />
        <Text muted size="sm">{tr('model.hint', { seconds: SLOW_SECONDS })}</Text>
      </Stack>
    )
  }
  if (all.length <= SHORT_LIST_MAX) {
    // Why: a model the list does not show (new, preview, custom) must still be reachable.
    const typing = read(typeOpen) || (typed !== '' && !all.includes(typed))
    return (
      <Stack gap="xs">
        <ModelList hasKey={props.hasKey} compact />
        {typing ? (
          <ModelInput />
        ) : (
          <Row>
            <Button variant="ghost" size="sm" icon="edit" onPress={() => set(typeOpen, true)}>
              {tr('models.typeInstead')}
            </Button>
          </Row>
        )}
        <Text muted size="sm">{tr('model.hint', { seconds: SLOW_SECONDS })}</Text>
      </Stack>
    )
  }
  return (
    <Stack gap="xs">
      <Tabs
        label={tr('mode.label')}
        value={read(modelMode)}
        onChange={(value) => set(modelMode, value === 'type' ? 'type' : 'list')}
      >
        <Tab value="list" label={tr('mode.list')} icon="search">
          <ModelList hasKey={props.hasKey} compact={false} />
        </Tab>
        <Tab value="type" label={tr('mode.type')} icon="edit">
          <ModelInput />
        </Tab>
      </Tabs>
      <Text muted size="sm">{tr('model.hint', { seconds: SLOW_SECONDS })}</Text>
    </Stack>
  )
}

function ProviderForm(props: { hasKey: boolean }) {
  const preset = presetById(read(presetId))
  const busy = read(testing)
  return (
    <Stack gap="md">
      <Select
        label={tr('provider')}
        value={preset.id}
        options={PRESETS.map((p) => ({ value: p.id, label: tr(`preset.${p.id}`) }))}
        onChange={choosePreset}
      />
      <BaseUrlField />
      <KeyField hasKey={props.hasKey} />
      <ModelField hasKey={props.hasKey} />
      <Button icon="check" disabled={busy} onPress={() => void saveAndTest()}>
        {busy ? tr('testing') : tr('saveTest')}
      </Button>
    </Stack>
  )
}

/** Whole percent of `part` in `whole`, or a dash when there is nothing to divide by. */
function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–'
}

/** How the model in use has done in real use. Counted on this computer only. */
function Statistics() {
  const data = read(stats)
  const s = data?.summary
  const hasData = s !== undefined && s.shown + s.accepted + s.partial + s.stale + s.samples > 0
  return (
    <Collapsible title={tr('stats.title')}>
      <Stack gap="xs">
        {hasData && s && data ? (
          <Stack gap="xs">
            <Text size="sm">{tr('stats.shown', { count: s.shown })}</Text>
            <Text size="sm">{tr('stats.accepted', { count: s.accepted, percent: percent(s.accepted, s.shown) })}</Text>
            <Text size="sm">{tr('stats.partial', { count: s.partial })}</Text>
            <Text size="sm">{tr('stats.kept', { count: s.kept, percent: percent(s.kept, s.accepted) })}</Text>
            <Text size="sm">{tr('stats.undone', { count: s.undone })}</Text>
            <Text size="sm">{tr('stats.stale', { count: s.stale })}</Text>
            {s.p50 !== null && s.p95 !== null ? <Text size="sm">{tr('stats.latency', { p50: s.p50, p95: s.p95 })}</Text> : null}
            <Text muted size="sm">{tr('stats.since', { date: new Date(data.since).toISOString().slice(0, 10) })}</Text>
            <Row>
              <Button variant="ghost" size="sm" icon="refresh" onPress={() => void resetStats()}>
                {tr('stats.reset')}
              </Button>
            </Row>
          </Stack>
        ) : (
          <Text muted size="sm">{tr('stats.none')}</Text>
        )}
      </Stack>
    </Collapsible>
  )
}

function Help() {
  return (
    <Collapsible title={tr('help.title')}>
      <Stack gap="sm">
        <Text size="sm">{tr('help.pause')}</Text>
        <Text size="sm">{tr('help.accept')}</Text>
        <Text size="sm">{tr('help.bar')}</Text>
        <Text size="sm" muted>{tr('help.privacy')}</Text>
      </Stack>
    </Collapsible>
  )
}

/** "Where · which model", skipping whichever half is empty. */
function summary(where: string, modelName: string): string {
  return [where, modelName].filter(Boolean).join(' · ')
}

export default function Panel() {
  const current = read(status)
  const state = current?.state
  const needsAttention = state === 'setup' || state === 'slow' || state === 'error'
  const preset = presetById(read(presetId))
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading>{tr('title')}</Heading>
        {state ? <Badge tone={TONES[state]}>{tr(`state.${state}`)}</Badge> : null}
      </Row>
      <Switch
        label={tr('switch')}
        checked={read(enabled)}
        onChange={(checked) => void settings.set('enabled', checked)}
      />
      <Notice />
      {state === 'on' && current ? (
        <Stack gap="xs">
          <Text muted size="sm">{tr('ready.body')}</Text>
          {current.lastMs !== null ? (
            <Text muted size="sm">
              {tr('stats.line', { seconds: seconds(current.lastMs), count: current.suggested })}
            </Text>
          ) : null}
        </Stack>
      ) : null}
      <Collapsible
        title={tr('provider.title')}
        description={summary(
          preset.baseUrl === null ? hostOf(read(baseUrl)) : tr(`preset.${preset.id}`),
          read(model)
        )}
        open={read(providerOpen) ?? needsAttention}
        onChange={(open) => set(providerOpen, open)}
      >
        <ProviderForm hasKey={current?.hasKey ?? false} />
      </Collapsible>
      <Statistics />
      <Help />
    </Stack>
  )
}
