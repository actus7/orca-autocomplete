import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_PAUSE_MS, Pacer, QUICK_PAUSE_MS, SLOW_PAUSE_MS } from './pacing.ts'

test('the usual wait is used when nothing special happened', () => {
  assert.equal(new Pacer().pause(10_000), BASE_PAUSE_MS)
})

test('the wait is short right after a suggestion was accepted, and goes back to usual', () => {
  const pacer = new Pacer()
  pacer.noteAccepted(1000)
  assert.equal(pacer.pause(1200), QUICK_PAUSE_MS)
  assert.equal(pacer.pause(1000 + 3999), QUICK_PAUSE_MS)
  assert.equal(pacer.pause(1000 + 4001), BASE_PAUSE_MS)
})

test('the wait is long while the person is deleting a lot, and goes back when they stop', () => {
  const pacer = new Pacer()
  pacer.noteChange(true, 100)
  pacer.noteChange(true, 300)
  assert.equal(pacer.pause(400), BASE_PAUSE_MS, 'two deletions are not yet rethinking')
  pacer.noteChange(true, 500)
  assert.equal(pacer.pause(600), SLOW_PAUSE_MS)
  assert.equal(pacer.pause(500 + 1600), BASE_PAUSE_MS)
})

test('typing does not count as deleting, and deleting wins over the flow after an accept', () => {
  const pacer = new Pacer()
  for (let at = 0; at < 10; at += 1) {
    pacer.noteChange(false, at * 50)
  }
  assert.equal(pacer.pause(600), BASE_PAUSE_MS)
  pacer.noteAccepted(600)
  for (const at of [610, 620, 630]) {
    pacer.noteChange(true, at)
  }
  assert.equal(pacer.pause(700), SLOW_PAUSE_MS)
})
