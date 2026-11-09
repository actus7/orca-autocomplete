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
  return column > 0 && line.slice(column).trim() !== '' && isCodePlace(line, column) ? column : -1
}

const CUT_TRIES = 10
const BACKSLASH = String.fromCharCode(92)
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/
// What code looks like: a place whose rest of the line has none of these is prose, a name or a literal.
const CODE_PUNCTUATION = /[(){}[\].=;:<>+*/|&?!,]/

/** Whether cutting `line` at `column` leaves code to predict: not inside a comment or a string, and with code after it. */
export function isCodePlace(line, column) {
  if (COMMENT_LINE.test(line)) {
    return false
  }
  const before = line.slice(0, column)
  // An odd number of quotes of one kind before the cut means the cursor is inside a string.
  for (const quote of ["'", '"', '`']) {
    const unescaped = before.split(quote).length - 1 - (before.split(BACKSLASH + quote).length - 1)
    if (unescaped % 2 === 1) {
      return false
    }
  }
  return CODE_PUNCTUATION.test(line.slice(column))
}

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

/** Two-sided exact sign test: how likely a split of `wins` and `losses` this lopsided is if neither side is better. */
export function signTestP(wins, losses) {
  const n = wins + losses
  if (n === 0) {
    return 1
  }
  const k = Math.min(wins, losses)
  let coefficient = 1
  let tail = 0
  for (let i = 0; i <= k; i += 1) {
    tail += coefficient
    coefficient = (coefficient * (n - i)) / (i + 1)
  }
  return Math.min(1, (2 * tail) / 2 ** n)
}

// A difference in similarity smaller than this is noise, not a better or a worse suggestion.
const TIE = 0.05

/**
 * Compares two runs of the same places (same seed and samples), place by place, over the places both
 * answered. `b` is the run under test, so a "win" is a place where it did better than `a`. With `skipPolluted`,
 * places where either answer carried a gateway's own text instead of code are left out too, since those
 * answers say nothing about the model or the context.
 */
export function compareRuns(a, b, { skipPolluted = false } = {}) {
  const both = a.results
    .map((x, index) => [x, b.results[index]])
    .filter(([x, y]) => y && !x.error && !y.error && !(skipPolluted && (x.polluted || y.polluted)))
  let wins = 0
  let losses = 0
  let gained = 0
  let lost = 0
  for (const [x, y] of both) {
    const difference = y.similarity - x.similarity
    wins += difference > TIE ? 1 : 0
    losses += difference < -TIE ? 1 : 0
    gained += !x.exact && y.exact ? 1 : 0
    lost += x.exact && !y.exact ? 1 : 0
  }
  const mean = (list, pick) => (list.length ? list.reduce((sum, item) => sum + pick(item), 0) / list.length : 0)
  return {
    compared: both.length,
    similarityA: mean(both, ([x]) => x.similarity),
    similarityB: mean(both, ([, y]) => y.similarity),
    exactA: both.filter(([x]) => x.exact).length,
    exactB: both.filter(([, y]) => y.exact).length,
    wins,
    losses,
    ties: both.length - wins - losses,
    exactGained: gained,
    exactLost: lost,
    pSimilarity: signTestP(wins, losses),
    pExact: signTestP(gained, lost)
  }
}

// Text that a gateway's own instructions can leave in an answer: tool-call markup, and the "skipped: ... add
// when ..." notes of a terse-coding persona. None of it is code, so an answer holding it was not the model's work on the task.
const POLLUTION = /<tool_call>|<function=|<\/?parameter|\bponytail\b|\bskipped:/i

/** Whether an answer carries what a gateway injected instead of code. */
export function looksPolluted(text) {
  return POLLUTION.test(text)
}
