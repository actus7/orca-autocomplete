import assert from 'node:assert/strict'
import { test } from 'node:test'
import activate from './main.ts'

type Json = Record<string, unknown>
const asked = {
  workspaceId: null,
  path: 'a.ts',
  languageId: 'typescript',
  prefix: 'const x = ',
  suffix: ';',
  suggestion: ''
}
// Local Ollama: a provider that needs no key, so tests do not have to store one.
const baseSettings: Json = {
  enabled: true,
  format: 'openai',
  baseUrl: 'http://localhost:11434/v1',
  model: 'm',
  maxTokens: 64
}
const keyedSettings: Json = { ...baseSettings, baseUrl: 'https://api.openai.com/v1' }

/** The few `orca` members main.ts uses; `next(e)` is modelled as `{ next: e }`. */
async function mountWorker(
  initial: Json = baseSettings,
  secrets: Record<string, string> = {},
  locale = 'en-US'
) {
  const settings = { ...initial }
  const store = new Map<string, unknown>([['locale', locale]])
  const handlers = new Map<string, (input: Json) => Promise<unknown>>()
  const commands = new Map<string, () => Promise<unknown>>()
  const statusUpdates: Json[] = []
  const posts: { event: string; payload: Json }[] = []
  const logs: string[] = []
  const disposable = { dispose() {} }
  const orca = {
    panels: {
      handle: (name: string, fn: never) => (handlers.set(name, fn), disposable),
      post: (event: string, payload: Json) => void posts.push({ event, payload })
    },
    commands: { register: (name: string, fn: never) => (commands.set(name, fn), disposable) },
    host: {
      call: async (method: string, params: Json) => {
        if (method === 'statusBar.update') {
          statusUpdates.push(params)
        }
      }
    },
    settings: {
      get: async (key?: string) => (key === undefined ? settings : settings[key]),
      set: async (key: string, value: unknown) => void (settings[key] = value),
      onDidChange: () => disposable
    },
    storage: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
      onDidChange: () => disposable
    },
    secrets: {
      get: async (key: string) => secrets[key] ?? null,
      set: async (key: string, value: string) => void (secrets[key] = value),
      delete: async (key: string) => void delete secrets[key]
    },
    log: (message: string) => void logs.push(message)
  }
  await activate(orca as never)
  return {
    logs,
    secrets,
    settings,
    store,
    posts,
    lastStatus: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return statusUpdates.at(-1)
    },
    /** Asks the way the plugin's editor does; the event comes back with `suggestion` set when there is one. */
    async fire(event: Json): Promise<Json> {
      const { suggestion } = (await handlers.get('completion.ask')!(event)) as { suggestion: string }
      return suggestion ? { ...event, suggestion } : event
    },
    request: (name: string, input: Json = {}) => handlers.get(name)!(input),
    command: (name: string) => commands.get(name)!()
  }
}

function stubFetch(status: number, body: unknown): () => void {
  const real = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status })
  return () => {
    globalThis.fetch = real
  }
}

test('a suggestion comes from the provider answer', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    assert.deepEqual(await worker.fire(asked), { ...asked, suggestion: '42' })
  } finally {
    restore()
  }
})

// Why: the model list lets people try one model after another at the same spot of the same file;
// an answer remembered from the previous model would be shown as if the new one had given it.
test('a remembered suggestion is not reused after the model changes', async () => {
  const real = globalThis.fetch
  const answers = ['from-first', 'from-second']
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() } }] }))
  try {
    const worker = await mountWorker()
    assert.equal((await worker.fire(asked)).suggestion, 'from-first')
    assert.equal((await worker.fire(asked)).suggestion, 'from-first', 'same model: answered from memory')
    worker.settings.model = 'another-model'
    assert.equal((await worker.fire(asked)).suggestion, 'from-second', 'new model: asked again')
  } finally {
    globalThis.fetch = real
  }
})

const MODEL = 'localhost:11434|m'

type StatsAnswer = { model: string; summary: { shown: number; accepted: number; partial: number; kept: number; undone: number; stale: number; p50: number | null; samples: number } }

