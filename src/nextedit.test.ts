import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FetchLike, Provider } from './complete.ts'
import { asPredictInput, buildPredictPrompt, parsePrediction, predictEdit, type PredictInput } from './nextedit.ts'

const input: PredictInput = {
  path: 'a.ts',
  languageId: 'typescript',
  startLine: 10,
  text: 'const amount = 1\nreturn total + total\nlog(total)',
  recent: [{ line: 10, before: 'const total = 1', after: 'const amount = 1' }]
}

const answer = (object: unknown): string => JSON.stringify(object)

test('what a page sends is checked and capped before it is used', () => {
  assert.deepEqual(asPredictInput(input), input)
  assert.equal(asPredictInput(null), null)
  assert.equal(asPredictInput({ ...input, text: 5 }), null, 'text that is not a string')
  assert.equal(asPredictInput({ ...input, startLine: 0 }), null, 'a first line before the first')
  assert.equal(asPredictInput({ ...input, startLine: 1.5 }), null)
  assert.equal(asPredictInput({ ...input, recent: 'x' }), null)
  assert.equal(asPredictInput({ ...input, recent: [{ line: 1, before: 'a' }] }), null, 'a change with no after')
  const big = asPredictInput({ ...input, text: 'x'.repeat(20000), recent: Array.from({ length: 9 }, (_, i) => ({ line: i + 1, before: 'b'.repeat(900), after: 'a' })) })
  assert.equal(big?.text.length, 6000)
  assert.equal(big?.recent.length, 3)
  assert.equal(big?.recent[0].before.length, 300)
})

test('the prompt numbers the lines from where the excerpt starts and says what changed', () => {
  const prompt = buildPredictPrompt(input)
  assert.match(prompt, /File: a\.ts \(typescript\)/)
  assert.match(prompt, /- line 10: `const total = 1` became `const amount = 1`/)
  assert.match(prompt, /10\| const amount = 1\n11\| return total \+ total\n12\| log\(total\)/)
})

test('an answer that repeats a line word for word is an edit', () => {
  const edit = parsePrediction(answer({ line: 11, old: 'return total + total', new: 'return amount + total' }), input)
  assert.deepEqual(edit, { line: 11, old: 'return total + total', new: 'return amount + total' })
})

test('an answer wrapped in a fence or a sentence still counts', () => {
  const wrapped = 'Here it is:\n```json\n' + answer({ line: 12, old: 'log(total)', new: 'log(amount)' }) + '\n```'
  assert.equal(parsePrediction(wrapped, input)?.line, 12)
})

test('nothing is an edit when the model asks for nothing or for something that does not hold up', () => {
  assert.equal(parsePrediction('{}', input), null, 'asked for nothing')
  assert.equal(parsePrediction('no json here', input), null)
  assert.equal(parsePrediction('{"line": 11,', input), null, 'broken json')
  assert.equal(parsePrediction(answer({ line: 11, old: 'return total  + total', new: 'x' }), input), null, 'the line was not repeated word for word')
  assert.equal(parsePrediction(answer({ line: 99, old: 'x', new: 'y' }), input), null, 'a line that is not in the excerpt')
  assert.equal(parsePrediction(answer({ line: 9, old: 'x', new: 'y' }), input), null, 'a line before the excerpt')
  assert.equal(parsePrediction(answer({ line: 10, old: 'const amount = 1', new: 'const amount = 2' }), input), null, 'a line the person already changed')
  assert.equal(parsePrediction(answer({ line: 11, old: 'return total + total', new: 'return total + total' }), input), null, 'no change')
  assert.equal(parsePrediction(answer({ line: 11, old: 'return total + total', new: 'a\nb' }), input), null, 'more than one line')
  assert.equal(parsePrediction(answer({ line: '11', old: 'return total + total', new: 'x' }), input), null, 'a line that is not a number')
  assert.equal(parsePrediction(answer({ line: 11, old: 'return total + total', new: 'x'.repeat(501) }), input), null, 'too long')
})

test('a line that ends with a carriage return still matches', () => {
  const windows = { ...input, text: 'a\r\nreturn total\r\nb' , recent: [{ line: 10, before: 'x', after: 'a' }] }
  assert.equal(parsePrediction(answer({ line: 11, old: 'return total', new: 'return amount' }), windows)?.line, 11)
})

const provider = (format: Provider['format']): Provider => ({ format, baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k', maxTokens: 96 })
const fetchOf = (body: unknown, calls: { url: string; body: string }[] = []): FetchLike => async (url, init) => {
  calls.push({ url, body: init.body })
  return { ok: true, status: 200, json: async () => body, text: async () => '' }
}
const chat = (content: string) => ({ choices: [{ message: { content } }] })
const signal = new AbortController().signal

test('a chat provider is asked once and its answer becomes an edit', async () => {
  const calls: { url: string; body: string }[] = []
  const edit = await predictEdit(provider('openai'), input, signal, fetchOf(chat(answer({ line: 12, old: 'log(total)', new: 'log(amount)' })), calls))
  assert.equal(edit?.new, 'log(amount)')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/chat\/completions$/)
  assert.match(calls[0].body, /"max_tokens":200/)
})

test('the Anthropic format is used for an Anthropic provider', async () => {
  const calls: { url: string; body: string }[] = []
  await predictEdit(provider('anthropic'), input, signal, fetchOf({ content: [{ type: 'text', text: '{}' }] }, calls))
  assert.match(calls[0].url, /\/v1\/messages$/)
})

test('a provider that only fills in the middle is never asked, and nothing is asked when nothing changed', async () => {
  const calls: { url: string; body: string }[] = []
  assert.equal(await predictEdit(provider('ollama'), input, signal, fetchOf({}, calls)), null)
  assert.equal(await predictEdit(provider('mistral-fim'), input, signal, fetchOf({}, calls)), null)
  assert.equal(await predictEdit(provider('openai'), { ...input, recent: [] }, signal, fetchOf({}, calls)), null)
  assert.equal(calls.length, 0)
})

test('nothing is sent when the excerpt or a change holds a secret, even a secret the person just deleted', async () => {
  const calls: { url: string; body: string }[] = []
  const secret = 'sk-' + 'a1B2c3D4'.repeat(6)
  assert.equal(await predictEdit(provider('openai'), { ...input, text: `const k = "${secret}"\nreturn total` }, signal, fetchOf(chat('{}'), calls)), null)
  const deleted = { ...input, recent: [{ line: 10, before: `const k = "${secret}"`, after: 'const k = ""' }] }
  assert.equal(await predictEdit(provider('openai'), deleted, signal, fetchOf(chat('{}'), calls)), null)
  assert.equal(calls.length, 0, 'no request was made')
})

test('an answer made of tool-call markup is dropped, and an HTTP error is reported with its status only', async () => {
  // Why a valid edit inside: otherwise the check of the line would reject it anyway and this guard would prove nothing.
  const markup = `<tool_call><function=Edit>${answer({ line: 11, old: 'return total + total', new: 'return amount + total' })}</function></tool_call>`
  assert.equal(await predictEdit(provider('openai'), input, signal, fetchOf(chat(markup))), null)
  const failing: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'secret body' })
  await assert.rejects(predictEdit(provider('openai'), input, signal, failing), (error: Error) => error.message === 'provider answered HTTP 429')
})
