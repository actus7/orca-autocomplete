import assert from 'node:assert/strict'
import { test } from 'node:test'
import activate from './main.ts'

type Json = Record<string, unknown>
const HOOK = 'editor.inlineCompletion'
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
  const hooks = new Map<string, (event: Json, next: (e: Json) => unknown) => unknown>()
  const handlers = new Map<string, (input: Json) => Promise<unknown>>()
  const commands = new Map<string, () => Promise<unknown>>()
  const statusUpdates: Json[] = []
  const posts: { event: string; payload: Json }[] = []
  const logs: string[] = []
  const disposable = { dispose() {} }
  const orca = {
    hooks: { on: (name: string, fn: never) => (hooks.set(name, fn), disposable) },
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
    storage: { get: async () => locale, onDidChange: () => disposable },
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
    posts,
    lastStatus: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return statusUpdates.at(-1)
    },
    async fire(event: Json): Promise<Json> {
      const result = (await hooks.get(HOOK)!(event, (e) => ({ next: e }))) as
        | { next: Json }
        | undefined
      return result?.next ?? event
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

test('the hook sets suggestion from the provider answer', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    assert.deepEqual(await worker.fire(asked), { ...asked, suggestion: '42' })
  } finally {
    restore()
  }
})

test('the hook passes untouched when disabled', async () => {
  const worker = await mountWorker({ ...baseSettings, enabled: false })
  assert.deepEqual(await worker.fire(asked), asked)
})

test('the hook does not call a provider that needs a key before one is saved', async () => {
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
