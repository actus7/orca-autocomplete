// The next edit with no model: when a name was changed in one place, the same name is probably meant to
// change in the other places it appears in the file. Pure text work, so Node can test it.
import { smallestEdit } from './edits.ts'

export interface NextEdit {
  /** Offsets in the text the edit was computed for. */
  start: number
  end: number
  text: string
}

export interface Rename {
  from: string
  to: string
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u
// Why not shorter: renaming `i` to `id` in one loop says nothing about the other loops.
const MIN_NAME_CHARS = 3
// Why a cap: a name used hundreds of times is not worth walking one by one, and the scan stays cheap.
const MAX_OCCURRENCES = 200

/** The whole identifier that the range [start, end) touches in `text`: the range grown over its word characters. */
function wordAround(text: string, start: number, end: number): { start: number; end: number } {
  let from = start
  let to = end
  while (from > 0 && WORD_CHAR.test(text[from - 1])) {
    from -= 1
  }
  while (to < text.length && WORD_CHAR.test(text[to])) {
    to += 1
  }
  return { start: from, end: to }
}

/** What the person renamed between two versions of the text, or null when the change is not one name becoming another. */
export function renameBetween(baseline: string, current: string): { rename: Rename; at: number } | null {
  const edit = smallestEdit(baseline, current)
  if (!edit) {
    return null
  }
  const before = wordAround(baseline, edit.start, edit.end)
  const after = wordAround(current, edit.start, edit.start + edit.text.length)
  const from = baseline.slice(before.start, before.end)
  const to = current.slice(after.start, after.end)
  if (from === to || !IDENTIFIER.test(from) || !IDENTIFIER.test(to) || from.length < MIN_NAME_CHARS) {
    return null
  }
  return { rename: { from, to }, at: after.start }
}

/** Where `name` appears as a whole word in `text`. */
function occurrences(text: string, name: string): number[] {
  const found: number[] = []
  let index = text.indexOf(name)
  while (index !== -1 && found.length < MAX_OCCURRENCES) {
    const beforeOk = index === 0 || !WORD_CHAR.test(text[index - 1])
    const afterOk = index + name.length >= text.length || !WORD_CHAR.test(text[index + name.length])
    if (beforeOk && afterOk) {
      found.push(index)
    }
    index = text.indexOf(name, index + name.length)
  }
  return found
}

/** The next place to apply a rename: the nearest one at or after the cursor, or else the nearest before it. */
export function nextOccurrence(text: string, rename: Rename, cursor: number): NextEdit | null {
  const places = occurrences(text, rename.from)
  if (places.length === 0) {
    return null
  }
  const after = places.find((place) => place >= cursor)
  const start = after ?? places[places.length - 1]
  return { start, end: start + rename.from.length, text: rename.to }
}

/** The proposal after a change: the rename it made, if it was one, applied to the next place the old name is used. */
export function repeatRename(baseline: string, current: string, cursor: number): { rename: Rename; edit: NextEdit } | null {
  const renamed = renameBetween(baseline, current)
  if (!renamed) {
    return null
  }
  const edit = nextOccurrence(current, renamed.rename, cursor)
  return edit ? { rename: renamed.rename, edit } : null
}
