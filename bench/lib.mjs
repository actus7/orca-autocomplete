// The pure parts of the benchmark: a seeded choice of places to complete, and how close a suggestion
// is to the code that was really there. Developer tooling only; nothing here is used by the plugin.

/** A small seeded random generator, so two runs pick the same places and can be compared. */
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Edit distance between two strings (insertions, deletions and substitutions each cost 1). */
export function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/** 1 when equal, 0 when nothing is shared: the edit distance relative to the longer text. */
export function similarity(a, b) {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest
}

const MIN_LINE_CHARS = 12
// Where in a line the cut falls: far enough in that there is something to continue, early enough that something is left.
const CUT_FROM = 0.35
const CUT_SPAN = 0.5
const BOUNDARY = /[ (.,:={[]/

/** Where in a line to cut, or -1 when no cut leaves something to continue. */
function cutColumn(line, random) {
  const start = Math.floor(line.length * (CUT_FROM + random() * CUT_SPAN))
  let column = start
  // Why move on: a cut in the middle of a name is not a place anyone pauses at.
  while (column < line.length && !BOUNDARY.test(line[column - 1] ?? '')) {
    column += 1
  }
  if (column >= line.length) {
    // No boundary after the start: use the last one before it, so the rest of the line is never empty.
    column = start
    while (column > 0 && !BOUNDARY.test(line[column - 1] ?? '')) {
      column -= 1
    }
  }
  return column > 0 && line.slice(column).trim() !== '' ? column : -1
}

const CUT_TRIES = 10

/**
 * `count` places to complete: the code before the cursor, the rest of that line (what a good suggestion
 * would write) and the code after the line. `prefix + expected + suffix` is always the whole file.
 */
export function pickCuts(files, count, seed) {
  const random = mulberry32(seed)
  const usable = files.filter((file) => file.text.split('\n').some((line) => line.trim().length >= MIN_LINE_CHARS))
  const cuts = []
  for (let n = 0; n < count && usable.length > 0; n += 1) {
    for (let tries = 0; tries < CUT_TRIES; tries += 1) {
      const file = usable[Math.floor(random() * usable.length)]
      const lines = file.text.split('\n')
      const candidates = lines.map((line, index) => index).filter((index) => lines[index].trim().length >= MIN_LINE_CHARS)
      const index = candidates[Math.floor(random() * candidates.length)]
      const column = cutColumn(lines[index], random)
      if (column < 0) {
        continue
      }
      const lineStart = lines.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0)
      const lineEnd = lineStart + lines[index].length
      const cut = lineStart + column
      cuts.push({ path: file.path, prefix: file.text.slice(0, cut), expected: file.text.slice(cut, lineEnd), suffix: file.text.slice(lineEnd) })
      break
    }
  }
  return cuts
}

/** How a suggestion compares with what was there: only its first line counts, since the ground truth is one line. */
export function score(suggestion, expected) {
  const got = suggestion.split('\n')[0].trimEnd()
  const want = expected.trimEnd()
  return { exact: got === want, similarity: similarity(got, want), empty: suggestion.trim() === '' }
}
