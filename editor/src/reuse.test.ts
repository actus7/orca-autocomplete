import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remainder } from './reuse.ts'

const offered = { offset: 14, text: 'alpha + beta;' }

test('the rest of a suggestion is reused once its beginning was typed or accepted', () => {
  assert.equal(remainder(offered, 14 + 5, 'alpha'), ' + beta;')
  assert.equal(remainder(offered, 14 + 1, 'a'), 'lpha + beta;')
  assert.equal(remainder(offered, 14 + 12, 'alpha + beta'), ';')
})

test('nothing is reused when the person typed something else', () => {
  assert.equal(remainder(offered, 14 + 5, 'alpHa'), null)
  assert.equal(remainder(offered, 14 + 3, 'xyz'), null)
})

test('nothing is reused when the cursor did not move forward, or the whole suggestion is already there', () => {
  assert.equal(remainder(offered, 14, ''), null, 'cursor where it was offered')
  assert.equal(remainder(offered, 9, ''), null, 'cursor moved back')
  assert.equal(remainder(offered, 14 + 13, 'alpha + beta;'), null, 'all of it typed')
  assert.equal(remainder(offered, 14 + 20, 'alpha + beta;xxxxxxx'), null, 'typed past the end')
})

// Why: with CRLF line ends the file holds two characters for a newline the suggestion holds one of, so
// the lengths cannot be compared; a new request is the safe answer.
test('a mismatch of lengths (as with CRLF) means a new request, never a wrong remainder', () => {
  const multiline = { offset: 0, text: 'foo(\n  a\n)' }
  assert.equal(remainder(multiline, 5, 'foo(\r\n'), null)
})
