import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bump, emptyStats, isStats, percentile, summarize, withLatency } from './metrics.ts'

test('bump counts one event for one model and leaves the others alone', () => {
  let stats = emptyStats(1)
  stats = bump(stats, 'a|m', 'shown')
  stats = bump(stats, 'a|m', 'shown')
  stats = bump(stats, 'a|m', 'accepted')
  stats = bump(stats, 'b|n', 'stale')
  assert.equal(summarize(stats, 'a|m').shown, 2)
  assert.equal(summarize(stats, 'a|m').accepted, 1)
  assert.equal(summarize(stats, 'b|n').stale, 1)
  assert.equal(summarize(stats, 'b|n').shown, 0)
})

test('updates return a new object and never change the one they were given', () => {
  const before = emptyStats(1)
  const after = bump(before, 'a|m', 'shown')
  assert.deepEqual(before.models, {})
  assert.notEqual(after, before)
})

test('latency keeps the newest 50 samples', () => {
  let stats = emptyStats(1)
  for (let ms = 1; ms <= 60; ms += 1) {
    stats = withLatency(stats, 'a|m', ms)
  }
  const summary = summarize(stats, 'a|m')
  assert.equal(summary.samples, 50)
  assert.equal(stats.models['a|m'].latency[0], 11)
})

test('percentile uses the nearest rank and says null without samples', () => {
  assert.equal(percentile([], 50), null)
  assert.equal(percentile([5], 95), 5)
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(hundred, 50), 50)
  assert.equal(percentile(hundred, 95), 95)
  // Order of arrival must not matter.
  assert.equal(percentile([300, 100, 200], 50), 200)
})

test('only the 40 most recently touched models are kept', () => {
  let stats = emptyStats(1)
  for (let i = 0; i < 41; i += 1) {
    stats = bump(stats, `h|m${i}`, 'shown')
  }
  assert.equal(Object.keys(stats.models).length, 40)
  assert.equal('h|m0' in stats.models, false)
  // Touching an old one again keeps it.
  stats = bump(stats, 'h|m1', 'shown')
  stats = bump(stats, 'h|new', 'shown')
  assert.equal('h|m1' in stats.models, true)
  assert.equal('h|m2' in stats.models, false)
})

test('isStats accepts what the worker stores and rejects anything else', () => {
  assert.equal(isStats(bump(emptyStats(5), 'a|m', 'kept')), true)
  assert.equal(isStats(null), false)
  assert.equal(isStats({ since: 1 }), false)
  assert.equal(isStats({ since: 1, models: { x: { shown: 'many' } } }), false)
  assert.equal(isStats({ since: 1, models: { x: { shown: 1, accepted: 0, partial: 0, kept: 0, undone: 0, stale: 0, latency: [1, 'a'] } } }), false)
  assert.equal(isStats({ since: -1, models: {} }), false)
})

test('a model nobody used summarizes to zeros and no latency', () => {
  assert.deepEqual(summarize(emptyStats(1), 'a|m'), {
    shown: 0, accepted: 0, partial: 0, kept: 0, undone: 0, stale: 0, p50: null, p95: null, samples: 0
  })
})