test('each suggestion gets an id, and what the editor reports about it is counted for its model', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    const { suggestion, id } = (await worker.request('completion.ask', asked)) as { suggestion: string; id: number }
    assert.equal(suggestion, '42')
    assert.ok(id > 0)
    await worker.request('metrics.event', { id, kind: 'shown' })
    await worker.request('metrics.event', { id, kind: 'accepted' })
    await worker.request('metrics.event', { id, kind: 'kept' })
    const { model, summary } = (await worker.request('stats.get')) as StatsAnswer
    assert.equal(model, MODEL)
    assert.deepEqual([summary.shown, summary.accepted, summary.kept, summary.undone], [1, 1, 1, 0])
    assert.equal(summary.samples, 1, 'the answer time was recorded')
  } finally {
    restore()
  }
})

// Why: the message comes from a page; an id the worker never gave out, or a kind it does not know, must not change anything.
test('events with an unknown id or kind are ignored', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    const { id } = (await worker.request('completion.ask', asked)) as { id: number }
    await worker.request('metrics.event', { id: id + 99, kind: 'shown' })
    await worker.request('metrics.event', { id, kind: 'bogus' })
    const { summary } = (await worker.request('stats.get')) as StatsAnswer
    assert.deepEqual([summary.shown, summary.accepted, summary.partial, summary.stale], [0, 0, 0, 0])
    // What was stored is the proof: no entry for the made-up id, and no field for the made-up kind.
    const stored = worker.store.get('stats') as { models: Record<string, Record<string, unknown>> }
    assert.deepEqual(Object.keys(stored.models), [MODEL])
    assert.equal('bogus' in stored.models[MODEL], false)
  } finally {
    restore()
  }
})

test('a request that a newer one replaced is counted as stale, and no id is given for no suggestion', async () => {
  const real = globalThis.fetch
  globalThis.fetch = ((_url: string, init: { signal: AbortSignal }) =>
    new Promise<Response>((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
      setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }))), 40)
    })) as typeof fetch
  try {
    const worker = await mountWorker()
    const first = worker.request('completion.ask', { ...asked, prefix: 'one ' }) as Promise<{ id: number }>
    const second = worker.request('completion.ask', { ...asked, prefix: 'two ' }) as Promise<{ id: number }>
    assert.equal((await first).id, 0, 'the replaced request gave nothing')
    assert.ok((await second).id > 0)
    const { summary } = (await worker.request('stats.get')) as StatsAnswer
    assert.equal(summary.stale, 1)
  } finally {
    globalThis.fetch = real
  }
})

test('resetting the statistics starts them again from zero', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    const { id } = (await worker.request('completion.ask', asked)) as { id: number }
    await worker.request('metrics.event', { id, kind: 'shown' })
    await worker.request('stats.reset')
    const { summary } = (await worker.request('stats.get')) as StatsAnswer
    assert.deepEqual([summary.shown, summary.samples], [0, 0])
  } finally {
    restore()
  }
})

test('nothing is suggested when disabled', async () => {
  const worker = await mountWorker({ ...baseSettings, enabled: false })
  assert.deepEqual(await worker.fire(asked), asked)
})

test('a provider that needs a key is not called before one is saved', async () => {
  const real = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response('{}')
  }
  try {
    const worker = await mountWorker(keyedSettings)
    assert.deepEqual(await worker.fire(asked), asked)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = real
  }
})

test('a provider error offers nothing and logs the status only', async () => {
  const restore = stubFetch(500, { error: 'secret prompt echo' })
  try {
    const worker = await mountWorker()
    assert.deepEqual(await worker.fire(asked), asked)
    assert.deepEqual(worker.logs, ['completion failed: provider answered HTTP 500'])
  } finally {
    restore()
  }
})

test('key.set stores the trimmed key as a secret and status.get reports it', async () => {
  const worker = await mountWorker(keyedSettings)
  assert.equal(((await worker.request('status.get')) as Json).hasKey, false)
  assert.deepEqual(await worker.request('key.set', { key: ' sk-1 ' }), { hasKey: true })
  assert.equal(worker.secrets.apiKey, 'sk-1')
  assert.equal(((await worker.request('status.get')) as Json).hasKey, true)
  assert.deepEqual(await worker.request('key.set', { key: '' }), { hasKey: false })
  assert.equal('apiKey' in worker.secrets, false)
})

