// The next edit, shown in the editor. After the person changes something and pauses, one proposal may appear:
// the text it would replace is struck through and the new text sits beside it. Tab applies it (one undo step
// undoes it) and Esc dismisses it; typing anything dismisses it too.
//
// Two sources, in this order. First a rename carried over: a name was changed in one place, so the same name
// in the other places is offered, one at a time, with no model. Then, only when the person turned it on, the
// model is asked what comes next. Either way nothing is applied until the person says so.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { describeChange } from './changed-lines.ts'
import { smallestEdit } from './edits.ts'
import { nextOccurrence, repeatRename, type NextEdit, type Rename } from './repeat.ts'
import { say } from './strings.ts'

// How long the person has to stop typing before a next edit is looked for.
const SETTLE_MS = 900
// Lines of the file around the change that the model is shown.
const CONTEXT_LINES = 25
const CONTEXT_KEY = 'orcaNextEdit'
// Tab and Esc belong to the gray suggestion, the suggestion list and snippets first.
const WHEN = `${CONTEXT_KEY} && !inlineSuggestionVisible && !suggestWidgetVisible && !inSnippetMode`
// The colours are the theme's own for removed and added text, so the proposal reads like a diff in light and dark.
const STYLE = `
.orca-next-edit-old { background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 92, 92, 0.22)); text-decoration: line-through; border-radius: 2px; }
.orca-next-edit-new { background: var(--vscode-diffEditor-insertedTextBackground, rgba(64, 192, 96, 0.28)); border-radius: 2px; margin-left: 2px; }
.orca-next-edit-key { margin-left: 6px; padding: 0 4px; border: 1px solid var(--vscode-editorGhostText-foreground, currentColor); border-radius: 3px; color: var(--vscode-editorGhostText-foreground, inherit); font-size: 0.8em; opacity: 0.9; }
`
// The key that applies the proposal, shown beside it: a proposal nobody knows how to take is only noise.
const KEY_HINT = 'Tab'

type Shown = { edit: NextEdit; rename: Rename | null }

export interface NextEditHost {
  /** Names the file's kind for the model (a frame never learns the real name). */
  fileName: () => string
  /** Writing, not code: no edit is predicted for it. */
  isProse: () => boolean
  /** True while the editor is applying a change that came from outside, not from the person. */
  isExternal: () => boolean
}

export function registerNextEdit(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor, host: NextEditHost): Monaco.IDisposable {
  const model = editor.getModel()
  if (!model) {
    return { dispose() {} }
  }
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const open = editor.createContextKey<boolean>(CONTEXT_KEY, false)
  const decorations = editor.createDecorationsCollection()
  // The text as it was when the person last paused. Why not kept current on every keystroke: reading the whole
  // file costs time in proportion to its size, and only the text before a burst of typing is ever needed.
  let settled = model.getValue()
  let baseline: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown: Shown | null = null
  let applying = false
  let asking = false

  const hide = (): void => {
    shown = null
    decorations.clear()
    open.set(false)
  }

  const show = (edit: NextEdit, rename: Rename | null): void => {
    const range = monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end))
    const end = range.getEndPosition()
    decorations.set([
      {
        range,
        options: {
          inlineClassName: edit.end > edit.start ? 'orca-next-edit-old' : undefined,
          after: { content: edit.text, inlineClassName: 'orca-next-edit-new' },
          hoverMessage: { value: say('nextEdit.hover') }
        }
      },
      { range: monaco.Range.fromPositions(end, end), options: { showIfCollapsed: true, after: { content: KEY_HINT, inlineClassName: 'orca-next-edit-key' } } }
    ])
    shown = { edit, rename }
    open.set(true)
  }

  /** What the model says comes next, shown only if the file is still what it was asked about. */
  const askModel = async (before: string, now: string): Promise<void> => {
    if (asking || host.isProse() || (await orca.settings.get('nextEdit')) !== true) {
      return
    }
    const described = describeChange(before, now, CONTEXT_LINES)
    if (!described) {
      return
    }
    const version = model.getVersionId()
    asking = true
    try {
      const { edit } = await orca.plugin.request('edits.predict', {
        path: host.fileName(),
        languageId: model.getLanguageId(),
        startLine: described.startLine,
        text: described.text,
        recent: described.recent
      })
      // Why checked again: the answer is for the text as it was; the person may have typed since.
      if (!edit || shown || model.getVersionId() !== version || edit.line < 1 || edit.line > model.getLineCount() || model.getLineContent(edit.line) !== edit.old) {
        return
      }
      const splice = smallestEdit(edit.old, edit.new)
      if (!splice) {
        return
      }
      const lineStart = model.getOffsetAt({ lineNumber: edit.line, column: 1 })
      show({ start: lineStart + splice.start, end: lineStart + splice.end, text: splice.text }, null)
    } catch {
      // A next edit that cannot be had is just not shown.
    } finally {
      asking = false
    }
  }

  const settle = (): void => {
    timer = undefined
    const before = baseline
    baseline = null
    const now = model.getValue()
    settled = now
    if (before === null || before === now || editor.getOption(monaco.editor.EditorOption.readOnly)) {
      return
    }
    const cursor = model.getOffsetAt(editor.getPosition() ?? { lineNumber: 1, column: 1 })
    const repeat = repeatRename(before, now, cursor)
    if (repeat) {
      show(repeat.edit, repeat.rename)
      return
    }
    void askModel(before, now)
  }

  const typing = model.onDidChangeContent((event) => {
    if (applying) {
      return
    }
    hide()
    // Only what the person typed is an edit to learn from. A whole new text (`isFlush`), an undo or a redo, and a change
    // that came from outside (Orca reloading the file) are not: after an undo, the "rename" just made is the reverse one.
    if (event.isFlush || event.isUndoing || event.isRedoing || host.isExternal()) {
      baseline = null
      settled = model.getValue()
      clearTimeout(timer)
      return
    }
    baseline ??= settled
    clearTimeout(timer)
    timer = setTimeout(settle, SETTLE_MS)
  })

  const accept = (): void => {
    if (!shown) {
      return
    }
    const { edit, rename } = shown
    hide()
    const range = monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end))
    applying = true
    try {
      // Why the stops: without them Monaco folds this edit into the person's own change before it and into the next
      // applied edit, and one Ctrl+Z would take back all of them instead of this one.
      editor.pushUndoStop()
      editor.executeEdits('orcaNextEdit', [{ range, text: edit.text }])
      editor.pushUndoStop()
    } finally {
      applying = false
    }
    settled = model.getValue()
    baseline = null
    clearTimeout(timer)
    // A rename goes on to the next place that still has the old name.
    const next = rename ? nextOccurrence(settled, rename, edit.start + edit.text.length) : null
    if (rename && next) {
      show(next, rename)
      editor.revealRangeInCenterIfOutsideViewport(monaco.Range.fromPositions(model.getPositionAt(next.start), model.getPositionAt(next.end)))
    }
  }

  const actions = [
    editor.addAction({
      id: 'orcaNextEdit.accept',
      label: say('nextEdit.accept'),
      keybindings: [monaco.KeyCode.Tab],
      precondition: `${WHEN} && !editorHasSelection`,
      run: accept
    }),
    editor.addAction({
      id: 'orcaNextEdit.dismiss',
      label: say('nextEdit.dismiss'),
      keybindings: [monaco.KeyCode.Escape],
      precondition: WHEN,
      run: hide
    })
  ]

  return {
    dispose() {
      clearTimeout(timer)
      typing.dispose()
      decorations.clear()
      actions.forEach((action) => action.dispose())
      style.remove()
    }
  }
}
