import assert from 'node:assert/strict'
import { test } from 'node:test'
import { levenshtein, mulberry32, pickCuts, score, similarity } from './lib.mjs'

const files = [
  { path: 'a.ts', text: 'export function total(items: number[]): number {\n  return items.reduce((sum, item) => sum + item, 0)\n}\n' },
  { path: 'b.ts', text: 'const label = `Total: ${format(value)}`\nconsole.log(label)\n' }
]

test('the same seed gives the same places, and another seed gives others', () => {
  assert.deepEqual(pickCuts(files, 10, 1), pickCuts(files, 10, 1))
  assert.notDeepEqual(pickCuts(files, 10, 1), pickCuts(files, 10, 2))
  const random = mulberry32(7)
  assert.ok([random(), random(), random()].every((n) => n >= 0 && n < 1))
})

// Why: if the answer leaked into the code after the cursor, a model could copy it and the numbers would mean nothing.
test('each place keeps the answer out of what the model is given', () => {
  for (const cut of pickCuts(files, 30, 3)) {
    const file = files.find((f) => f.path === cut.path)
    assert.equal(cut.prefix + cut.expected + cut.suffix, file.text)
    assert.ok(cut.expected.length > 0)
    assert.ok(!cut.expected.includes('\n'))
    assert.ok(cut.suffix === '' || cut.suffix.startsWith('\n'))
  }
})

// Why: with no word boundary after the cut, the cut used to slide to the end of the line, leaving nothing
// to predict; a model that answered with nothing then scored as exactly right.
test('a cut never leaves an empty rest of the line, even when no word boundary follows it', () => {
  const text = 'export const verylongidentifiernamewithnoboundaries\n'
  const cuts = pickCuts([{ path: 'long.ts', text }], 40, 5)
  assert.equal(cuts.length, 40)
  for (const cut of cuts) {
    assert.ok(cut.expected.trim().length > 0, JSON.stringify(cut.expected))
    assert.equal(cut.prefix + cut.expected + cut.suffix, text)
  }
})

test('no place is picked from files without a line long enough to continue', () => {
  assert.deepEqual(pickCuts([{ path: 'tiny.ts', text: 'a\nb\n' }], 5, 1), [])
})

test('edit distance and similarity', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3)
  assert.equal(levenshtein('', 'abc'), 3)
  assert.equal(similarity('same', 'same'), 1)
  assert.equal(similarity('', ''), 1)
  assert.equal(similarity('abcd', 'wxyz'), 0)
  assert.equal(similarity('abcd', 'abcx'), 0.75)
})

test('score compares only the first line and ignores trailing spaces', () => {
  assert.deepEqual(score('a + b;  \nnext line', 'a + b;'), { exact: true, similarity: 1, empty: false })
  assert.equal(score('a - b;', 'a + b;').exact, false)
  assert.equal(score('   ', 'a + b;').empty, true)
})
