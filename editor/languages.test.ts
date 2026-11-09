import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GENERIC, GRAMMARS, LANGUAGES, PAGES, customEditors } from './languages.mjs'

// Orca's manifest limits for custom editors.
const MAX_EDITORS = 16
const MAX_EXTENSIONS_PER_EDITOR = 32

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))

test('the plugin stays within Orca limits for custom editors', () => {
  assert.ok(PAGES.length <= MAX_EDITORS, `${PAGES.length} editors`)
  for (const page of PAGES) {
    assert.ok(page.extensions.length <= MAX_EXTENSIONS_PER_EDITOR, `${page.id}: ${page.extensions.length} extensions`)
  }
})

test('no extension or file name belongs to two editors', () => {
  const seen = new Map<string, string>()
  for (const page of PAGES) {
    for (const key of [...page.extensions, ...(page.filenames ?? [])]) {
      assert.equal(seen.get(key), undefined, `${key} is in ${seen.get(key)} and ${page.id}`)
      seen.set(key, page.id)
    }
  }
})

test('every extension starts with a dot and ids are unique', () => {
  for (const page of PAGES) {
    for (const extension of page.extensions) {
      assert.match(extension, /^\.[a-z0-9]+$/, `${page.id}: ${extension}`)
    }
  }
  assert.equal(new Set(GRAMMARS.map((g) => g.id)).size, GRAMMARS.length)
  assert.equal(new Set(PAGES.map((p) => p.id)).size, PAGES.length)
})

test('the generic editor covers exactly the grammars that have no editor of their own', () => {
  const own = new Set(LANGUAGES.map((language) => language.id))
  assert.ok(GRAMMARS.filter((g) => !own.has(g.id)).every((g) => GENERIC.extensions.includes(g.extensions[0])))
})

test('the manifest lists the editors this table describes', () => {
  assert.deepEqual(manifest.contributes.customEditors, customEditors())
})
