import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProviderHttpError } from './complete.ts'
import { buildModelsRequest, extractModelIds, filterModels, listModels } from './models.ts'

test('the OpenAI-style list request is a GET on /models with a bearer key when there is one', () => {
  const { url, init } = buildModelsRequest({ format: 'openai', baseUrl: 'https://api.example.com/v1/', apiKey: 'k' })
  assert.equal(url, 'https://api.example.com/v1/models')
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.authorization, 'Bearer k')
  const local = buildModelsRequest({ format: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: '' })
  assert.equal('authorization' in local.init.headers, false)
})

test('the Anthropic-style list asks for up to 1000 models and adds /v1 only when missing', () => {
  const bare = buildModelsRequest({ format: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' })
  assert.equal(bare.url, 'https://api.anthropic.com/v1/models?limit=1000')
  assert.equal(bare.init.headers['x-api-key'], 'k')
  assert.ok(bare.init.headers['anthropic-version'])
  const withV1 = buildModelsRequest({ format: 'anthropic', baseUrl: 'https://proxy.example/v1', apiKey: '' })
  assert.equal(withV1.url, 'https://proxy.example/v1/models?limit=1000')
})

test('extractModelIds keeps code-capable ids, unique and sorted, and survives odd answers', () => {
  const answer = { data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }, { id: 'a-model' }, { id: 'a-model' }, { id: 'whisper-1' }, { nope: 1 }, null] }
  assert.deepEqual(extractModelIds(answer), ['a-model', 'gpt-4o-mini'])
  assert.deepEqual(extractModelIds(null), [])
  assert.deepEqual(extractModelIds({ data: 'x' }), [])
})

test('listModels returns the ids and turns a rejected key into a typed error', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'm1' }] }) })
  assert.deepEqual(await listModels({ format: 'openai', baseUrl: 'http://x/v1', apiKey: '' }, new AbortController().signal, ok), ['m1'])
  const denied = async () => ({ ok: false, status: 401, json: async () => ({}) })
  await assert.rejects(
    listModels({ format: 'openai', baseUrl: 'http://x/v1', apiKey: '' }, new AbortController().signal, denied),
    (error: unknown) => error instanceof ProviderHttpError && error.status === 401
  )
})

test('filterModels narrows by what is typed, but shows everything once a model is chosen', () => {
  const all = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-4o-mini']
  assert.deepEqual(filterModels(all, ''), all)
  assert.deepEqual(filterModels(all, 'CLAUDE'), ['claude-haiku-5-5', 'claude-sonnet-5-5'])
  assert.deepEqual(filterModels(all, 'haiku'), ['claude-haiku-5-5'])
  assert.deepEqual(filterModels(all, 'gpt-4o-mini'), all)
  assert.deepEqual(filterModels(all, 'zzz'), [])
})
