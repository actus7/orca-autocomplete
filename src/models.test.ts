import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProviderHttpError } from './complete.ts'
import {
  buildModelsRequest,
  extractModelIds,
  filterModels,
  isExpectedAnswer,
  isFast,
  isLikelyFast,
  listModels,
  median,
  modelLabel,
  pickCandidates,
  rankModels,
  recommendedModels,
  type Speeds
} from './models.ts'

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

const LIMIT = 1800
const timed: Speeds = {
  slow: { ok: true, ms: 3200 },
  quick: { ok: true, ms: 420 },
  broken: { ok: false, ms: null },
  medium: { ok: true, ms: 900 }
}

test('rankModels puts fast answers first, then slow ones, then failures, then untested ones', () => {
  const ranked = rankModels(['untested-b', 'broken', 'slow', 'untested-a', 'medium', 'quick'], timed, LIMIT)
  assert.deepEqual(ranked, ['quick', 'medium', 'slow', 'broken', 'untested-b', 'untested-a'])
})

test('rankModels keeps the provider order while nothing has been tested', () => {
  assert.deepEqual(rankModels(['b', 'a', 'c'], {}, LIMIT), ['b', 'a', 'c'])
})

test('isFast needs an answer inside the limit', () => {
  assert.equal(isFast(timed.quick, LIMIT), true)
  assert.equal(isFast(timed.slow, LIMIT), false)
  assert.equal(isFast(timed.broken, LIMIT), false)
  assert.equal(isFast(undefined, LIMIT), false)
  // A timeout is recorded as the limit itself and must not count as fast.
  assert.equal(isFast({ ok: true, ms: LIMIT }, LIMIT), false)
})

test('recommendedModels are the fastest three that answered in time', () => {
  const many: Speeds = { a: { ok: true, ms: 500 }, b: { ok: true, ms: 300 }, c: { ok: true, ms: 700 }, d: { ok: true, ms: 100 }, e: { ok: true, ms: 9000 } }
  assert.deepEqual(recommendedModels(['a', 'b', 'c', 'd', 'e'], many, LIMIT), ['d', 'b', 'a'])
  assert.deepEqual(recommendedModels(['slow', 'broken'], timed, LIMIT), [])
})

test('modelLabel shows the time, a star for the best picks and a cross for failures', () => {
  assert.equal(modelLabel('m', undefined, false), 'm')
  assert.equal(modelLabel('m', { ok: true, ms: 420 }, true), '★ m · 0.4s')
  assert.equal(modelLabel('m', { ok: true, ms: 3200 }, false), 'm · 3.2s')
  assert.equal(modelLabel('m', { ok: false, ms: null }, false), 'm · ✕')
})

test('pickCandidates tries likely-fast names first, skips tested models and honours the limit', () => {
  const all = ['a/opus-4', 'b/gemini-pro', 'c/claude-haiku-4-5', 'd/gpt-5-mini', 'e/llama-70b', 'f/qwen2.5-coder:7b', 'g/flash-high', 'h/done']
  const picked = pickCandidates(all, { 'h/done': { ok: true, ms: 100 } }, 4)
  assert.deepEqual(picked, ['c/claude-haiku-4-5', 'd/gpt-5-mini', 'f/qwen2.5-coder:7b', 'a/opus-4'])
})

test('pickCandidates treats small parameter counts as likely fast and large ones as slow', () => {
  assert.deepEqual(pickCandidates(['x/big-model', 'y/tiny:1.5b'], {}, 1), ['y/tiny:1.5b'])
  assert.deepEqual(pickCandidates(['x/llama-70b', 'y/tiny-3b'], {}, 1), ['y/tiny-3b'])
})

test('pickCandidates always includes the model in use, so there is something to compare against', () => {
  const picked = pickCandidates(['a/flash', 'b/mini', 'c/my-current-big-model'], {}, 2, 'c/my-current-big-model')
  assert.deepEqual(picked, ['c/my-current-big-model', 'a/flash'])
})

test('isExpectedAnswer accepts the known completion however it is spaced, and rejects prose', () => {
  assert.equal(isExpectedAnswer('a + b;'), true)
  assert.equal(isExpectedAnswer('a+b'), true)
  assert.equal(isExpectedAnswer('Sure! Here is the code'), false)
  assert.equal(isExpectedAnswer(''), false)
})

test('median ignores one outlier and averages the middle pair of an even count', () => {
  assert.equal(median([400, 450, 9000]), 450)
  assert.equal(median([300, 500]), 400)
  assert.equal(median([700]), 700)
})

test('modelLabel shows how many real uses a time is based on', () => {
  assert.equal(modelLabel('m', { ok: true, ms: 600, uses: 14 }, false), 'm · 0.6s (14×)')
})

test('rankModels lists untested likely-fast names before the rest, in the provider order', () => {
  const ranked = rankModels(['big-model', 'x-haiku', 'opus-max', 'y-mini'], {}, LIMIT)
  assert.deepEqual(ranked, ['x-haiku', 'y-mini', 'big-model', 'opus-max'])
  assert.equal(isLikelyFast('gemini-pro'), false)
})
