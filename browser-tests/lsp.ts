// Page for the browser tests of the language server bridge: the plugin's own bridge running in the real
// Monaco, with a fake `orca` that plays a server which, like the TypeScript one, says which import goes
// with a symbol only when it is asked to resolve the completion item.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { startLanguageServer } from '../editor/src/lsp.ts'

const log: string[] = []
;(window as any).orca = {
  locale: 'en',
  plugin: {
    on: () => ({ dispose() {} }),
    request: async (name: string, input: any) => {
      if (name === 'lsp.attach') {
        return {
          status: {
            state: 'ready',
            server: 'fake',
            path: '/x/a.ts',
            uri: 'file:///x/a.ts',
            capabilities: { completionProvider: { resolveProvider: true, triggerCharacters: ['.'] } }
          }
        }
      }
      if (name === 'lsp.request') {
        log.push(input.method)
        if (input.method === 'textDocument/completion') {
          return { result: { items: [{ label: 'Money', kind: 7, data: { id: 1 } }] } }
        }
        if (input.method === 'completionItem/resolve') {
          const start = { line: 0, character: 0 }
          return {
            result: {
              ...input.params,
              detail: 'class Money',
              additionalTextEdits: [{ range: { start, end: start }, newText: "import { Money } from './money'\n" }]
            }
          }
        }
        return { result: null }
      }
      return {}
    }
  }
}
const model = monaco.editor.createModel('const price = Mon', 'plaintext')
const editor = monaco.editor.create(document.getElementById('root')!, { model, automaticLayout: true })
editor.setPosition({ lineNumber: 1, column: 18 })
editor.focus()
void startLanguageServer(monaco, model, { language: 'typescript', extensions: ['.ts'] })
Object.assign(window, { __log: log, __editor: editor })
