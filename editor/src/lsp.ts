// Connects the editor to a language server that runs next to the plugin's worker. The editor never
// talks to the server directly: every request goes through the worker, which also owns the file's
// address. Only what the server says it supports is registered, so nothing is offered that fails.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import {
  completionDetails,
  completionKindName,
  fromLspRange,
  markdownValue,
  normalizeLocations,
  splitWorkspaceEdit,
  toDocumentSymbols,
  toLspPosition,
  toLspRange,
  toMarker,
  toMarkdown,
  toMonacoEdit,
  type LspDiagnostic,
  type LspTextEdit
} from './lsp-convert.ts'
import { showServerBadge } from './lsp-badge.ts'
import { say } from './strings.ts'
import { sameUri } from '../../src/lsp/uri.ts'

type Capabilities = Record<string, any> // the server's own JSON
const SYNC_DELAY_MS = 150
// Why a number: the same constant LSP uses for "typed this trigger character".
const LSP_TRIGGER_CHARACTER = 2

export type LanguageServerOptions = {
  language: string
  extensions: string[]
  /** Called once a server is serving this file, so a built-in service of the same language can step aside. */
  onServed?(): void
}

export async function startLanguageServer(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  options: LanguageServerOptions
): Promise<void> {
  const docId = crypto.randomUUID()
  // Listen before asking: a server publishes its first diagnostics as soon as it opens the file, which
  // happens inside the attach request, so a later listener would miss them.
  // --- diagnostics ---
  let lastDiagnostics: LspDiagnostic[] = []
  orca.plugin.on('lsp.diagnostics', (event) => {
    if (event.docId === docId) {
      lastDiagnostics = event.diagnostics as LspDiagnostic[]
      monaco.editor.setModelMarkers(model, 'language-server', lastDiagnostics.map(toMarker))
    }
  })
  orca.plugin.on('lsp.status', (event) => {
    if (event.docId === docId && event.status.state === 'error') {
      showServerBadge('error', event.status.message)
    }
  })

  let answer
  try {
    answer = await orca.plugin.request('lsp.attach', {
      docId,
      language: options.language,
      extensions: options.extensions,
      content: model.getValue()
    })
  } catch {
    return
  }
  const { status } = answer
  if (status.state === 'error') {
    showServerBadge('error', status.message)
    return
  }
  if (status.state !== 'ready') {
    return
  }
  const capabilities: Capabilities = status.capabilities
  const documentUri = status.uri
  options.onServed?.()
  showServerBadge('ready', status.server)

  // --- keeping the server in step with the text ---
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let unsent = false
  const flush = async (): Promise<void> => {
    clearTimeout(syncTimer)
    if (unsent) {
      unsent = false
      await orca.plugin.request('lsp.sync', { docId, text: model.getValue() })
    }
  }
  model.onDidChangeContent(() => {
    unsent = true
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => void flush(), SYNC_DELAY_MS)
  })

  // A request waits for the newest text first, so the answer is about what is on screen.
  async function ask(method: string, params: Record<string, unknown>): Promise<any> {
    await flush()
    try {
      return (await orca.plugin.request('lsp.request', { docId, method, params })).result
    } catch {
      return null
    }
  }
  const atCursor = (position: Monaco.Position) => ({ position: toLspPosition(position) })
  const ours = (candidate: Monaco.editor.ITextModel): boolean => candidate === model
  const edits = (list: LspTextEdit[] | null): Monaco.languages.TextEdit[] => (list ?? []).map(toMonacoEdit)
  const markdown = (value: unknown) => markdownValue(value as never)

  // --- completion ---
  if (capabilities.completionProvider) {
    // The server's own item for each suggestion shown: resolving it later needs exactly what the server sent.
    const serverItems = new WeakMap<object, unknown>()
    monaco.languages.registerCompletionItemProvider('*', {
      triggerCharacters: capabilities.completionProvider.triggerCharacters,
      async provideCompletionItems(m, position, context) {
        if (!ours(m)) {
          return { suggestions: [] }
        }
        const result = await ask('textDocument/completion', {
          ...atCursor(position),
          context: {
            triggerKind: context.triggerCharacter ? LSP_TRIGGER_CHARACTER : 1,
            ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {})
          }
        })
        const items: any[] = Array.isArray(result) ? result : (result?.items ?? [])
        const word = m.getWordUntilPosition(position)
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          incomplete: Boolean(result?.isIncomplete),
          suggestions: items.map((item) => {
            const edit = item.textEdit
            const range = edit
              ? edit.range
                ? fromLspRange(edit.range)
                : { insert: fromLspRange(edit.insert), replace: fromLspRange(edit.replace) }
              : fallback
            const suggestion = {
              label: item.label,
              kind: monaco.languages.CompletionItemKind[completionKindName(item.kind) as keyof typeof monaco.languages.CompletionItemKind],
              detail: item.detail,
              documentation: markdown(item.documentation),
              insertText: edit?.newText ?? item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range,
              sortText: item.sortText,
              filterText: item.filterText,
              preselect: item.preselect,
              commitCharacters: item.commitCharacters,
              additionalTextEdits: item.additionalTextEdits ? edits(item.additionalTextEdits) : undefined,
              tags: item.deprecated || item.tags?.includes(1) ? [1] : undefined
            }
            serverItems.set(suggestion, item)
            return suggestion
          })
        }
      },
      // Why: a TypeScript server says which import goes with a symbol only when asked to resolve it, so without
      // this, picking a symbol from another file gives the name and no import.
      resolveCompletionItem: capabilities.completionProvider.resolveProvider
        ? async (suggestion) => {
            const raw = serverItems.get(suggestion)
            const resolved = raw ? await ask('completionItem/resolve', raw as Record<string, unknown>) : null
            return { ...suggestion, ...completionDetails(resolved) }
          }
        : undefined
    })
  }

  // --- hover and signature help ---
  if (capabilities.hoverProvider) {
    monaco.languages.registerHoverProvider('*', {
      async provideHover(m, position) {
        if (!ours(m)) return null
        const result = await ask('textDocument/hover', atCursor(position))
        const contents = toMarkdown(result?.contents).map((value) => ({ value }))
        return contents.length ? { contents, ...(result.range ? { range: fromLspRange(result.range) } : {}) } : null
      }
    })
  }
  if (capabilities.signatureHelpProvider) {
    monaco.languages.registerSignatureHelpProvider('*', {
      signatureHelpTriggerCharacters: capabilities.signatureHelpProvider.triggerCharacters,
      signatureHelpRetriggerCharacters: capabilities.signatureHelpProvider.retriggerCharacters,
      async provideSignatureHelp(m, position) {
        if (!ours(m)) return null
        const result = await ask('textDocument/signatureHelp', atCursor(position))
        if (!result?.signatures?.length) return null
        return {
          value: {
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
            signatures: result.signatures.map((signature: any) => ({
              label: signature.label,
              documentation: markdown(signature.documentation),
              parameters: (signature.parameters ?? []).map((parameter: any) => ({
                label: parameter.label,
                documentation: markdown(parameter.documentation)
              }))
            }))
          },
          dispose() {}
        }
      }
    })
  }

  // --- navigation: definition, references, symbols, highlights ---
  const locationsFor =
    (method: string, extra: Record<string, unknown> = {}) =>
    async (m: Monaco.editor.ITextModel, position: Monaco.Position) => {
      if (!ours(m)) return null
      const result = await ask(method, { ...atCursor(position), ...extra })
      // Why only this file: opening another file needs a permission the plugin does not ask for.
      return normalizeLocations(result)
        .filter((location) => sameUri(location.uri, documentUri))
        .map((location) => ({ uri: model.uri, range: location.range }))
    }
  if (capabilities.definitionProvider) {
    monaco.languages.registerDefinitionProvider('*', { provideDefinition: locationsFor('textDocument/definition') })
  }
  if (capabilities.typeDefinitionProvider) {
    monaco.languages.registerTypeDefinitionProvider('*', { provideTypeDefinition: locationsFor('textDocument/typeDefinition') })
  }
  if (capabilities.implementationProvider) {
    monaco.languages.registerImplementationProvider('*', { provideImplementation: locationsFor('textDocument/implementation') })
  }
  if (capabilities.referencesProvider) {
    monaco.languages.registerReferenceProvider('*', {
      provideReferences: (m, position, context) => locationsFor('textDocument/references', { context: { includeDeclaration: context.includeDeclaration } })(m, position)
    })
  }
  if (capabilities.documentSymbolProvider) {
    monaco.languages.registerDocumentSymbolProvider('*', {
      displayName: status.server,
      async provideDocumentSymbols(m) {
        return ours(m) ? (toDocumentSymbols(await ask('textDocument/documentSymbol', {})) as Monaco.languages.DocumentSymbol[]) : null
      }
    })
  }
  if (capabilities.documentHighlightProvider) {
    monaco.languages.registerDocumentHighlightProvider('*', {
      async provideDocumentHighlights(m, position) {
        if (!ours(m)) return null
        const result: any[] = (await ask('textDocument/documentHighlight', atCursor(position))) ?? []
        return result.map((highlight) => ({ range: fromLspRange(highlight.range), kind: Math.max(0, (highlight.kind ?? 1) - 1) }))
      }
    })
  }
  // --- editing: formatting, rename, code actions ---
  if (capabilities.documentFormattingProvider) {
    monaco.languages.registerDocumentFormattingEditProvider('*', {
      displayName: status.server,
      async provideDocumentFormattingEdits(m, formatting) {
        if (!ours(m)) return null
        return edits(await ask('textDocument/formatting', { options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces } }))
      }
    })
  }
  if (capabilities.documentRangeFormattingProvider) {
    monaco.languages.registerDocumentRangeFormattingEditProvider('*', {
      displayName: status.server,
      async provideDocumentRangeFormattingEdits(m, range, formatting) {
        if (!ours(m)) return null
        return edits(await ask('textDocument/rangeFormatting', { range: toLspRange(range), options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces } }))
      }
    })
  }
  if (capabilities.renameProvider) {
    monaco.languages.registerRenameProvider('*', {
      async provideRenameEdits(m, position, newName) {
        if (!ours(m)) return null
        const split = splitWorkspaceEdit(await ask('textDocument/rename', { ...atCursor(position), newName }), documentUri)
        if (split.otherFiles > 0) {
          // Why refuse: a half-applied rename that skips other files would break the project.
          return { edits: [], rejectReason: say('rename.otherFiles', { count: split.otherFiles }) }
        }
        return { edits: split.own.map((textEdit) => ({ resource: model.uri, textEdit, versionId: undefined })) }
      },
      async resolveRenameLocation(m, position) {
        if (!capabilities.renameProvider.prepareProvider) {
          const word = m.getWordAtPosition(position)
          return word
            ? { range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn), text: word.word }
            : { range: new monaco.Range(1, 1, 1, 1), text: '', rejectReason: say('rename.nothing') }
        }
        const result = await ask('textDocument/prepareRename', atCursor(position))
        const range = result?.range ?? result
        if (!range?.start) {
          return { range: new monaco.Range(1, 1, 1, 1), text: '', rejectReason: say('rename.cannot') }
        }
        const monacoRange = fromLspRange(range)
        return { range: monacoRange, text: result.placeholder ?? m.getValueInRange(monacoRange) }
      }
    })
  }
  if (capabilities.codeActionProvider) {
    monaco.languages.registerCodeActionProvider('*', {
      async provideCodeActions(m, range, context) {
        if (!ours(m)) return null
        const wanted = toLspRange(range)
        const touching = lastDiagnostics.filter((d) => d.range.start.line <= wanted.end.line && d.range.end.line >= wanted.start.line)
        const result: any[] = (await ask('textDocument/codeAction', { range: wanted, context: { diagnostics: touching, ...(context.only ? { only: [context.only] } : {}) } })) ?? []
        const actions = result
          .map((action) => {
            const split = splitWorkspaceEdit(action.edit, documentUri)
            // Only actions this editor can finish by itself: edits to this file.
            return split.own.length > 0 && split.otherFiles === 0
              ? { title: action.title, kind: action.kind, isPreferred: action.isPreferred, edit: { edits: split.own.map((textEdit) => ({ resource: model.uri, textEdit, versionId: undefined })) } }
              : null
          })
          .filter((action): action is NonNullable<typeof action> => action !== null)
        return { actions, dispose() {} }
      }
    })
  }

  window.addEventListener('pagehide', () => void orca.plugin.request('lsp.detach', { docId }))
}
