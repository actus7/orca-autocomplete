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
const baseSettings: Json = {
  enabled: true,
  format: 'openai',
  baseUrl: 'http://localhost:11434/v1',
  model: 'm',
  maxTokens: 64
}

/** The few `orca` members main.ts uses; `next(e)` is modelled as `{ next: e }`. */
async function mountWorker(initial: Json = baseSettings, secrets: Record<string, string> = {}) {
  const settings = { ...initial }
  const hooks = new Map<string, (event: Json, next: (e: Json) => unknown) => unknown>()
  const handlers = new Map<string, (input: Json) => Promise<unknown>>()
  const commands = new Map<string, () => Promise<unknown>>()
  const statusUpdates: Json[] = []
  const logs: string[] = []
  const disposable = { dispose() {} }
  const orca = {
    hooks: { on: (name: string, fn: never) => (hooks.set(name, fn), disposable) },
    panels: { handle: (name: string, fn: never) => (handlers.set(name, fn), disposable) },
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
    statusUpdates,
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

test('key.set stores the trimmed key as a secret and key.status reports it', async () => {
  const worker = await mountWorker()
  assert.deepEqual(await worker.request('key.status'), { hasKey: false })
  assert.deepEqual(await worker.request('key.set', { key: ' sk-1 ' }), { hasKey: true })
  assert.equal(worker.secrets.apiKey, 'sk-1')
  assert.deepEqual(await worker.request('key.set', { key: '' }), { hasKey: false })
  assert.equal('apiKey' in worker.secrets, false)
})

test('provider.test explains a missing setup instead of throwing', async () => {
  const worker = await mountWorker({ ...baseSettings, model: '' })
  const result = (await worker.request('provider.test')) as { ok: boolean }
  assert.equal(result.ok, false)
})

test('the status item is green with the latency after a suggestion', async () => {
  const restore = stubFetch(200, { choices: [{ message: { content: '42' } }] })
  try {
    const worker = await mountWorker()
    await worker.fire(asked)
    const status = await worker.lastStatus()
    assert.equal(status?.tone, 'success')
    assert.match(String(status?.text), /^\d+\.\ds$/)
    assert.match(String(status?.tooltip), /1 suggested/)
  } finally {
    restore()
  }
})

test('the status item is yellow with the fix when the setup is incomplete', async () => {
  const worker = await mountWorker({ ...baseSettings, model: '' })
  const status = await worker.lastStatus()
  assert.equal(status?.tone, 'warning')
  assert.match(String(status?.tooltip), /Autocomplete panel/)
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
  assert.equal(await worker.command('toggle'), 'Autocomplete off')
  assert.equal(worker.settings.enabled, false)
  assert.equal((await worker.lastStatus())?.tone, 'neutral')
  assert.equal(await worker.command('toggle'), 'Autocomplete on')
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
