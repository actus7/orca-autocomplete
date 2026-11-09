import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEPT_AFTER_MS, trackAcceptance, UNDONE_WITHIN_MS, type Pos, type Rng, type TrackedModel, type Verdict } from './acceptance.ts'

/** A text and the places that follow it, with the few operations the tracker uses. */
class FakeModel implements TrackedModel {
  text: string
  eol: string
  tracked = new Map<string, { start: number; end: number }>()
  gone = false

  constructor(text: string, eol = '\n') {
    this.text = text
    this.eol = eol
  }

  getEOL = (): string => this.eol
  getOffsetAt = (p: Pos): number => {
    const lines = this.text.split(this.eol)
    return lines.slice(0, p.lineNumber - 1).reduce((sum, line) => sum + line.length + this.eol.length, 0) + p.column - 1
  }
  getPositionAt = (offset: number): Pos => {
    const before = this.text.slice(0, offset).split(this.eol)
    return { lineNumber: before.length, column: before[before.length - 1].length + 1 }
  }
  getValueInRange = (r: Rng): string =>
    this.text.slice(this.getOffsetAt({ lineNumber: r.startLineNumber, column: r.startColumn }), this.getOffsetAt({ lineNumber: r.endLineNumber, column: r.endColumn }))
  trackRange = (r: Rng): string => {
    const id = `r${this.tracked.size + 1}`
    this.tracked.set(id, {
      start: this.getOffsetAt({ lineNumber: r.startLineNumber, column: r.startColumn }),
      end: this.getOffsetAt({ lineNumber: r.endLineNumber, column: r.endColumn })
    })
    return id
  }
  getTrackedRange = (id: string): Rng | null => {
    if (this.gone) {
      throw new Error('model is disposed')
    }
    const range = this.tracked.get(id)
    if (!range) {
      return null
    }
    const a = this.getPositionAt(range.start)
    const b = this.getPositionAt(range.end)
    return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
  }
  untrackRange = (id: string): void => void this.tracked.delete(id)

  /** Replaces text the way an edit does: places after it move, and a place it covered closes up. */
  replace(start: number, end: number, text: string): void {
    this.text = this.text.slice(0, start) + text + this.text.slice(end)
    const shift = text.length - (end - start)
    for (const range of this.tracked.values()) {
      if (end <= range.start) {
        range.start += shift
        range.end += shift
      } else if (start <= range.start && end >= range.end) {
        range.start = start
        range.end = start + text.length
      } else if (start >= range.start && start < range.end) {
        range.end += shift
      }
    }
  }
}

/** Timers the test moves by hand. */
function clock() {
  const queue: { at: number; run: () => void }[] = []
  let now = 0
  return {
    schedule: (run: () => void, ms: number) => void queue.push({ at: now + ms, run }),
    advance(ms: number): void {
      const target = now + ms
      for (;;) {
        queue.sort((a, b) => a.at - b.at)
        const next = queue[0]
        if (!next || next.at > target) {
          break
        }
        queue.shift()
        now = next.at
        next.run()
      }
      now = target
    }
  }
}

/** `before` with `suggestion` accepted at the end of its first line, as Monaco leaves it: the cursor right after the text. */
function accepted(suggestion: string, eol = '\n') {
  // Why the conversion: Monaco stores the `\n` of a suggestion as the file's own line end.
  const inserted = suggestion.replace(/\n/g, eol)
  const model = new FakeModel(`const total = ${inserted}${eol}return total${eol}`, eol)
  const cursor = model.getPositionAt('const total = '.length + inserted.length)
  const verdicts: Verdict[] = []
  const timers = clock()
  trackAcceptance(model, { text: suggestion, cursor }, (v) => verdicts.push(v), timers.schedule)
  return { model, verdicts, timers }
}

test('text that is still there after half a minute is kept, and nothing is said before then', () => {
  const { verdicts, timers } = accepted('a + b;')
  timers.advance(UNDONE_WITHIN_MS + 1)
  assert.deepEqual(verdicts, [])
  timers.advance(KEPT_AFTER_MS)
  assert.deepEqual(verdicts, ['kept'])
})

test('text removed within the first seconds is undone, and is not judged again later', () => {
  const { model, verdicts, timers } = accepted('a + b;')
  model.replace('const total = '.length, 'const total = a + b;'.length, '')
  timers.advance(UNDONE_WITHIN_MS + 1)
  assert.deepEqual(verdicts, ['undone'])
  timers.advance(KEPT_AFTER_MS * 2)
  assert.deepEqual(verdicts, ['undone'])
})

test('text changed after the first check but before the last is undone, not kept', () => {
  const { model, verdicts, timers } = accepted('a + b;')
  timers.advance(UNDONE_WITHIN_MS + 1)
  model.replace('const total = '.length, 'const total = a'.length, 'x')
  timers.advance(KEPT_AFTER_MS)
  assert.deepEqual(verdicts, ['undone'])
})

test('text before the suggestion changing does not matter: the tracked text moves with it', () => {
  const { model, verdicts, timers } = accepted('a + b;')
  model.replace(0, 0, '// note\n')
  timers.advance(KEPT_AFTER_MS + 1)
  assert.deepEqual(verdicts, ['kept'])
})

test('a suggestion with line breaks is judged in a file that uses CRLF', () => {
  const { verdicts, timers } = accepted('foo(\n  a\n)', '\r\n')
  timers.advance(KEPT_AFTER_MS + 1)
  assert.deepEqual(verdicts, ['kept'])
})

// Why: a wrong verdict would be counted as if it were data; staying silent is the honest answer.
test('when the text is not where the cursor says, nothing is tracked and nothing is reported', () => {
  const model = new FakeModel('const total = 1;\n')
  const verdicts: Verdict[] = []
  const timers = clock()
  trackAcceptance(model, { text: 'a + b;', cursor: { lineNumber: 1, column: 10 } }, (v) => verdicts.push(v), timers.schedule)
  timers.advance(KEPT_AFTER_MS * 2)
  assert.deepEqual(verdicts, [])
  assert.equal(model.tracked.size, 0)
})

test('when the model is gone by the time a timer fires there is no verdict and no error', () => {
  const { model, verdicts, timers } = accepted('a + b;')
  model.gone = true
  assert.doesNotThrow(() => timers.advance(KEPT_AFTER_MS * 2))
  assert.deepEqual(verdicts, [])
})
