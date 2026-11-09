// Page for the browser tests of the ghost text: the plugin's own suggestion provider running in the real
// Monaco, with a fake `orca` that answers the worker's requests and keeps a log of them.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { registerInlineAi } from '../editor/src/ai.ts'

const log: unknown[] = []
let ids = 0
;(window as any).orca = {
  plugin: {
    request: async (name: string, input: unknown) => {
      log.push([name, input])
      return name === 'completion.ask' ? { suggestion: 'alpha + beta;', id: (ids += 1) } : {}
    }
  }
}
const editor = monaco.editor.create(document.getElementById('root')!, {
  value: 'const total = ',
  language: 'plaintext',
  automaticLayout: true,
  inlineSuggest: { enabled: true },
  quickSuggestions: false
})
editor.setPosition({ lineNumber: 1, column: 15 })
editor.focus()
registerInlineAi(monaco, editor, () => 'x.ts')
Object.assign(window, { __log: log, __editor: editor })
