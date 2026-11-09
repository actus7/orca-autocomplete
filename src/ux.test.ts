import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProviderHttpError } from './complete.ts'
import { explainFailure } from './explain.ts'
import { KEYS, pickLocale, translate, translator } from './i18n.ts'
import { presetFor } from './presets.ts'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('Portuguese has every string English has, with the same placeholders', () => {
  for (const key of KEYS) {
    const pt = translate('pt', key)
    assert.ok(pt.length > 0, `pt is missing ${key}`)
    assert.deepEqual(placeholders(pt), placeholders(translate('en', key)), key)
  }
})

test('pickLocale chooses Portuguese for any pt tag and English otherwise', () => {
  assert.equal(pickLocale('pt-BR'), 'pt')
  assert.equal(pickLocale('pt'), 'pt')
  assert.equal(pickLocale('PT-pt'), 'pt')
  assert.equal(pickLocale('en-US'), 'en')
  assert.equal(pickLocale('es'), 'en')
  assert.equal(pickLocale('pty'), 'en')
  assert.equal(pickLocale(null), 'en')
})

test('translate fills placeholders and leaves unknown ones visible', () => {
  assert.equal(translate('en', 'err.server', { status: 503 }), 'The provider had a problem (HTTP 503). Try again in a moment.')
  assert.equal(translate('en', 'err.server'), 'The provider had a problem (HTTP {status}). Try again in a moment.')
})

test('presetFor finds known providers, ignoring a trailing slash and case', () => {
  assert.equal(presetFor('openai', 'https://api.openai.com/v1/').id, 'openai')
  assert.equal(presetFor('anthropic', 'HTTPS://api.anthropic.com').id, 'anthropic')
  assert.equal(presetFor('openai', 'http://localhost:11434/v1').id, 'ollama')
})

test('presetFor falls back to the custom preset of the same format', () => {
  assert.equal(presetFor('openai', 'https://9router.example/v1').id, 'custom-openai')
  assert.equal(presetFor('anthropic', 'https://proxy.example').id, 'custom-anthropic')
  // Why: the same URL under the other format is not the same provider.
  assert.equal(presetFor('anthropic', 'https://api.openai.com/v1').id, 'custom-anthropic')
})

test('explainFailure says what to do for each kind of failure', () => {
  const t = translator('en')
  const explain = (error: unknown, host = 'api.example.com') => explainFailure(error, t, host, 15_000)
  assert.match(explain(new ProviderHttpError(401)), /rejected the key/)
  assert.match(explain(new ProviderHttpError(403)), /rejected the key/)
  assert.match(explain(new ProviderHttpError(404)), /Model or address not found/)
  assert.match(explain(new ProviderHttpError(429)), /Rate limit/)
  assert.match(explain(new ProviderHttpError(503)), /HTTP 503/)
  assert.match(explain(new ProviderHttpError(418)), /answered HTTP 418/)
  assert.match(explain(new DOMException('x', 'TimeoutError')), /No answer in 15 s/)
  assert.match(explain(new TypeError('fetch failed')), /Could not reach api\.example\.com\. Check/)
  assert.match(explain(new TypeError('fetch failed'), 'localhost:11434'), /Is the server running/)
  assert.equal(explain(new Error('odd')), 'odd')
})
