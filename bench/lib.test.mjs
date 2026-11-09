import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareRuns, isCodePlace, levenshtein, looksPolluted, mulberry32, pickCuts, score, signTestP, similarity } from './lib.mjs'

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
  const text = 'callIt(argumentNumberOneArgumentNumberTwoArgumentNumberThree);\n'
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

test('the sign test says a lopsided split is unlikely by chance and an even one is not', () => {
  assert.equal(signTestP(0, 0), 1)
  assert.equal(signTestP(5, 5), 1)
  assert.ok(signTestP(10, 0) < 0.002)
  assert.ok(Math.abs(signTestP(8, 2) - 0.109375) < 1e-9)
  assert.equal(signTestP(2, 8), signTestP(8, 2))
})

test('two runs are compared place by place, over the places both answered', () => {
  const run = (items) => ({ results: items })
  const a = run([
    { exact: false, similarity: 0.2 },
    { exact: true, similarity: 1 },
    { exact: false, similarity: 0.5 },
    { error: 'TimeoutError' },
    { exact: false, similarity: 0.4 }
  ])
  const b = run([
    { exact: true, similarity: 1 },
    { exact: false, similarity: 0.6 },
    { exact: false, similarity: 0.52 },
    { exact: true, similarity: 1 },
    { error: 'TimeoutError' }
  ])
  const result = compareRuns(a, b)
  assert.equal(result.compared, 3, 'places where either run failed are left out')
  assert.deepEqual([result.wins, result.losses, result.ties], [1, 1, 1], '0.52 against 0.5 is noise')
  assert.deepEqual([result.exactGained, result.exactLost], [1, 1])
  assert.equal(result.exactA, 1)
  assert.equal(result.exactB, 1)
})

test('a place is only chosen inside code: not in a comment, not inside a string, and with code after it', () => {
  assert.equal(isCodePlace('  const total = add(a, b)', 15), true)
  assert.equal(isCodePlace('  // the total is added here and there', 12), false, 'a line comment')
  assert.equal(isCodePlace('   * a doc comment line with (parens)', 10), false, 'a block comment')
  assert.equal(isCodePlace("  const label = 'Paste your key here'", 22), false, 'inside single quotes')
  assert.equal(isCodePlace('  const label = "Paste your key here"', 22), false, 'inside double quotes')
  assert.equal(isCodePlace('  const label = `Total ${price} due`', 22), false, 'inside a template string')
  assert.equal(isCodePlace("  const label = 'a' + add(x, y)", 21), true, 'after a closed string')
  assert.equal(isCodePlace("  const label = 'it" + String.fromCharCode(92) + "'s' + add(x)", 25), true, 'an escaped quote does not open a string')
  assert.equal(isCodePlace('  return something', 9), false, 'only a name is left')
})

test('every place picked is inside code', () => {
  const LF = String.fromCharCode(10)
  const code = 'const total = add(first, second) + multiply(third, fourth)'
  const source = [{ path: 'a.ts', text: ['// a comment that is long enough to be a candidate line', "const label = 'a text that is long enough to be a candidate'", code, ''].join(LF) }]
  const cuts = pickCuts(source, 30, 4)
  assert.ok(cuts.length > 0)
  for (const cut of cuts) {
    assert.equal(cut.prefix.split(LF).pop() + cut.expected, code, 'a comment or a string was chosen')
  }
})

test('an answer carrying a gateway’s own instructions is recognised, and ordinary code is not', () => {
  assert.equal(looksPolluted('<tool_call>\n<function=Read>'), true)
  assert.equal(looksPolluted('import x from "y": ponytail: use native, add config when'), true)
  assert.equal(looksPolluted('a + b; // skipped: none'), true)
  assert.equal(looksPolluted('const skippedCount = items.filter(isSkipped).length'), false)
  assert.equal(looksPolluted('return add(a, b)'), false)
})

test('places where either answer carried a gateway’s own text can be left out of a comparison', () => {
  const a = { results: [{ exact: false, similarity: 0.2 }, { exact: false, similarity: 0.2, polluted: true }, { exact: false, similarity: 0.2 }] }
  const b = { results: [{ exact: false, similarity: 0.9 }, { exact: false, similarity: 0.9 }, { exact: false, similarity: 0.9, polluted: true }] }
  assert.equal(compareRuns(a, b).compared, 3)
  assert.equal(compareRuns(a, b, { skipPolluted: true }).compared, 1)
})
