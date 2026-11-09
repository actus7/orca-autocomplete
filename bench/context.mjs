// An experiment: would it help to tell the model what the code near the cursor calls in OTHER files?
// This reads a CodeGraph index (read-only) and turns it into a short list of declarations. Nothing here
// is used by the plugin yet; it exists so the idea can be measured before any of it is built in.
//
// The rules that keep the measurement honest, because the code being predicted is in the same file and
// in the index:
//  - only names the model already sees (the code before and after the cursor) are looked up;
//  - nothing from the file being completed is ever returned;
//  - a call recorded on the line being predicted is never used.
import { DatabaseSync } from 'node:sqlite'

export function openGraph(databaseFile) {
  return new DatabaseSync(databaseFile, { readOnly: true })
}

const KEYWORDS = new Set(
  ('abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export ' +
    'extends false finally for from function get if implements import in instanceof interface let new null number of private protected ' +
    'public readonly return set static string super switch this throw true try type typeof undefined unknown var void while with yield ' +
    'console Array Object String Number Boolean Promise Map Set Date Math JSON Error Record Partial Readonly').split(' ')
)
const NAME = /[A-Za-z_$][\w$]{2,}/g
const DECLARABLE = ['function', 'method', 'class', 'interface', 'type_alias', 'constant', 'variable']
const LINES_BEFORE = 25
const LINES_AFTER = 10
const DOC_CHARS = 100
const SIGNATURE_CHARS = 160

/** The names in the code around the cursor, nearest first, without keywords or repeats. */
export function namesNear(prefix, suffix) {
  const before = prefix.split('\n').slice(-LINES_BEFORE).reverse()
  const after = suffix.split('\n').slice(0, LINES_AFTER)
  const seen = new Set()
  const names = []
  for (const line of [...before, ...after]) {
    // Within a line, the name closest to the cursor first.
    for (const name of (line.match(NAME) ?? []).reverse()) {
      if (!KEYWORDS.has(name) && !seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

const placeholders = (list) => list.map(() => '?').join(', ')

/** One line that tells what a declaration is, where it lives and what it is for. */
export function describe(node) {
  const signature = (node.signature ?? '').replace(/\s+/g, ' ').slice(0, SIGNATURE_CHARS)
  const head =
    node.kind === 'function' || node.kind === 'method'
      ? `function ${node.name}${signature || '()'}`
      : node.kind === 'class'
        ? `class ${node.name}`
        : node.kind === 'interface' || node.kind === 'type_alias'
          ? `type ${node.name}${signature ? ` = ${signature}` : ''}`
          : `const ${node.name}${signature ? `: ${signature}` : ''}`
  const doc = (node.docstring ?? '').split('\n')[0].trim().slice(0, DOC_CHARS)
  return `${head}  // ${node.file_path}${doc ? ` - ${doc}` : ''}`
}

const NODE_COLUMNS = 'n.id, n.kind, n.name, n.file_path, n.signature, n.docstring, n.is_exported'

/**
 * The declarations, from other files, that the code around the cursor uses: first what the function being
 * written already calls, then whatever else the nearby names refer to. `cut` has `path` (as the index spells
 * it), `prefix` and `suffix`.
 */
export function relatedFor(db, cut, { maxItems = 12, maxChars = 2000 } = {}) {
  const cursorLine = cut.prefix.split('\n').length
  const found = new Map()
  const add = (node) => {
    const key = `${node.file_path}:${node.name}`
    if (!found.has(key) && !node.file_path.includes('.test.')) {
      found.set(key, node)
    }
  }

  const enclosing = db
    .prepare(
      `SELECT id FROM nodes WHERE file_path = ? AND kind IN ('function', 'method') AND start_line <= ? AND end_line >= ? ORDER BY (end_line - start_line) ASC LIMIT 1`
    )
    .get(cut.path, cursorLine, cursorLine)
  if (enclosing) {
    // Why `line != ?`: a call on the line being predicted would hand over the answer.
    for (const node of db
      .prepare(
        `SELECT ${NODE_COLUMNS} FROM edges e JOIN nodes n ON n.id = e.target WHERE e.source = ? AND e.kind = 'calls' AND e.line != ? AND n.file_path != ? ORDER BY e.line DESC`
      )
      .all(enclosing.id, cursorLine, cut.path)) {
      add(node)
    }
  }

  const names = namesNear(cut.prefix, cut.suffix).slice(0, 30)
  if (names.length > 0) {
    for (const node of db
      .prepare(
        `SELECT ${NODE_COLUMNS} FROM nodes n WHERE n.name IN (${placeholders(names)}) AND n.file_path != ? AND n.kind IN (${placeholders(DECLARABLE)}) ORDER BY n.is_exported DESC`
      )
      .all(...names, cut.path, ...DECLARABLE)
      .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name))) {
      add(node)
    }
  }

  const lines = []
  let size = 0
  for (const node of found.values()) {
    const line = describe(node)
    if (lines.length >= maxItems || size + line.length > maxChars) {
      break
    }
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}