test('provider.test explains a missing setup instead of throwing', async () => {
  const worker = await mountWorker({ ...baseSettings, model: '' })
  const result = (await worker.request('provider.test')) as { ok: boolean; message: string }
  assert.equal(result.ok, false)
  assert.match(result.message, /base URL/)
})

test('provider.test asks for the key before calling a provider that needs one', async () => {
  const worker = await mountWorker(keyedSettings)
  const result = (await worker.request('provider.test')) as { ok: boolean; message: string }
  assert.equal(result.ok, false)
  assert.match(result.message, /API key/)
})

test('provider.test explains a rejected key and what to do', async () => {
  const restore = stubFetch(401, {})
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'bad' })
    const result = (await worker.request('provider.test')) as { ok: boolean; message: string }
    assert.equal(result.ok, false)
    assert.match(result.message, /rejected the key/)
  } finally {
    restore()
  }
})

test('provider.test succeeds with the time it took', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: 'a + b' } }] })
  try {
    const worker = await mountWorker()
    const result = (await worker.request('provider.test')) as { ok: boolean; ms: number }
    assert.equal(result.ok, true)
    assert.equal(typeof result.ms, 'number')
  } finally {
    restore()
  }
})

test('the status item is green with the latency after a suggestion', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    const status = await worker.lastStatus()
    assert.equal(status?.tone, 'success')
    assert.match(String(status?.text), /^\d+\.\ds$/)
    assert.match(String(status?.tooltip), /1 shown/)
  } finally {
    restore()
  }
})

test('the status item is yellow and points to the panel when setup is incomplete', async () => {
  const worker = await mountWorker({ ...baseSettings, model: '' })
  const status = await worker.lastStatus()
  assert.equal(status?.tone, 'warning')
  assert.match(String(status?.tooltip), /Autocomplete panel/)
})

test('a provider that needs a key stays in setup until a key is saved', async () => {
  const worker = await mountWorker(keyedSettings)
  assert.equal((await worker.lastStatus())?.tone, 'warning')
  await worker.request('key.set', { key: 'sk-1' })
  assert.equal((await worker.lastStatus())?.tone, 'success')
})

test('the status item is grey when off and red after a failed request', async () => {
  const off = await mountWorker({ ...baseSettings, enabled: false })
  assert.equal((await off.lastStatus())?.tone, 'neutral')

  const restore = stubFetch(500, {})
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    const status = await worker.lastStatus()
    assert.equal(status?.tone, 'danger')
    assert.match(String(status?.tooltip), /HTTP 500/)
  } finally {
    restore()
  }
})

test('the toggle command flips enabled and updates the status item', async () => {
  const worker = await mountWorker()
  assert.equal(await worker.command('toggle'), 'Autocomplete is off.')
  assert.equal(worker.settings.enabled, false)
  assert.equal((await worker.lastStatus())?.tone, 'neutral')
  assert.equal(await worker.command('toggle'), 'Autocomplete is on.')
  assert.equal(worker.settings.enabled, true)
})

test('a timeout shows as slow on the status item and is not logged', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }
  try {
    const worker = await mountWorker()
    assert.deepEqual(await worker.fire(asked), asked)
    const status = await worker.lastStatus()
    assert.equal(status?.tone, 'warning')
    assert.equal(status?.text, 'slow')
    assert.deepEqual(worker.logs, [])
  } finally {
    globalThis.fetch = real
  }
})

test('the same failure is logged once, not on every typing pause', async () => {
  const restore = stubFetch(500, {})
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    await worker.fire({ ...asked, prefix: 'const y = ' })
    assert.equal(worker.logs.length, 1)
  } finally {
    restore()
  }
})

test('the status item and commands speak Portuguese when Orca does', async () => {
  const worker = await mountWorker({ ...baseSettings, model: '' }, {}, 'pt-BR')
  assert.match(String((await worker.lastStatus())?.tooltip), /Falta configurar/)
  assert.equal(await worker.command('toggle'), 'Autocomplete desligado.')
})

test('the panel is told about every status change', async () => {
  const worker = await mountWorker({ ...baseSettings, enabled: false })
  await worker.lastStatus()
  assert.equal(worker.posts.at(-1)?.event, 'status.changed')
  assert.equal((worker.posts.at(-1)?.payload as Json).state, 'off')
})

