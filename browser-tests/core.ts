// Page for the browser tests of the part that needs no model: the snippet and postfix providers running
// in the real Monaco, in a TypeScript model with no language service, so only they can answer.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { registerPostfix } from '../editor/src/postfix.ts'
import { registerSnippets } from '../editor/src/snippets.ts'

monaco.languages.register({ id: 'typescript' })
registerSnippets(monaco)
registerPostfix(monaco)
const model = monaco.editor.createModel('', 'typescript')
const editor = monaco.editor.create(document.getElementById('root')!, { model, automaticLayout: true })
Object.assign(window, { __editor: editor })
