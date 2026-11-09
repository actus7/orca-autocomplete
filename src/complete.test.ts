import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRequest,
  cleanSuggestion,
  complete,
  extractText,
  type CompletionContext,
  type FetchLike,
  type Provider
} from './complete.ts'

const ctx: CompletionContext = {
  path: 'src/a.ts',
  languageId: 'typescript',
  prefix: 'const x = ',
  suffix: ';\n'
}
const openai: Provider = {
  format: 'openai',
  baseUrl: 'http://localhost:11434/v1/',
  model: 'm',
  apiKey: 'k',
  maxTokens: 64
}
const anthropic: Provider = { ...openai, format: 'anthropic', baseUrl: 'https://api.anthropic.com' }

test('openai request targets /chat/completions with a bearer key and the cursor marker', () => {
  const { url, init } = buildRequest(openai, ctx)
  assert.equal(url, 'http://localhost:11434/v1/chat/completions')
  assert.equal(init.headers.authorization, 'Bearer k')
  const body = JSON.parse(init.body)
  assert.equal(body.max_tokens, 64)
  assert.match(body.messages[1].content, /const x = <CURSOR>;/)
})

test('neither format sends temperature, which newer models reject', () => {
  assert.equal('temperature' in JSON.parse(buildRequest(openai, ctx).init.body), false)
  assert.equal('temperature' in JSON.parse(buildRequest(anthropic, ctx).init.body), false)
})

test('openai request omits authorization when no key is set', () => {
  const { init } = buildRequest({ ...openai, apiKey: '' }, ctx)
  assert.equal('authorization' in init.headers, false)
})

test('anthropic request adds /v1 only when the base lacks it', () => {
  assert.equal(buildRequest(anthropic, ctx).url, 'https://api.anthropic.com/v1/messages')
  const withV1 = { ...anthropic, baseUrl: 'https://proxy.example/v1' }
  assert.equal(buildRequest(withV1, ctx).url, 'https://proxy.example/v1/messages')
  assert.equal(buildRequest(anthropic, ctx).init.headers['x-api-key'], 'k')
})

test('extractText reads each format and tolerates odd shapes', () => {
  assert.equal(extractText('openai', { choices: [{ message: { content: 'a' } }] }), 'a')
  assert.equal(
    extractText('anthropic', { content: [{ type: 'text', text: 'a' }, { type: 'x' }, { type: 'text', text: 'b' }] }),
    'ab'
  )
  assert.equal(extractText('openai', null), '')
  assert.equal(extractText('openai', { choices: [] }), '')
})

test('cleanSuggestion strips one markdown fence and leaves plain text alone', () => {
  assert.equal(cleanSuggestion('```ts\nfoo()\n```'), 'foo()')
  assert.equal(cleanSuggestion('foo()'), 'foo()')
})

test('complete returns cleaned text and throws on HTTP errors without leaking the body', async () => {
  const ok: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '```\n42\n```' } }] }),
    text: async () => ''
  })
  assert.equal(await complete(openai, ctx, new AbortController().signal, ok), '42')

  const bad: FetchLike = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
    text: async () => 'secret prompt echo'
  })
  await assert.rejects(complete(openai, ctx, new AbortController().signal, bad), (error: Error) => {
    assert.equal(error.message, 'provider answered HTTP 401')
    return true
  })
})
