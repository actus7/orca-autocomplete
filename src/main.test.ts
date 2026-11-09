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
async function mountWorker(settings: Json = baseSettings, secrets: Record<string, string> = {}) {
  const hooks = new Map<string, (event: Json, next: (e: Json) => unknown) => unknown>()
  const handlers = new Map<string, (input: Json) => Promise<unknown>>()
  const logs: string[] = []
  const disposable = { dispose() {} }
  const orca = {
    hooks: { on: (name: string, fn: never) => (hooks.set(name, fn), disposable) },
    panels: { handle: (name: string, fn: never) => (handlers.set(name, fn), disposable) },
    settings: { get: async () => settings },
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
    async fire(event: Json): Promise<Json> {
      const result = (await hooks.get(HOOK)!(event, (e) => ({ next: e }))) as { next: Json } | undefined
      return result?.next ?? event
    },
    request: (name: string, input: Json = {}) => handlers.get(name)!(input)
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
