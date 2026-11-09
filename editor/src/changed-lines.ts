// What the person just changed, as lines: the text the next-edit request is made from. Pure, so Node can test it.
import { smallestEdit } from './edits.ts'

export interface ChangedLines {
  /** The line number (1-based) of the first line of `text`. */
  startLine: number
  /** The lines around the change, as they are now. */
  text: string
  recent: { line: number; before: string; after: string }[]
}

// Why only a few lines: a change that rewrote a block says little about what comes next, and the request grows with it.
const MAX_CHANGED_LINES = 3
const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

/**
 * The lines that differ between two versions of a text, with `around` lines of the new text on each side. Null when
 * nothing changed, or the change added or removed lines or touched more than a few: only a change that keeps the
 * number of lines can be told line by line.
 */
export function describeChange(baseline: string, current: string, around: number): ChangedLines | null {
  const edit = smallestEdit(baseline, current)
  if (!edit) {
    return null
  }
  const firstLine = lineOf(current, edit.start)
  const lastLine = lineOf(current, edit.start + edit.text.length)
  const baselineFirst = lineOf(baseline, edit.start)
  const baselineLast = lineOf(baseline, edit.end)
  if (lastLine - firstLine + 1 > MAX_CHANGED_LINES || baselineLast - baselineFirst !== lastLine - firstLine) {
    return null
  }
  const now = current.split('\n')
  const then = baseline.split('\n')
  const recent = []
  for (let index = 0; index <= lastLine - firstLine; index += 1) {
    recent.push({ line: firstLine + index, before: then[baselineFirst - 1 + index], after: now[firstLine - 1 + index] })
  }
  const from = Math.max(1, firstLine - around)
  const to = Math.min(now.length, lastLine + around)
  return { startLine: from, text: now.slice(from - 1, to).join('\n'), recent }
}
