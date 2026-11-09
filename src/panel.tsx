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
  Stack,
  storage,
  Switch,
  Text,
  type PanelContext,
  type StatusSnapshot
} from 'orca'
import { pickLocale, translator } from './i18n.ts'
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

async function loadSettings(): Promise<void> {
  const saved = await settings.get()
  const format = saved.format === 'anthropic' ? 'anthropic' : 'openai'
  const url = String(saved.baseUrl ?? '')
  set(enabled, saved.enabled !== false)
  set(presetId, presetFor(format, url).id)
  set(baseUrl, url)
  set(model, String(saved.model ?? ''))
}

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  // Why: the worker has no UI language of its own; it reads this to speak the person's language.
  void storage.set('locale', env.locale).catch(() => undefined)
  void loadSettings().catch(() => undefined)
  void plugin
    .request('status.get', {})
    .then((snapshot) => set(status, snapshot))
    .catch(() => undefined)
  ctx.subscriptions.push(
    plugin.on('status.changed', (snapshot) => set(status, snapshot)),
    settings.onDidChange(() => void loadSettings().catch(() => undefined))
  )
}

function choosePreset(id: string): void {
  const preset = presetById(id)
  set(presetId, preset.id)
  set(outcome, null)
  if (preset.baseUrl !== null) {
    set(baseUrl, preset.baseUrl)
    set(model, preset.model)
  }
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
    }
  } catch (error) {
    set(outcome, { ok: false, message: error instanceof Error ? error.message : String(error), ms: null })
  } finally {
    set(testing, false)
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** "Where · which model", skipping whichever half is empty. */
function summary(where: string, modelName: string): string {
  return [where, modelName].filter(Boolean).join(' · ')
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
      </Stack>
      {preset.baseUrl === null ? (
        <Stack gap="xs">
          <Input
            label={tr('baseUrl')}
            placeholder="https://"
            value={read(baseUrl)}
            onChange={(value) => {
              set(baseUrl, value)
              set(outcome, null)
            }}
            onSubmit={() => void saveAndTest()}
          />
          <Text muted size="sm">{tr('baseUrl.hint')}</Text>
        </Stack>
      ) : null}
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
        description={summary(preset.baseUrl === null ? hostOf(read(baseUrl)) : tr(`preset.${preset.id}`), read(model))}
        open={read(providerOpen) ?? needsAttention}
        onChange={(open) => set(providerOpen, open)}
      >
        <ProviderForm hasKey={current?.hasKey ?? false} />
      </Collapsible>
      <Help />
    </Stack>
  )
}
