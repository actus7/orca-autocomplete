// The plugin's editor: Monaco in Orca's isolated frame, bound to the open file through Orca's
// document session, with AI ghost text from the plugin's worker.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { GRAMMARS } from '../languages.mjs'
import { registerInlineAi } from './ai.ts'
import { detectLanguage } from './detect.ts'
import { NATIVE_OPTIONS, PLUGIN_OPTIONS, settingOptions, themeFor, type OrcaEditor } from './editor-options.ts'
import { smallestEdit } from './edits.ts'
import { startLanguageServer } from './lsp.ts'
import { grammarLoaders, grammarOf } from './languages.generated.ts'
import { registerNextEdit } from './nextedit.ts'
import { registerPostfix } from './postfix.ts'
import { prepareLanguageService, stepAsideBuiltInTypeScript, workerFileFor } from './services.ts'
import { registerSnippets } from './snippets.ts'
import { say } from './strings.ts'
import { followOrcaTheme, isDark } from './theme.ts'

const page = window.__LANGUAGE__ ?? 'plaintext'
// Re-reading the content for the language is cheap but pointless on every keystroke.
const DETECT_DELAY_MS = 800
const root = document.getElementById('root') as HTMLElement

// Monaco and its language services compute in workers; each one sits beside this file.
window.MonacoEnvironment = {
  getWorker: (_id, label) => new Worker(new URL(workerFileFor(label), import.meta.url), { type: 'module' })
}

async function start(): Promise<void> {
  // Resolves once Orca has sent the theme and the first document.
  if (!orca.document) {
    throw new Error('this page only works as an Orca editor')
  }
  const session = await orca.document.session()
  followOrcaTheme()

  // The generic editor does not know the language until it sees the content.
  const generic = page === 'generic'
  const language = generic ? detectLanguage(session.value) : page
  // Why: only this file's grammar loads, so a Python file does not download the C++ rules.
  await grammarLoaders[grammarOf[language]]?.()

  // A language with a service of its own needs it ready, and sometimes a model name, before the model exists.
  const name = await prepareLanguageService(monaco, language, session.value)
  const model = monaco.editor.createModel(session.value, language, name)
  // Orca's own editor options first, then this plugin's additions, then what Orca's settings say (or,
  // when they cannot be read, the plugin's own settings).
  let orcaEditor: OrcaEditor | null = (await orca.plugin.request('editor.settings', {}).catch(() => ({ settings: null }))).settings
  const editor = monaco.editor.create(root, {
    model,
    theme: themeFor(isDark()),
    readOnly: session.readOnly,
    ...NATIVE_OPTIONS,
    ...PLUGIN_OPTIONS,
    ...settingOptions(await orca.settings.get(), orcaEditor)
  })
  // Font, size, wrap, minimap ... changed in Orca or in this plugin: apply it without reopening the file.
  const refreshOptions = (): void => {
    void orca.settings.get().then((settings) => editor.updateOptions(settingOptions(settings, orcaEditor)))
  }
  orca.settings.onDidChange(refreshOptions)
  orca.plugin.on('editor.settings.changed', (change) => {
    orcaEditor = change.settings
    refreshOptions()
  })

  // True while a change from Orca (the file changed underneath) is being applied, so it is not taken for typing.
  let applying = false

  // The suggestion prompt names the file; a frame never learns the real name, so use its type.
  const fileName = (): string => `untitled${GRAMMARS.find((entry) => entry.id === model.getLanguageId())?.extensions[0] ?? ''}`
  registerInlineAi(monaco, editor, fileName)
  // The part that needs no model and no server: snippets and postfix templates, with the AI off as with it on.
  registerSnippets(monaco)
  registerPostfix(monaco)
  // After an edit and a pause: the same rename in the other places (no model), or what the model says comes next.
  registerNextEdit(monaco, editor, {
    fileName,
    isProse: () => ['markdown', 'plaintext'].includes(model.getLanguageId()),
    isExternal: () => applying
  })

  // A language server installed on this computer, when there is one and the file is in a workspace.
  const grammar = GRAMMARS.find((entry) => entry.id === language)
  void startLanguageServer(monaco, model, {
    language,
    extensions: [...(grammar?.extensions ?? []), ...(grammar?.filenames ?? [])],
    onServed: () => {
      if (language === 'typescript' || language === 'javascript') {
        void stepAsideBuiltInTypeScript()
      }
    }
  }).catch((error: unknown) => console.warn('language server unavailable', error))

  if (generic) {
    // A new empty file gets its language when it first has something to recognise.
    let timer: ReturnType<typeof setTimeout> | undefined
    model.onDidChangeContent(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const detected = detectLanguage(model.getValue())
        if (detected === model.getLanguageId()) {
          return
        }
        void (async () => {
          await grammarLoaders[grammarOf[detected]]?.()
          await prepareLanguageService(monaco, detected, model.getValue())
          monaco.editor.setModelLanguage(model, detected)
        })().catch((error: unknown) => console.warn('language could not be loaded', error))
      }, DETECT_DELAY_MS)
    })
  }

  // Orca owns the file; keep the editor and Orca's copy equal without echoing our own edits back.
  model.onDidChangeContent(() => {
    if (!applying) {
      session.change(model.getValue())
    }
  })
  session.onReplace((text) => {
    const edit = smallestEdit(model.getValue(), text)
    if (!edit) {
      return
    }
    applying = true
    try {
      const range = monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end))
      // Why: a minimal edit keeps the cursor, scroll position and undo history of the person.
      model.pushEditOperations([], [{ range, text: edit.text }], () => null)
    } finally {
      applying = false
    }
  })

  editor.focus()
}

start().catch((error: unknown) => {
  // Orca copies frame errors into the plugin's log; also say it on screen so the tab is not blank.
  console.error(error)
  const failure = document.createElement('div')
  failure.className = 'start-failed'
  failure.setAttribute('role', 'alert')
  const title = document.createElement('strong')
  title.textContent = say('start.failed')
  const detail = document.createElement('span')
  detail.textContent = error instanceof Error ? error.message : String(error)
  failure.append(title, detail)
  root.replaceChildren(failure)
})
