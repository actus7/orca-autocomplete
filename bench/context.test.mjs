import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { describe, namesNear, relatedFor } from './context.mjs'

/** An index with the columns the experiment reads, filled with a few declarations and calls. */
function graph() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE nodes (id TEXT, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
    CREATE TABLE edges (source TEXT, target TEXT, kind TEXT, line INTEGER);
  `)
  const node = (id, kind, name, file, start, end, signature = null, docstring = null, exported = 1) =>
    db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, kind, name, file, start, end, signature, docstring, exported)
  const call = (source, target, line) => db.prepare("INSERT INTO edges VALUES (?, ?, 'calls', ?)").run(source, target, line)
  // The file being completed: one function, from line 10 to 30.
  node('f:run', 'function', 'run', 'src/a.ts', 10, 30)
  node('f:local', 'function', 'localHelper', 'src/a.ts', 1, 5, '(): void')
  // Declarations elsewhere.
  node('f:add', 'function', 'add', 'src/math.ts', 1, 3, '(a: number, b: number): number', 'Adds two numbers.\nMore detail.')
  node('f:format', 'function', 'formatMoney', 'src/money.ts', 1, 9, '(value: number): string', 'Formats an amount.')
  node('f:secret', 'function', 'answerOnTheLine', 'src/answer.ts', 1, 2, '(): string')
  node('f:test', 'function', 'add', 'src/math.test.ts', 1, 3, '(): void')
  node('c:Money', 'class', 'Money', 'src/money.ts', 11, 40)
  // What `run` calls: add on line 12 (above the cursor), formatMoney on line 20 (below), answerOnTheLine on line 15.
  call('f:run', 'f:add', 12)
  call('f:run', 'f:format', 20)
  call('f:run', 'f:secret', 15)
  call('f:run', 'f:local', 14)
  return db
}

const text = (lines) => lines.join('\n')
const cutAtLine15 = {
  path: 'src/a.ts',
  prefix: text([...Array(14).fill('// filler'), 'const total = ']),
  suffix: text(['', '  return total', '}'])
}

test('the names near the cursor come nearest first, without keywords and repeats', () => {
  const names = namesNear('const result = compute(price)\nreturn await fetchUser(id, price)', '\n  save(result)\n')
  assert.deepEqual(names.slice(0, 4), ['price', 'fetchUser', 'compute', 'result'])
  assert.ok(!names.includes('const') && !names.includes('return') && !names.includes('await'))
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.includes('save'), 'names after the cursor count too')
})

test('what the function being written already calls in other files is listed', () => {
  const related = relatedFor(graph(), cutAtLine15)
  assert.match(related, /function add\(a: number, b: number\): number {2}\/\/ src\/math\.ts - Adds two numbers\./)
  assert.match(related, /function formatMoney\(value: number\): string {2}\/\/ src\/money\.ts/)
})

// Why: the code being predicted is in the same file and in the index; using it would measure nothing.
test('a call on the line being predicted is never used, nor anything from the file being completed', () => {
  const related = relatedFor(graph(), cutAtLine15)
  assert.ok(!related.includes('answerOnTheLine'), 'the call on the cursor line leaked')
  assert.ok(!related.includes('localHelper'), 'something from the same file was returned')
  assert.ok(!related.includes('src/a.ts'))
})

test('a name near the cursor is looked up, but test files are left out', () => {
  const cut = { path: 'src/b.ts', prefix: 'const m = new Money()\nconst n = add(', suffix: ')' }
  const related = relatedFor(graph(), cut)
  assert.match(related, /class Money {2}\/\/ src\/money\.ts/)
  assert.match(related, /function add\(/)
  assert.ok(!related.includes('math.test.ts'))
})

test('nothing is returned when nothing near the cursor is declared elsewhere', () => {
  assert.equal(relatedFor(graph(), { path: 'src/c.ts', prefix: 'const x = 1', suffix: '' }), '')
})

test('the list stops at the number of items and the number of characters it was given', () => {
  const cut = { path: 'src/b.ts', prefix: 'new Money(); add(); formatMoney()', suffix: '' }
  assert.equal(relatedFor(graph(), cut, { maxItems: 2 }).split('\n').length, 2)
  assert.ok(relatedFor(graph(), cut, { maxChars: 80 }).length <= 80)
})

test('a declaration is described on one line with where it lives and what it is for', () => {
  assert.equal(
    describe({ kind: 'function', name: 'add', file_path: 'src/m.ts', signature: '(a: number,\n   b: number): number', docstring: 'Adds.\nMore.' }),
    'function add(a: number, b: number): number  // src/m.ts - Adds.'
  )
  assert.equal(describe({ kind: 'class', name: 'Money', file_path: 'src/m.ts' }), 'class Money  // src/m.ts')
  assert.equal(describe({ kind: 'type_alias', name: 'Id', file_path: 'src/m.ts', signature: 'string' }), 'type Id = string  // src/m.ts')
})

test('a name near the cursor that is declared in the file being completed is not looked up', () => {
  // Line 1 is outside every function of src/a.ts, so only the lookup by name can return something here.
  const related = relatedFor(graph(), { path: 'src/a.ts', prefix: 'const x = localHelper() + add(1, 2)', suffix: '' })
  assert.ok(!related.includes('localHelper'), related)
  assert.match(related, /function add\(/, 'a name from another file is still found')
})
