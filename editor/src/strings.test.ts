import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EDITOR_STRINGS, say, type EditorKey } from './strings.ts'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('Portuguese has every editor string English has, with the same placeholders', () => {
  for (const key of Object.keys(EDITOR_STRINGS.en) as EditorKey[]) {
    assert.ok(EDITOR_STRINGS.pt[key].length > 0, `pt is missing ${key}`)
    assert.deepEqual(placeholders(EDITOR_STRINGS.pt[key]), placeholders(EDITOR_STRINGS.en[key]), key)
  }
})

test('say follows the language of the page and fills placeholders', () => {
  const page = globalThis as { orca?: { locale: string } }
  try {
    page.orca = { locale: 'pt-BR' }
    assert.equal(say('rename.nothing'), 'Nada para renomear aqui.')
    assert.match(say('rename.otherFiles', { count: 3 }), /mudaria 3 outro/)
    page.orca = { locale: 'en-US' }
    assert.equal(say('rename.nothing'), 'Nothing to rename here.')
  } finally {
    delete page.orca
  }
})

// Why: the start failure is worded with `say`, and a page opened outside Orca has no `orca` at all.
test('say answers in English when there is no orca object', () => {
  assert.equal(say('start.failed'), 'Autocomplete could not start')
})
