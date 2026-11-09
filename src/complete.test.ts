import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRequest,
  cleanSuggestion,
  trimSuffixOverlap,
  complete,
  extractText,
  isProse,
  looksInjected,
  parseFormat,
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

const ollama: Provider = { ...openai, format: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' }
const mistral: Provider = { ...openai, format: 'mistral-fim', baseUrl: 'https://api.mistral.ai/v1', model: 'codestral-latest' }
const bodyOf = (built: ReturnType<typeof buildRequest>): Record<string, any> => JSON.parse(built.init.body) // eslint-disable-line @typescript-eslint/no-explicit-any

test('ollama is asked through its own API, with the text before and after the cursor as separate fields', () => {
  const built = buildRequest(ollama, ctx)
  assert.equal(built.url, 'http://localhost:11434/api/generate')
  assert.deepEqual(bodyOf(built), {
    model: 'm',
    prompt: 'const x = ',
    suffix: ';\n',
    stream: false,
    options: { num_predict: 64, temperature: 0.2 }
  })
  assert.equal('authorization' in built.init.headers, false, 'no key, no header')
  assert.equal(buildRequest({ ...ollama, apiKey: 'k' }, ctx).init.headers.authorization, 'Bearer k')
})

test('the ollama address works whether or not the person gave the /v1 root, with or without a slash', () => {
  for (const base of ['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/v1', 'http://localhost:11434/v1/']) {
    assert.equal(buildRequest({ ...ollama, baseUrl: base }, ctx).url, 'http://localhost:11434/api/generate', base)
  }
})

test('mistral fill-in-the-middle sends the prompt and suffix to /v1/fim/completions with a bearer key', () => {
  const built = buildRequest(mistral, ctx)
  assert.equal(built.url, 'https://api.mistral.ai/v1/fim/completions')
  assert.equal(buildRequest({ ...mistral, baseUrl: 'https://api.mistral.ai' }, ctx).url, 'https://api.mistral.ai/v1/fim/completions')
  assert.equal(built.init.headers.authorization, 'Bearer k')
  assert.deepEqual(bodyOf(built), {
    model: 'codestral-latest',
    prompt: 'const x = ',
    suffix: ';\n',
    max_tokens: 64,
    temperature: 0.2,
    stream: false
  })
})

test('the fill-in-the-middle formats send only the window around the cursor, and the chat formats send no temperature', () => {
  const long = { ...ctx, prefix: `${'p'.repeat(7000)}`, suffix: `${'s'.repeat(3000)}` }
  for (const provider of [ollama, mistral]) {
    const body = bodyOf(buildRequest(provider, long))
    assert.equal(body.prompt.length, 6000)
    assert.equal(body.suffix.length, 2000)
  }
  assert.equal('temperature' in bodyOf(buildRequest(openai, ctx)), false)
  assert.equal('temperature' in bodyOf(buildRequest(anthropic, ctx)), false)
})

test('writing in a document still limits how much a fill-in-the-middle model writes', () => {
  assert.equal(bodyOf(buildRequest(ollama, prose)).options.num_predict, 48)
  assert.equal(bodyOf(buildRequest(mistral, prose)).max_tokens, 48)
  assert.equal(bodyOf(buildRequest({ ...ollama, maxTokens: 16 }, prose)).options.num_predict, 16)
})

test('the text of each answer is read from where its format puts it', () => {
  assert.equal(extractText('ollama', { response: 'a + b;', done: true }), 'a + b;')
  assert.equal(extractText('ollama', { response: 5 }), '')
  assert.equal(extractText('mistral-fim', { choices: [{ message: { content: 'a + b;' } }] }), 'a + b;')
  assert.equal(extractText('mistral-fim', { response: 'nope' }), '')
})

test('a fill-in-the-middle answer goes through the same clean-up as any other', async () => {
  const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ response: 'const x = 42;\n' }), text: async () => '' })
  // The model repeated what is before the cursor ('const x = '): that repeat is cut, the rest is kept.
  assert.equal(await complete(ollama, ctx, AbortSignal.timeout(1000), fetchImpl), '42;'+String.fromCharCode(10))
})

test('parseFormat accepts the four formats and turns anything else into the chat format', () => {
  assert.deepEqual(['openai', 'anthropic', 'ollama', 'mistral-fim'].map(parseFormat), ['openai', 'anthropic', 'ollama', 'mistral-fim'])
  assert.deepEqual([undefined, null, 'x', 3].map(parseFormat), ['openai', 'openai', 'openai', 'openai'])
})

test('nothing is sent when the cursor sits inside a token, though neither side holds enough of it', async () => {
  const counter = { calls: 0 }
  const input = { ...ctx, prefix: `const key = "sk-${'a'.repeat(12)}`, suffix: `${'a'.repeat(12)}";` }
  assert.equal(await complete(openai, input, AbortSignal.timeout(1000), okFetch(counter)), '')
  assert.equal(counter.calls, 0)
})

test('declarations from other files are given to a chat model before the file, and only when there are some', () => {
  const related = 'function add(a: number, b: number): number  // src/math.ts'
  const withRelated = bodyOf(buildRequest(openai, { ...ctx, related })) as { messages: { content: string }[] }
  const user = withRelated.messages[1].content
  assert.ok(user.includes(related))
  assert.ok(user.indexOf(related) < user.indexOf('File: src/a.ts'), 'before the file')
  assert.ok(user.indexOf('File: src/a.ts') < user.indexOf('<CURSOR>'))
  const without = bodyOf(buildRequest(openai, ctx)) as { messages: { content: string }[] }
  assert.ok(!without.messages[1].content.includes('Declarations from other files'))
})

test('the declarations given to the model are capped', () => {
  const long = 'x'.repeat(10_000)
  const sent = (bodyOf(buildRequest(openai, { ...ctx, related: long })) as { messages: { content: string }[] }).messages[1].content
  assert.ok(sent.length < 3500, `${sent.length} characters`)
})

test('nothing is sent when the declarations from other files hold a secret', async () => {
  const counter = { calls: 0 }
  const related = `const key = "sk-${'a'.repeat(30)}"  // src/config.ts`
  assert.equal(await complete(openai, { ...ctx, related }, AbortSignal.timeout(1000), okFetch(counter)), '')
  assert.equal(counter.calls, 0)
})

test('an answer made of tool-call markup is dropped instead of being shown as a suggestion', async () => {
  const answering = (content: string): FetchLike => async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => ''
  })
  const signal = AbortSignal.timeout(1000)
  for (const markup of ['<tool_call>\n<function=Read>\n<parameter=file_path>\na.ts\n</parameter>', 'x = 1 <function=Read> y', 'ok </tool_call>']) {
    assert.equal(await complete(openai, ctx, signal, answering(markup)), '', markup)
    assert.equal(looksInjected(markup), true)
  }
  // Ordinary code, even code about functions and parameters, is kept.
  assert.equal(await complete(openai, ctx, signal, answering('parameters.function = a < b')), 'parameters.function = a < b')
  assert.equal(looksInjected('const f = <T>(x: T) => x'), false)
})
