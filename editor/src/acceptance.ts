// Judges whether a suggestion the person accepted lasted. Monaco says when a suggestion is accepted
// (the item's command runs) but never what became of it, so a range follows the inserted text and is
// looked at twice: after a few seconds (still there?) and after half a minute (kept?).
//
// No Monaco import: the model is described by what is used of it, so Node can test this.

export type Pos = { lineNumber: number; column: number }
export type Rng = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

export type TrackedModel = {
  getEOL(): string
  getOffsetAt(position: Pos): number
  getPositionAt(offset: number): Pos
  getValueInRange(range: Rng): string
  /** Follows a range as the text around it changes; the id finds it again. */
  trackRange(range: Rng): string
  getTrackedRange(id: string): Rng | null
  untrackRange(id: string): void
}

export type Verdict = 'kept' | 'undone'
export type Schedule = (callback: () => void, ms: number) => unknown

/** Removed or changed within this long after accepting: it was not what the person wanted. */
export const UNDONE_WITHIN_MS = 5_000
/** Still the same after this long: the suggestion became part of the code. */
export const KEPT_AFTER_MS = 30_000

const unifyEol = (text: string): string => text.replace(/\r\n/g, '\n')

/**
 * Starts judging `text`, which was just inserted so that the cursor sits right after it. Says nothing
 * when it cannot be sure the text is where it should be: a missing number is better than a wrong one.
 */
export function trackAcceptance(
  model: TrackedModel,
  accepted: { text: string; cursor: Pos },
  report: (verdict: Verdict) => void,
  schedule: Schedule = setTimeout
): void {
  const wanted = unifyEol(accepted.text)
  // Why the model's own line ends: it stores `\n` in the suggestion as `\r\n` in a CRLF file, which is longer.
  const insertedLength = accepted.text.replace(/\r?\n/g, model.getEOL()).length
  const end = model.getOffsetAt(accepted.cursor)
  const start = end - insertedLength
  if (start < 0) {
    return
  }
  const range: Rng = {
    startLineNumber: model.getPositionAt(start).lineNumber,
    startColumn: model.getPositionAt(start).column,
    endLineNumber: accepted.cursor.lineNumber,
    endColumn: accepted.cursor.column
  }
  if (unifyEol(model.getValueInRange(range)) !== wanted) {
    return
  }
  const id = model.trackRange(range)

  // The model can be gone by the time a timer fires (the editor was closed): that is no verdict at all.
  const intact = (): boolean | null => {
    try {
      const now = model.getTrackedRange(id)
      return now !== null && unifyEol(model.getValueInRange(now)) === wanted
    } catch {
      return null
    }
  }
  const finish = (verdict: Verdict): void => {
    try {
      model.untrackRange(id)
    } catch {
      // The model is gone; there is nothing left to release.
    }
    report(verdict)
  }

  schedule(() => {
    const first = intact()
    if (first === null) {
      return
    }
    if (!first) {
      finish('undone')
      return
    }
    schedule(() => {
      const second = intact()
      if (second !== null) {
        finish(second ? 'kept' : 'undone')
      }
    }, KEPT_AFTER_MS - UNDONE_WITHIN_MS)
  }, UNDONE_WITHIN_MS)
}
