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
  read,
  Row,
  Select,
  set,
  settings,
  Spinner,
  Stack,
  storage,
  Switch,
  Text,
  type PanelContext,
  type StatusSnapshot
} from 'orca'
import { pickLocale, translator } from './i18n.ts'
import { filterModels, MODEL_LIST_MAX_SHOWN } from './models.ts'
import { PRESETS, presetById, presetFor, type PresetId } from './presets.ts'

const tr = translator(pickLocale(env.locale))
const SLOW_SECONDS = 1.8
const TONES = { on: 'success', off: 'neutral', setup: 'warning', error: 'danger', slow: 'warning' } as const

type Outcome = { ok: boolean; message: string; ms: number | null }

const status = atom<StatusSnapshot | null>(null)
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
let modelsRun = 0

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
  set(models, [])
  set(modelsPhase, 'idle')
}

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  // Why: the worker has no UI language of its own; it reads this to speak the person's language.
  void storage.set('locale', env.locale).catch(() => undefined)
  void (async () => {
    await loadSettings()
    const snapshot = await plugin.request('status.get', {})
    set(status, snapshot)
    if (canLoadModels(snapshot.hasKey)) {
      await loadModels()
    }
  })().catch(() => undefined)
  ctx.subscriptions.push(
    plugin.on('status.changed', (snapshot) => set(status, snapshot)),
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

/** The provider's own list of models, narrowed by what is typed in the model field. */
function ModelPicker(props: { hasKey: boolean }) {
  const phase = read(modelsPhase)
  const all = read(models)
  const typed = read(model)
  const matched = filterModels(all, typed)
  const chosen = all.includes(typed.trim()) ? typed.trim() : ''
  const capped = matched.slice(0, MODEL_LIST_MAX_SHOWN)
  // Why: the chosen model must stay in the list even when it sorts beyond the first page.
  const shown = chosen && !capped.includes(chosen) ? [chosen, ...capped.slice(0, -1)] : capped
  const needsKey = presetById(read(presetId)).keyKind === 'required' && !props.hasKey && read(draftKey).trim() === ''
  return (
    <Stack gap="xs">
      {phase === 'loading' ? <Spinner label={tr('models.loading')} /> : null}
      {phase !== 'loading' && shown.length > 0 ? (
        <Select
          label={tr('models.pick')}
          placeholder={tr('models.placeholder')}
          value={chosen}
          options={shown.map((id) => ({ value: id, label: id }))}
          onChange={(value) => {
            set(model, value)
            set(outcome, null)
          }}
        />
      ) : null}
      {phase === 'done' && all.length === 0 ? <Text muted size="sm">{tr('models.none')}</Text> : null}
      {phase === 'done' && matched.length > shown.length ? (
        <Text muted size="sm">{tr('models.count', { shown: shown.length, total: matched.length })}</Text>
      ) : null}
      {phase === 'done' && all.length > 0 && matched.length === all.length && shown.length === all.length ? (
        <Text muted size="sm">{tr('models.total', { total: all.length })}</Text>
      ) : null}
      {phase === 'failed' ? (
        <Text tone="danger" size="sm">{tr('models.failed', { reason: read(modelsMessage) })}</Text>
      ) : null}
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
        <Text muted size="sm">{tr('model.hint', { seconds: SLOW_SECONDS })}</Text>
        <ModelPicker hasKey={props.hasKey} />
      </Stack>
      <Button icon="check" disabled={busy} onPress={() => void saveAndTest()}>
        {busy ? tr('testing') : tr('saveTest')}
      </Button>
    </Stack>
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
      <Help />
    </Stack>
  )
}
