// Pure text helpers for the editor; no Monaco here so Node can test them.

export type Splice = { start: number; end: number; text: string }

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

/**
 * The smallest single edit that turns `before` into `after`, or null when they are the same.
 * Applying it instead of replacing everything keeps the cursor, the scroll position and the undo
 * stack when the file changes underneath the editor.
 */
export function smallestEdit(before: string, after: string): Splice | null {
  if (before === after) {
    return null
  }
  const shortest = Math.min(before.length, after.length)
  let start = 0
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) {
    start += 1
  }
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1
    endAfter -= 1
  }
  // Why: never cut through a surrogate pair; an emoji is one character to the person.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) {
    start -= 1
  }
  if (endAfter < after.length && endAfter > start && isHighSurrogate(after.charCodeAt(endAfter - 1))) {
    endBefore += 1
    endAfter += 1
  }
  return { start, end: endBefore, text: after.slice(start, endAfter) }
}

/** The text before and after a cursor offset, each capped, for a provider to complete from. */
export function contextAround(
  text: string,
  offset: number,
  prefixMax: number,
  suffixMax: number
): { prefix: string; suffix: string } {
  const at = Math.min(Math.max(offset, 0), text.length)
  return { prefix: text.slice(Math.max(0, at - prefixMax), at), suffix: text.slice(at, at + suffixMax) }
}
