import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRequest,
  cleanSuggestion,
  trimSuffixOverlap,
  complete,
  extractText,
  isProse,
  type CompletionContext,
  type FetchLike,
  type Provider
} from './complete.ts'
import { findSecret } from './neversend.ts'

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

test('cleanSuggestion keeps the first fenced block and drops chatter after it', () => {
  assert.equal(cleanSuggestion('```ts\nfoo()\n```\n\nskipped: tests'), 'foo()')
})

test('trimSuffixOverlap cuts code the model repeated from after the cursor', () => {
  const suffix = '\n}\n\nfunction isEven(n: number): boolean {\n  \n}\n'
  assert.equal(trimSuffixOverlap('a + b\n}', suffix), 'a + b')
  assert.equal(
    trimSuffixOverlap('a + b\n}\n\nfunction isEven(n: number): boolean {\n  return n % 2 === 0\n}', suffix),
    'a + b'
  )
})

test('trimSuffixOverlap leaves legitimate same-line tails and unrelated text alone', () => {
  assert.equal(trimSuffixOverlap("foo('x')", ')\n'), "foo('x')")
  assert.equal(trimSuffixOverlap('foo()\n', ')\n'), 'foo()\n')
  assert.equal(trimSuffixOverlap('a + b', ';\n'), 'a + b')
  assert.equal(trimSuffixOverlap('x', ''), 'x')
})

test('trimPrefixEcho drops what the model repeats from before the cursor', async () => {
  const { trimPrefixEcho } = await import('./complete.ts')
  assert.equal(trimPrefixEcho('const a = 1 + 2;', 'const a = '), '1 + 2;')
  assert.equal(trimPrefixEcho('console.log(x)', 'foo()\nconsole.'), 'log(x)')
  // Two repeated lines are cut as one, not just the last of them.
  assert.equal(trimPrefixEcho('if (ok) {\n  run()', 'if (ok) {\n  '), 'run()')
})

test('trimPrefixEcho leaves a suggestion alone when it does not repeat the prefix or the tail is tiny', async () => {
  const { trimPrefixEcho } = await import('./complete.ts')
  assert.equal(trimPrefixEcho('1 + 2;', 'const a = '), '1 + 2;')
  assert.equal(trimPrefixEcho('= 5', 'x'), '= 5')
  assert.equal(trimPrefixEcho('', 'const a = '), '')
})

test('complete removes a repeated prefix from the provider answer', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'const a = 42;' } }] }))) as FetchLike
  const provider: Provider = { format: 'openai', baseUrl: 'http://x/v1', model: 'm', apiKey: '', maxTokens: 32 }
  const out = await complete(provider, { path: 'a.ts', languageId: 'typescript', prefix: 'const a = ', suffix: '' }, AbortSignal.timeout(1000), fetchImpl)
  assert.equal(out, '42;')
})

// Why: what is sent to a provider is the person's code; a key written in it must not leave the computer.
test('nothing is sent when the code around the cursor holds a secret', async () => {
  let calls = 0
  const fetchImpl: FetchLike = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }), text: async () => '' }
  }
  const secret = `const key = "sk-${'a'.repeat(30)}"\n`
  const signal = AbortSignal.timeout(1000)
  assert.equal(await complete(openai, { ...ctx, prefix: `${secret}const x = ` }, signal, fetchImpl), '')
  assert.equal(await complete(anthropic, { ...ctx, suffix: `;\n${secret}` }, signal, fetchImpl), '')
  assert.equal(calls, 0)
  assert.equal(await complete(openai, ctx, signal, fetchImpl), 'x', 'ordinary code is still completed')
  assert.equal(calls, 1)
})

test('a secret far above the cursor, outside what would be sent, does not hold anything back', async () => {
  let calls = 0
  const fetchImpl: FetchLike = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }), text: async () => '' }
  }
  const far = `const key = "sk-${'a'.repeat(30)}"\n${'// filler line\n'.repeat(1000)}`
  assert.equal(await complete(openai, { ...ctx, prefix: `${far}const x = ` }, AbortSignal.timeout(1000), fetchImpl), 'x')
  assert.equal(calls, 1)
})

const prose: CompletionContext = { path: 'untitled.md', languageId: 'markdown', prefix: '# Notes\n\nThe plugin sends', suffix: '\n' }

test('writing in a document is asked for as writing, with a shorter answer', () => {
  const sent = JSON.parse(buildRequest(openai, prose).init.body) as { max_tokens: number; messages: { content: string }[] }
  assert.match(sent.messages[0].content, /continue a text/i)
  assert.doesNotMatch(sent.messages[0].content, /code completion engine/i)
  assert.equal(sent.max_tokens, 48, 'capped')
  const asked = JSON.parse(buildRequest(anthropic, { ...prose, languageId: 'plaintext' }).init.body) as { system: string; max_tokens: number }
  assert.match(asked.system, /continue a text/i)
  assert.equal(asked.max_tokens, 48)
  // A smaller limit the person chose is kept.
  const small = JSON.parse(buildRequest({ ...openai, maxTokens: 16 }, prose).init.body) as { max_tokens: number }
  assert.equal(small.max_tokens, 16)
})

test('code still gets the code prompt and the limit it was given', () => {
  const sent = JSON.parse(buildRequest(openai, ctx).init.body) as { max_tokens: number; messages: { content: string }[] }
  assert.match(sent.messages[0].content, /code completion engine/i)
  assert.equal(sent.max_tokens, 64)
  assert.deepEqual([isProse('markdown'), isProse('plaintext'), isProse('typescript'), isProse(undefined)], [true, true, false, false])
})

test('a fenced block is kept when writing a document and stripped when completing code', async () => {
  const fenced = '```js\nrun()\n```'
  const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: fenced } }] }), text: async () => '' })
  const signal = AbortSignal.timeout(1000)
  assert.equal(await complete(openai, prose, signal, fetchImpl), fenced)
  assert.equal(await complete(openai, ctx, signal, fetchImpl), 'run()')
})

const okFetch = (counter: { calls: number }): FetchLike => async () => {
  counter.calls += 1
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }), text: async () => '' }
}

// Why: the text sent is cut at a fixed length, which can fall inside a secret. The part that stays in is
// too short for any rule to recognise, so the check has to look beyond what is sent.
test('a token that the cut of the sent text splits in half is still caught', async () => {
  const token = `sk-${'k'.repeat(40)}`
  const prefix = `${'a'.repeat(1000)} ${token}${'b'.repeat(5985)}`
  const sent = prefix.slice(-6000)
  assert.ok(sent.includes('k'.repeat(15)) && !sent.includes(token), 'the sent text holds only the end of the token')
  assert.equal(findSecret(sent), null, 'and that part alone looks like nothing')
  const counter = { calls: 0 }
  assert.equal(await complete(openai, { ...ctx, prefix }, AbortSignal.timeout(1000), okFetch(counter)), '')
  assert.equal(counter.calls, 0)
})

test('the body of a long key is caught even when its first line is far out of sight', async () => {
  const body = `${'Q'.repeat(64)}\n`.repeat(200)
  const prefix = `-----BEGIN PRIVATE KEY-----\n${body}`
  const sent = prefix.slice(-6000)
  assert.ok(!sent.includes('BEGIN'), 'the marker is not in what is sent')
  const counter = { calls: 0 }
  assert.equal(await complete(openai, { ...ctx, prefix }, AbortSignal.timeout(1000), okFetch(counter)), '')
  assert.equal(counter.calls, 0)
})
