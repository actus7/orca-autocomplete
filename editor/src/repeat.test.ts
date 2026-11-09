import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextOccurrence, renameBetween, repeatRename } from './repeat.ts'

const code = 'const total = 1\nreturn total + total\n'

test('a name that became another name is a rename', () => {
  const renamed = code.replace('const total', 'const amount')
  assert.deepEqual(renameBetween(code, renamed), { rename: { from: 'total', to: 'amount' }, at: 6 })
})

test('typing a name over another one, a letter at a time, ends as the same rename', () => {
  // The baseline is the text before the first keystroke and the current text after the last one.
  const typed = code.replace('const total', 'const sum')
  assert.deepEqual(renameBetween(code, typed)?.rename, { from: 'total', to: 'sum' })
})

test('a rename that only adds to a name counts, so a plural can be carried to the other places', () => {
  assert.deepEqual(renameBetween('use user here', 'use users here')?.rename, { from: 'user', to: 'users' })
})

test('nothing is a rename when the change is not one name becoming another', () => {
  assert.equal(renameBetween(code, code), null, 'no change')
  assert.equal(renameBetween('foo(a)', 'foo(a, b)'), null, 'an argument added')
  assert.equal(renameBetween('let x = 1', 'let x = 12'), null, 'a number changed')
  assert.equal(renameBetween('a  b', 'a b'), null, 'whitespace')
  assert.equal(renameBetween('const id = 1', 'const idx = 1'), null, 'a name of fewer than three letters')
  assert.equal(renameBetween('x = 1abc', 'x = abc'), null, 'the old text was not a name (it starts with a digit)')
})

test('the next place is the nearest whole-word use at or after the cursor, wrapping to the last one before it', () => {
  const renamed = code.replace('const total', 'const amount')
  const rename = { from: 'total', to: 'amount' }
  const first = nextOccurrence(renamed, rename, renamed.indexOf('const amount') + 12)
  assert.deepEqual(first, { start: renamed.indexOf('total'), end: renamed.indexOf('total') + 5, text: 'amount' })
  const afterFirst = nextOccurrence(renamed, rename, renamed.indexOf('total') + 5)
  assert.equal(afterFirst?.start, renamed.lastIndexOf('total'))
  // Past the last one: wraps to the last one, never invents a place.
  assert.equal(nextOccurrence(renamed, rename, renamed.length)?.start, renamed.lastIndexOf('total'))
})

test('part of a longer name is not the name', () => {
  const rename = { from: 'total', to: 'amount' }
  assert.equal(nextOccurrence('subtotal totals total_ $total', rename, 0), null)
  assert.equal(nextOccurrence('a total.', rename, 0)?.start, 2)
})

test('nothing is proposed when the old name is not used anywhere else', () => {
  const renamed = 'const amount = 1\nreturn amount\n'
  assert.equal(repeatRename('const total = 1\nreturn amount\n', renamed, 0), null)
})

test('a rename with another use left gives the edit that finishes it', () => {
  const renamed = code.replace('const total', 'const amount')
  const proposal = repeatRename(code, renamed, 0)
  assert.deepEqual(proposal?.rename, { from: 'total', to: 'amount' })
  assert.equal(renamed.slice(proposal!.edit.start, proposal!.edit.end), 'total')
  assert.equal(proposal!.edit.text, 'amount')
})

test('letters of other scripts and $ are part of a name', () => {
  assert.deepEqual(renameBetween('use $valor aqui', 'use $total aqui')?.rename, { from: '$valor', to: '$total' })
  assert.deepEqual(renameBetween('use preço aqui', 'use custo aqui')?.rename, { from: 'preço', to: 'custo' })
})