function stubModelsFetch(): { seen: { url: string; headers: Record<string, string> }[]; restore: () => void } {
  const real = globalThis.fetch
  const seen: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers })
    return new Response(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'text-embedding-3' }] }))
  }) as never
  return { seen, restore: () => void (globalThis.fetch = real) }
}

test('models.list uses the saved key when the draft is blank and lists code models sorted', async () => {
  const { seen, restore } = stubModelsFetch()
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    const result = (await worker.request('models.list', { format: 'openai', baseUrl: 'https://api.openai.com/v1', key: '' })) as { ok: boolean; models: string[] }
    assert.deepEqual(result.models, ['a-model', 'b-model'])
    assert.equal(seen[0].url, 'https://api.openai.com/v1/models')
    assert.equal(seen[0].headers.authorization, 'Bearer saved')
  } finally {
    restore()
  }
})

test('models.list prefers the key being typed, so a model can be picked before saving', async () => {
  const { seen, restore } = stubModelsFetch()
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.list', { format: 'openai', baseUrl: 'https://api.openai.com/v1', key: ' typed ' })
    assert.equal(seen[0].headers.authorization, 'Bearer typed')
    assert.equal(worker.secrets.apiKey, 'saved')
  } finally {
    restore()
  }
})

test('models.list explains a rejected key and refuses an address that is not http(s)', async () => {
  const restore = stubFetch(401, {})
  try {
    const worker = await mountWorker(keyedSettings)
    const denied = (await worker.request('models.list', { format: 'openai', baseUrl: 'https://api.openai.com/v1', key: 'bad' })) as { ok: boolean; message: string }
    assert.equal(denied.ok, false)
    assert.match(denied.message, /rejected the key/)
    const bad = (await worker.request('models.list', { format: 'openai', baseUrl: 'ftp://x', key: '' })) as { ok: boolean; message: string }
    assert.equal(bad.ok, false)
    assert.match(bad.message, /base URL/)
  } finally {
    restore()
  }
})

test('models.list never sends the saved key to a different address than the one it was saved for', async () => {
  const { seen, restore } = stubModelsFetch()
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.list', { format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', key: '' })
    await worker.request('models.list', { format: 'anthropic', baseUrl: 'https://api.openai.com/v1', key: '' })
    assert.equal(seen.length, 2)
    for (const call of seen) {
      assert.equal('authorization' in call.headers, false)
      assert.equal('x-api-key' in call.headers, false)
    }
  } finally {
    restore()
  }
})

test('models.list still uses the saved key for the saved address, however it is written', async () => {
  const { seen, restore } = stubModelsFetch()
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.list', { format: 'openai', baseUrl: ' HTTPS://API.openai.com/v1/ ', key: '' })
    assert.equal(seen[0].headers.authorization, 'Bearer saved')
  } finally {
    restore()
  }
})

test('models.list sends no key at all to a server that needs none, even a typed one', async () => {
  const { seen, restore } = stubModelsFetch()
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.list', { format: 'openai', baseUrl: 'http://localhost:11434/v1', key: 'typed' })
    assert.equal('authorization' in seen[0].headers, false)
  } finally {
    restore()
  }
})

test('a key saved for one provider is not used for another, and not even counted as saved', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker(keyedSettings)
    await worker.request('key.set', { key: 'sk-openai' })
    assert.equal(((await worker.request('status.get')) as Json).hasKey, true)
    worker.settings.baseUrl = 'https://openrouter.ai/api/v1'
    assert.equal(((await worker.request('status.get')) as Json).hasKey, false)
    assert.equal(((await worker.request('status.get')) as Json).state, 'setup')
    assert.deepEqual(await worker.fire(asked), asked)
  } finally {
    restore()
  }
})

test('a key saved before keys were pinned is adopted by the provider configured now', async () => {
  const worker = await mountWorker(keyedSettings, { apiKey: 'old' })
  await worker.lastStatus()
  assert.equal(worker.store.get('keyAddress'), 'https://api.openai.com/v1')
  assert.equal(((await worker.request('status.get')) as Json).hasKey, true)
})

type BenchResult = { model: string; ok: boolean; ms: number | null }

