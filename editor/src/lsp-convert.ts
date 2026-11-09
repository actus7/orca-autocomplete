import { sameUri } from '../../src/lsp/uri.ts'

// Conversions between the Language Server Protocol and Monaco. Pure data in, pure data out, so Node
// can test them: the Monaco-aware code only wraps these.

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type MonacoRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

// LSP positions count from 0 and Monaco's from 1; both measure columns in UTF-16 code units.
export const toLspPosition = (position: { lineNumber: number; column: number }): LspPosition => ({
  line: position.lineNumber - 1,
  character: position.column - 1
})

export const fromLspRange = (range: LspRange): MonacoRange => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1
})

export const toLspRange = (range: MonacoRange): LspRange => ({
  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
})

/** LSP severity (1 error ... 4 hint) as Monaco's MarkerSeverity (8, 4, 2, 1). */
export function markerSeverity(severity: number | undefined): number {
  switch (severity) {
    case 2:
      return 4
    case 3:
      return 2
    case 4:
      return 1
    default:
      return 8
  }
}

export type LspDiagnostic = {
  range: LspRange
  severity?: number
  code?: string | number | { value: string | number }
  source?: string
  message: string
  tags?: number[]
}

/** A diagnostic as a Monaco marker. Tags (unnecessary code, deprecated) use the same numbers in both. */
export function toMarker(diagnostic: LspDiagnostic) {
  const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code
  return {
    ...fromLspRange(diagnostic.range),
    severity: markerSeverity(diagnostic.severity),
    message: diagnostic.message,
    ...(code !== undefined ? { code: String(code) } : {}),
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.tags?.length ? { tags: diagnostic.tags } : {})
  }
}

const COMPLETION_KIND_NAMES: Record<number, string> = {
  1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', 5: 'Field', 6: 'Variable', 7: 'Class',
  8: 'Interface', 9: 'Module', 10: 'Property', 11: 'Unit', 12: 'Value', 13: 'Enum', 14: 'Keyword',
  15: 'Snippet', 16: 'Color', 17: 'File', 18: 'Reference', 19: 'Folder', 20: 'EnumMember',
  21: 'Constant', 22: 'Struct', 23: 'Event', 24: 'Operator', 25: 'TypeParameter'
}

/** The name of Monaco's CompletionItemKind member for an LSP kind. */
export const completionKindName = (kind: number | undefined): string => COMPLETION_KIND_NAMES[kind ?? 1] ?? 'Text'

type MarkedString = string | { language: string; value: string }
type Markup = { kind?: string; value: string }

/** Hover and documentation text of any LSP shape as Markdown. */
export function toMarkdown(contents: MarkedString | MarkedString[] | Markup | undefined | null): string[] {
  if (contents === undefined || contents === null) {
    return []
  }
  const items = Array.isArray(contents) ? contents : [contents]
  return items
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }
      if ('language' in item) {
        return `\`\`\`${item.language}\n${item.value}\n\`\`\``
      }
      return item.kind === 'plaintext' ? escapeMarkdown(item.value) : item.value
    })
    .filter((text) => text.trim() !== '')
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

export type LspTextEdit = { range: LspRange; newText: string }

export const toMonacoEdit = (edit: LspTextEdit) => ({ range: fromLspRange(edit.range), text: edit.newText })

export type LspLocation = { uri: string; range: LspRange } | { targetUri: string; targetSelectionRange: LspRange; targetRange: LspRange }

/** Locations (or links) as plain {uri, range}, whichever shape the server used, or none. */
export function normalizeLocations(result: unknown): { uri: string; range: MonacoRange }[] {
  const list = Array.isArray(result) ? result : result ? [result] : []
  return (list as LspLocation[]).map((item) =>
    'targetUri' in item
      ? { uri: item.targetUri, range: fromLspRange(item.targetSelectionRange ?? item.targetRange) }
      : { uri: item.uri, range: fromLspRange(item.range) }
  )
}

export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: { textDocument: { uri: string }; edits: LspTextEdit[] }[]
}

/** Splits a workspace edit into edits for the open document and the number of other files it touches. */
export function splitWorkspaceEdit(edit: LspWorkspaceEdit | null | undefined, documentUri: string) {
  const byUri = new Map<string, LspTextEdit[]>()
  for (const [uri, edits] of Object.entries(edit?.changes ?? {})) {
    byUri.set(uri, [...(byUri.get(uri) ?? []), ...edits])
  }
  for (const change of edit?.documentChanges ?? []) {
    byUri.set(change.textDocument.uri, [...(byUri.get(change.textDocument.uri) ?? []), ...change.edits])
  }
  const ownKey = [...byUri.keys()].find((uri) => sameUri(uri, documentUri))
  const own = (ownKey && byUri.get(ownKey)) || []
  const otherFiles = [...byUri.keys()].filter((uri) => !sameUri(uri, documentUri)).length
  return { own: own.map(toMonacoEdit), otherFiles }
}

export type LspSymbol = {
  name: string
  detail?: string
  kind: number
  range?: LspRange
  selectionRange?: LspRange
  location?: { range: LspRange }
  children?: LspSymbol[]
  containerName?: string
}

/** Document symbols (tree or flat list) in Monaco's shape. LSP's symbol kinds are Monaco's plus one. */
export function toDocumentSymbols(symbols: LspSymbol[] | null | undefined): unknown[] {
  return (symbols ?? []).map((symbol) => {
    const range = fromLspRange(symbol.range ?? symbol.location?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })
    return {
      name: symbol.name,
      detail: symbol.detail ?? symbol.containerName ?? '',
      kind: Math.max(0, symbol.kind - 1),
      tags: [],
      range,
      selectionRange: symbol.selectionRange ? fromLspRange(symbol.selectionRange) : range,
      ...(symbol.children ? { children: toDocumentSymbols(symbol.children) } : {})
    }
  })
}
