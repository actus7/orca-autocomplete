// A suggestion is still worth showing when the person has typed, or accepted a word of, exactly what it
// began with: the rest of it is the same suggestion and needs no new request. Without this, every
// accepted word or typed-along character would ask the provider again, for an answer that is already here.
//
// Pure, so Node can test it.

export type Offered = {
  /** The cursor offset at which the suggestion was offered. */
  offset: number
  text: string
}

/**
 * What is left of an offered suggestion now that the cursor is at `cursorOffset`, or null when it cannot
 * be reused: the cursor did not move forward, all of it was typed, or what was typed is not its start.
 * `typed` is the text of the file between where it was offered and the cursor now.
 *
 * With CRLF line ends a typed newline is two characters in the file and one in the suggestion, so the
 * lengths differ and the answer is null: a new request is made, which is always safe.
 */
export function remainder(offered: Offered, cursorOffset: number, typed: string): string | null {
  const length = cursorOffset - offered.offset
  if (length <= 0 || length >= offered.text.length) {
    return null
  }
  return typed === offered.text.slice(0, length) ? offered.text.slice(length) : null
}
