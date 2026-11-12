import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GENERIC, GRAMMARS, LANGUAGES, PAGES, customEditors } from './languages.mjs'

// Orca's manifest limits for custom editors.
const MAX_EDITORS = 16
const MAX_EXTENSIONS_PER_EDITOR = 32
// The catalog lists an editor with its extensions as one text of at most this many characters; a
// longer one makes the whole listing entry mismatch the manifest. Orca's catalog schema says so:
// `detail: z.string().max(160)` in src/shared/plugins/contributions/plugin-contribution-summary.ts.
const MAX_LISTING_DETAIL_CHARS = 160

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))

test('the plugin stays within Orca limits for custom editors', () => {
  assert.ok(PAGES.length <= MAX_EDITORS, `${PAGES.length} editors`)
  for (const page of PAGES) {
    assert.ok(page.extensions.length <= MAX_EXTENSIONS_PER_EDITOR, `${page.id}: ${page.extensions.length} extensions`)
  }
})

test('the listing text of every editor fits the catalog limit', () => {
  for (const page of PAGES) {
    const detail = [...page.extensions, ...(page.filenames ?? [])].join(', ')
    assert.ok(detail.length <= MAX_LISTING_DETAIL_CHARS, `${page.id}: ${detail.length} characters`)
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
  // Dockerfile is matched by its name alone (the listing limit left `.dockerfile` out).
  const opens = (g: (typeof GRAMMARS)[number]) =>
    g.extensions.length ? GENERIC.extensions.includes(g.extensions[0]) : g.filenames?.some((name: string) => GENERIC.filenames?.includes(name))
  assert.ok(GRAMMARS.filter((g) => !own.has(g.id)).every(opens))
})

test('a grammar the plugin brings itself registers the id and the extensions of the table', () => {
  // LaTeX is the one Monaco does not ship: it lives in editor/grammars and the loader points there.
  const own = GRAMMARS.filter((language) => existsSync(new URL(`./grammars/${language.dir}`, import.meta.url)))
  assert.ok(own.length > 0, 'no grammar of our own is loaded')
  for (const language of own) {
    const source = readFileSync(new URL(`./grammars/${language.dir}/${language.dir}.contribution.ts`, import.meta.url), 'utf8')
    assert.match(source, new RegExp(`id\\s*=\\s*'${language.id}'`), `${language.id}: the file names another language`)
    for (const extension of language.extensions) {
      assert.ok(source.includes(`'${extension}'`), `${language.id}: ${extension} is registered nowhere`)
    }
  }
})

test('the manifest lists the editors this table describes', () => {
  assert.deepEqual(manifest.contributes.customEditors, customEditors())
})
