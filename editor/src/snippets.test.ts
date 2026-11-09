import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRAMMARS } from '../languages.mjs'
import { POSTFIX } from './postfix.ts'
import { SNIPPETS, snippetProblem } from './snippets.ts'

test('the checker knows a good body from a broken one', () => {
  assert.equal(snippetProblem('if (${1:condition}) {\n\t$0\n}'), null)
  assert.equal(snippetProblem('foreach (${1:\\$items} as ${2:\\$item})'), null, 'an escaped $ in a default is fine')
  assert.equal(snippetProblem('cost: \\$5 $0'), null)
  assert.equal(snippetProblem('echo $USER'), 'a bare $', 'a variable name is not a stop')
  assert.equal(snippetProblem('price $'), 'a bare $')
  assert.equal(snippetProblem('${1:$items}'), 'an unescaped $ in a default value')
  assert.equal(snippetProblem('a $0 b $0'), 'more than one $0')
  assert.equal(snippetProblem('${1:name'), 'an unclosed stop')
})

test('every snippet is well formed, has a unique prefix in its language and says what it is', () => {
  for (const [language, snippets] of Object.entries(SNIPPETS)) {
    assert.equal(new Set(snippets.map((snippet) => snippet.prefix)).size, snippets.length, `${language} repeats a prefix`)
    for (const snippet of snippets) {
      assert.ok(snippet.detail.length > 0, `${language}.${snippet.prefix} has no description`)
      assert.equal(snippetProblem(snippet.body), null, `${language}.${snippet.prefix}: ${snippetProblem(snippet.body)}`)
    }
  }
})

test('a snippet word is a plain word, so typing it can match it', () => {
  for (const [language, snippets] of Object.entries(SNIPPETS)) {
    for (const snippet of snippets) {
      assert.match(snippet.prefix, /^\w+$/, `${language}.${snippet.prefix}`)
    }
  }
})

test('only languages the editor opens have snippets or postfix templates', () => {
  const known = new Set(GRAMMARS.map((grammar) => grammar.id))
  for (const language of [...Object.keys(SNIPPETS), ...Object.keys(POSTFIX)]) {
    assert.ok(known.has(language), `${language} is not a language of the editor`)
  }
})
