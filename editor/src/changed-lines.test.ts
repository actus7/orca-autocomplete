import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeChange } from './changed-lines.ts'

const before = ['a', 'const total = 1', 'c', 'return total', 'e', 'f', 'g'].join('\n')
const after = before.replace('const total', 'const amount')

test('one changed line is described with the lines around it, numbered from where the excerpt starts', () => {
  assert.deepEqual(describeChange(before, after, 1), {
    startLine: 1,
    text: 'a\nconst amount = 1\nc',
    recent: [{ line: 2, before: 'const total = 1', after: 'const amount = 1' }]
  })
  const wide = describeChange(before, after, 25)!
  assert.equal(wide.startLine, 1)
  assert.equal(wide.text, after, 'the whole text when it is shorter than the margin')
})

test('the excerpt starts at the first line of the text when the change is near it, and ends at the last', () => {
  const edge = describeChange('x\ny', 'x\nz', 5)!
  assert.equal(edge.startLine, 1)
  assert.equal(edge.text, 'x\nz')
})

test('a change in the middle of the text starts the excerpt a margin above it', () => {
  const text = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
  const changed = text.replace('line 30', 'LINE 30')
  const described = describeChange(text, changed, 5)!
  assert.equal(described.startLine, 25)
  assert.equal(described.text.split('\n').length, 11)
  assert.equal(described.recent[0].line, 30)
})

test('two or three adjacent lines changed at once are all reported', () => {
  const edited = before.replace('const total = 1\nc', 'const amount = 1\nC')
  assert.deepEqual(describeChange(before, edited, 0)?.recent, [
    { line: 2, before: 'const total = 1', after: 'const amount = 1' },
    { line: 3, before: 'c', after: 'C' }
  ])
})

test('nothing is described when nothing changed, when lines were added or removed, or when too many lines changed', () => {
  assert.equal(describeChange(before, before, 5), null)
  assert.equal(describeChange(before, before.replace('c\n', 'c\nnew line\n'), 5), null, 'a line added')
  assert.equal(describeChange(before, before.replace('c\nreturn total\n', 'return total\n'), 5), null, 'a line removed')
  const many = before.replace('a\nconst total = 1\nc\nreturn total\ne', 'A\nB\nC\nD\nE')
  assert.equal(describeChange(before, many, 5), null, 'five lines changed')
})