/** Answers by the model named in the request: a text, an HTTP error, or nothing at all. */
function stubBenchFetch(byModel: Record<string, string | number>): {
  seen: { model: string; headers: Record<string, string> }[]
  restore: () => void
} {
  const real = globalThis.fetch
  const seen: { model: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const model = JSON.parse(init.body).model as string
    seen.push({ model, headers: init.headers })
    const answer = byModel[model]
    if (typeof answer === 'number') {
      return new Response('{}', { status: answer })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: answer ?? '' } }] }))
  }) as never
  return { seen, restore: () => void (globalThis.fetch = real) }
}

const benchAsk = { format: 'openai', baseUrl: 'https://api.openai.com/v1', key: '' }

test('models.bench times each model and marks failures, empty answers and prose as not ok', async () => {
  const { restore } = stubBenchFetch({ good: 'a + b;', empty: '', prose: 'Sure! Here is the code', down: 500 })
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    const { results } = (await worker.request('models.bench', { ...benchAsk, models: ['good', 'empty', 'prose', 'down'] })) as { results: BenchResult[] }
    const byModel = Object.fromEntries(results.map((r) => [r.model, r]))
    assert.equal(byModel.good.ok, true)
    assert.equal(typeof byModel.good.ms, 'number')
    assert.deepEqual([byModel.empty.ok, byModel.empty.ms === null], [false, false])
    assert.deepEqual([byModel.prose.ok, byModel.prose.ms === null], [false, false])
    assert.deepEqual(byModel.down, { model: 'down', ok: false, ms: null })
  } finally {
    restore()
  }
})

test('models.bench times at most four models per request, so a client cannot fan out', async () => {
  const { seen, restore } = stubBenchFetch({})
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.bench', { ...benchAsk, models: ['a', 'b', 'c', 'd', 'e', 'f'] })
    assert.equal(seen.length, 4)
  } finally {
    restore()
  }
})

test('models.bench never sends the saved key to another address, nor any key to a server that needs none', async () => {
  const { seen, restore } = stubBenchFetch({ m: 'a + b' })
  try {
    const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
    await worker.request('models.bench', { format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', key: '', models: ['m'] })
    await worker.request('models.bench', { format: 'openai', baseUrl: 'http://localhost:11434/v1', key: 'typed', models: ['m'] })
    await worker.request('models.bench', { ...benchAsk, models: ['m'] })
    assert.equal('authorization' in seen[0].headers, false)
    assert.equal('authorization' in seen[1].headers, false)
    assert.equal(seen[2].headers.authorization, 'Bearer saved')
  } finally {
    restore()
  }
})

test('models.bench refuses an address that is not http(s)', async () => {
  const worker = await mountWorker(keyedSettings, { apiKey: 'saved' })
  const answer = (await worker.request('models.bench', { format: 'openai', baseUrl: 'ftp://x', key: '', models: ['m'] })) as { results: BenchResult[]; message: string }
  assert.deepEqual(answer.results, [])
  assert.match(answer.message, /base URL/)
})

type Usage = { usage: Record<string, { ms: number; uses: number }> }
const usageFor = (worker: Awaited<ReturnType<typeof mountWorker>>, baseUrl: string) =>
  worker.request('models.usage', { baseUrl }) as Promise<Usage>

test('real suggestions are timed per model, and models.usage answers with their median', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    for (const prefix of ['a ', 'b ', 'c ']) {
      await worker.fire({ ...asked, prefix })
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    const { usage } = await usageFor(worker, 'http://localhost:11434/v1')
    assert.equal(usage.m.uses, 3)
    assert.equal(typeof usage.m.ms, 'number')
  } finally {
    restore()
  }
})

test('models.usage only reports what was measured against the asked address', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual((await usageFor(worker, 'https://api.openai.com/v1')).usage, {})
    assert.equal(Object.keys((await usageFor(worker, 'http://localhost:11434/v1')).usage).length, 1)
  } finally {
    restore()
  }
})

test('a timeout is recorded as a slow sample, so a slow model never looks fast', async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))) as never
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const { usage } = await usageFor(worker, 'http://localhost:11434/v1')
    assert.equal(usage.m.ms, 1800)
  } finally {
    globalThis.fetch = real
  }
})
