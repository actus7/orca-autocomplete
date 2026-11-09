// Page for the browser tests of the next edit: the controller running in the real Monaco, with a fake `orca`
// that answers `edits.predict` with whatever the test put in `__prediction`.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { registerNextEdit } from '../editor/src/nextedit.ts'

const log: [string, any][] = []
const settings: Record<string, unknown> = { nextEdit: false }
const none = () => ({ dispose() {} })
;(window as any).orca = {
  locale: 'en',
  settings: { get: async (key?: string) => (key === undefined ? settings : settings[key]), onDidChange: none },
  plugin: {
    on: none,
    request: async (name: string, input: any) => {
      log.push([name, input])
      return name === 'edits.predict' ? { edit: (window as any).__prediction ?? null } : {}
    }
  }
}

const model = monaco.editor.createModel('', 'plaintext')
const editor = monaco.editor.create(document.getElementById('root')!, { model, automaticLayout: true })
registerNextEdit(monaco, editor, { fileName: () => 'untitled.ts', isProse: () => false, isExternal: () => (window as any).__external === true })

/** What is proposed now: the text it would put in, and where. */
const proposed = () =>
  model
    .getAllDecorations()
    .filter((d) => d.options.after?.inlineClassName === 'orca-next-edit-new')
    .map((d) => ({ text: d.options.after!.content, start: model.getOffsetAt(d.range.getStartPosition()), end: model.getOffsetAt(d.range.getEndPosition()) }))

Object.assign(window, { __editor: editor, __log: log, __settings: settings, __proposed: proposed })
