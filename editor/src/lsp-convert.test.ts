import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  completionKindName,
  fromLspRange,
  markerSeverity,
  normalizeLocations,
  splitWorkspaceEdit,
  toDocumentSymbols,
  toLspPosition,
  toLspRange,
  toMarkdown,
  toMarker
} from './lsp-convert.ts'

test('positions and ranges convert between 0-based LSP and 1-based Monaco, and back', () => {
  assert.deepEqual(toLspPosition({ lineNumber: 3, column: 5 }), { line: 2, character: 4 })
  const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 7 } }
  assert.deepEqual(fromLspRange(range), { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 8 })
  assert.deepEqual(toLspRange(fromLspRange(range)), range)
})

test('severity maps to Monaco markers and defaults to error', () => {
  assert.deepEqual([1, 2, 3, 4, undefined].map(markerSeverity), [8, 4, 2, 1, 8])
})

test('toMarker keeps the message, code, source and tags', () => {
  const marker = toMarker({
    range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
    severity: 2,
    code: { value: 'E0308' },
    source: 'rustc',
    message: 'mismatched types',
    tags: [1]
  })
  assert.deepEqual(marker, {
    startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6,
    severity: 4, message: 'mismatched types', code: 'E0308', source: 'rustc', tags: [1]
  })
})

test('completionKindName covers the LSP kinds and falls back to Text', () => {
  assert.equal(completionKindName(3), 'Function')
  assert.equal(completionKindName(22), 'Struct')
  assert.equal(completionKindName(99), 'Text')
  assert.equal(completionKindName(undefined), 'Text')
})

test('toMarkdown accepts every hover shape', () => {
  assert.deepEqual(toMarkdown('plain'), ['plain'])
  assert.deepEqual(toMarkdown({ kind: 'markdown', value: '**x**' }), ['**x**'])
  assert.deepEqual(toMarkdown({ language: 'ts', value: 'let a' }), ['```ts\nlet a\n```'])
  assert.deepEqual(toMarkdown(['a', { language: 'rs', value: 'fn' }, '']), ['a', '```rs\nfn\n```'])
  assert.deepEqual(toMarkdown({ kind: 'plaintext', value: 'a_b *c*' }), ['a\\_b \\*c\\*'])
  assert.deepEqual(toMarkdown(null), [])
})

test('normalizeLocations handles a single location, a list and links', () => {
  const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }
  assert.equal(normalizeLocations({ uri: 'file:///a', range }).length, 1)
  assert.equal(normalizeLocations([{ uri: 'file:///a', range }, { uri: 'file:///b', range }]).length, 2)
  assert.deepEqual(normalizeLocations([{ targetUri: 'file:///c', targetRange: range, targetSelectionRange: range }])[0].uri, 'file:///c')
  assert.deepEqual(normalizeLocations(null), [])
})

test('splitWorkspaceEdit separates this document from other files', () => {
  const edit = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
  const split = splitWorkspaceEdit(
    {
      changes: { 'file:///a': [{ range: edit, newText: 'x' }] },
      documentChanges: [{ textDocument: { uri: 'file:///b' }, edits: [{ range: edit, newText: 'y' }] }]
    },
    'file:///a'
  )
  assert.equal(split.own.length, 1)
  assert.equal(split.own[0].text, 'x')
  assert.equal(split.otherFiles, 1)
  assert.deepEqual(splitWorkspaceEdit(null, 'file:///a'), { own: [], otherFiles: 0 })
})

test('toDocumentSymbols converts a tree and a flat list', () => {
  const range = { start: { line: 0, character: 0 }, end: { line: 4, character: 1 } }
  const tree = toDocumentSymbols([{ name: 'A', kind: 5, range, selectionRange: range, children: [{ name: 'm', kind: 6, range }] }]) as { kind: number; children: { kind: number }[] }[]
  assert.equal(tree[0].kind, 4)
  assert.equal(tree[0].children[0].kind, 5)
  const flat = toDocumentSymbols([{ name: 'f', kind: 12, location: { range }, containerName: 'mod' }]) as { detail: string }[]
  assert.equal(flat[0].detail, 'mod')
  assert.deepEqual(toDocumentSymbols(null), [])
})
