// The panel as a person uses it, drawn by Orca's own runtime. Run with `npm run test:panel` (it needs the
// `orca` command line; plain `node --test` cannot draw a components panel). Orca 1.4.255 on Windows fails to
// load its test kit for a plugin folder on another drive than Orca itself; run it from a copy on that drive.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostError, mockHost, mount } from 'orca/testing'
import * as panel from './panel.tsx'

const settings = { enabled: true, format: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
const status = {
  state: 'on' as const,
  lastMs: 480,
  suggested: 120,
  reason: null,
  host: 'api.openai.com',
  model: 'gpt-4o-mini',
  hasKey: true,
  destination: 'remote' as const
}
const statistics = {
  model: 'api.openai.com|gpt-4o-mini',
  since: 1_760_000_000_000,
  summary: { shown: 120, accepted: 31, partial: 9, kept: 24, undone: 7, stale: 12, p50: 480, p95: 1210, samples: 50 }
}
const requests = {
  'status.get': status,
  'models.list': { ok: true, message: '', models: ['gpt-4o', 'gpt-4o-mini'] },
  'models.usage': { usage: {} },
  'stats.get': statistics,
  'stats.reset': {}
}

const requested = (host: ReturnType<typeof mockHost>, name: string): number =>
  host.callsOf('plugin.request').filter((call) => (call as { name: string }).name === name).length

test('the statistics read as labelled numbers, with the share of what was shown and accepted', async () => {
  const drawn = await mount(panel, { host: mockHost({ settings, requests }), locale: 'en-US' })
  await drawn.toggle({ type: 'Collapsible', label: 'Statistics' })
  const items = drawn.find({ type: 'KeyValue' })?.props.items as { label: string; value: unknown }[]
  assert.deepEqual(
    items.map((item) => [item.label, item.value]),
    [
      ['Suggestions shown', 120],
      ['Accepted whole', '31 (26% of those shown)'],
      ['Accepted a word or a line at a time', 9],
      ['Still there after 30 s', '24 (77% of those accepted)'],
      ['Removed or changed afterwards', 7],
      ['Arrived too late to show', 12],
      ['Answer time', '480 ms median · 95% within 1210 ms']
    ]
  )
  assert.deepEqual([...drawn.errors, ...drawn.warnings], [])
  await drawn.unmount()
})

// Why: clearing cannot be taken back, so one stray press must not do it.
test('clearing the statistics takes two presses', async () => {
  const host = mockHost({ settings, requests })
  const drawn = await mount(panel, { host, locale: 'en-US' })
  await drawn.toggle({ type: 'Collapsible', label: 'Statistics' })
  await drawn.press({ type: 'Button', text: 'Clear statistics' })
  assert.equal(requested(host, 'stats.reset'), 0, 'the first press only arms the button')
  await drawn.press({ type: 'Button', text: 'Press again to clear them for good' })
  assert.equal(requested(host, 'stats.reset'), 1)
  assert.ok(drawn.find({ type: 'Button', text: 'Clear statistics' }), 'the button is back to asking')
  await drawn.unmount()
})

// Why: a worker that does not answer used to leave a panel that looked empty and said nothing.
test('a worker that does not answer is said, not hidden', async () => {
  const failing = { ...requests, 'status.get': () => { throw hostError('action_failed', 'worker crashed') } }
  const drawn = await mount(panel, { host: mockHost({ settings, requests: failing }), locale: 'en-US' })
  assert.ok(drawn.find({ type: 'Callout', text: /worker crashed/ }), drawn.summary().join('\n'))
  assert.equal(drawn.find({ type: 'Skeleton' }), null, 'nothing pretends to still be loading')
  await drawn.unmount()
})

// Why: saving writes three settings one after another, and each write tells the panel "settings changed". Reading the
// saved values back at that moment used to put the old model over the one just picked, so the old one was saved again.
test('the model picked in the list is the one that is saved and tested', async () => {
  const models = { ok: true, message: '', models: ['claude-haiku-4-5', 'gpt-4o', 'gpt-4o-mini'] }
  const host = mockHost({ settings, requests: { ...requests, 'models.list': models, 'provider.test': { ok: true, message: '', ms: 300 } } })
  const drawn = await mount(panel, { host, locale: 'en-US' })
  await drawn.toggle({ type: 'Collapsible', label: 'Provider settings' })
  await drawn.select({ type: 'Select', label: 'Models from your provider' }, 'claude-haiku-4-5')
  await drawn.press({ type: 'Button', text: 'Save and test' })
  assert.equal(host.data().settings.model, 'claude-haiku-4-5')
  await drawn.unmount()
})

// Why: a model picked but not saved yet must survive a setting changed elsewhere, such as the on/off switch.
test('turning suggestions off and on keeps a model that was picked and not saved yet', async () => {
  const models = { ok: true, message: '', models: ['claude-haiku-4-5', 'gpt-4o', 'gpt-4o-mini'] }
  const drawn = await mount(panel, { host: mockHost({ settings, requests: { ...requests, 'models.list': models } }), locale: 'en-US' })
  await drawn.toggle({ type: 'Collapsible', label: 'Provider settings' })
  const picker = { type: 'Select', label: 'Models from your provider' }
  await drawn.select(picker, 'claude-haiku-4-5')
  await drawn.toggle({ type: 'Switch', label: 'Suggest as I type' })
  assert.equal(drawn.valueOf(picker), 'claude-haiku-4-5')
  await drawn.unmount()
})

// Why: the notice of a failed test used to stay for good, saying "could not connect" over suggestions that worked.
test('a failed test stops being said once suggestions work', async () => {
  const failed = { ok: false, message: 'Rate limit reached. Wait a moment or pick another model.', ms: null }
  const drawn = await mount(panel, { host: mockHost({ settings, requests: { ...requests, 'provider.test': failed } }), locale: 'en-US' })
  await drawn.toggle({ type: 'Collapsible', label: 'Provider settings' })
  await drawn.press({ type: 'Button', text: 'Save and test' })
  assert.ok(drawn.find({ type: 'Callout', text: /Rate limit reached/ }))
  await drawn.post('status.changed', { ...status, state: 'error', reason: failed.message })
  assert.ok(drawn.find({ type: 'Callout', text: /Rate limit reached/ }), 'still said while it is still failing')
  await drawn.post('status.changed', status)
  assert.equal(drawn.find({ type: 'Callout', text: /Rate limit reached/ }), null)
  await drawn.unmount()
})
