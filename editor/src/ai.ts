// Gray "ghost text" suggestions from the plugin's worker, which asks the person's AI provider.
// It also tells the worker what became of each suggestion (shown, accepted, kept ...) for the
// statistics in the panel; that stays on this computer.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { trackAcceptance, type TrackedModel } from './acceptance.ts'
import { contextAround } from './edits.ts'
import { Pacer } from './pacing.ts'
import { remainder, type Offered } from './reuse.ts'

// The same limits Orca's own editor uses for its hook, so both paths see the same amount of code.
const PREFIX_MAX_CHARS = 32 * 1024
const SUFFIX_MAX_CHARS = 8 * 1024
// Monaco runs this command right after the whole suggestion is inserted; it is the only "accepted" signal it gives.
const ACCEPTED_COMMAND = 'orcaAutocomplete.accepted'
// Ids of shown suggestions remembered so one suggestion is counted once, however often Monaco re-announces it.
const SHOWN_IDS_KEPT = 200

type Kind = 'shown' | 'accepted' | 'partial' | 'kept' | 'undone' | 'stale'

function pause(ms: number, token: Monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms)
    token.onCancellationRequested(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/** What happened to a suggestion; a failure to say so must never disturb typing. */
function report(id: number, kind: Kind): void {
  if (id > 0) {
    void orca.plugin.request('metrics.event', { id, kind }).catch(() => undefined)
  }
}

/** The model seen through the few operations the acceptance tracker needs. */
function trackedModel(monaco: typeof Monaco, model: Monaco.editor.ITextModel): TrackedModel {
  return {
    getEOL: () => model.getEOL(),
    getOffsetAt: (position) => model.getOffsetAt(position),
    getPositionAt: (offset) => model.getPositionAt(offset),
    getValueInRange: (range) => model.getValueInRange(range),
    // Why NeverGrows: text typed right after the suggestion is the person's own, not part of it.
    trackRange: (range) =>
      model.deltaDecorations([], [{ range, options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } }])[0],
    getTrackedRange: (id) => model.getDecorationRange(id),
    untrackRange: (id) => void model.deltaDecorations([id], [])
  }
}

export function registerInlineAi(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  filePath: () => string
): Monaco.IDisposable {
  const shown = new Set<number>()
  const pacer = new Pacer()
  // The suggestion on offer, so typing along it or accepting a word of it does not ask the provider again.
  let offered: (Offered & { id: number }) | null = null
  const idOf = (item: Monaco.languages.InlineCompletion): number => Number(item.command?.arguments?.[0]) || 0

  const changes = editor.onDidChangeModelContent((event) =>
    pacer.noteChange(event.changes.length > 0 && event.changes.every((change) => change.text === ''), Date.now())
  )

  const itemFor = (id: number, text: string, position: Monaco.Position): Monaco.languages.InlineCompletion => ({
    insertText: text,
    range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
    command: { id: ACCEPTED_COMMAND, title: '', arguments: [id, text] }
  })

  const accepted = monaco.editor.registerCommand(ACCEPTED_COMMAND, (_accessor, id: number, text: string) => {
    pacer.noteAccepted(Date.now())
    report(id, 'accepted')
    const model = editor.getModel()
    const cursor = editor.getPosition()
    if (model && cursor) {
      trackAcceptance(trackedModel(monaco, model), { text, cursor }, (verdict) => report(id, verdict))
    }
  })

  // Why '*': the language of the one open file can change (the generic editor detects it).
  const provider = monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, _context, token) {
      const cursor = model.getOffsetAt(position)
      if (offered) {
        const typed = model.getValueInRange(monaco.Range.fromPositions(model.getPositionAt(offered.offset), position))
        const rest = remainder(offered, cursor, typed)
        if (rest) {
          return { items: [itemFor(offered.id, rest, position)] }
        }
        offered = null
      }
      if (!(await pause(pacer.pause(Date.now()), token))) {
        return { items: [] }
      }
      const version = model.getVersionId()
      const { prefix, suffix } = contextAround(
        model.getValue(),
        model.getOffsetAt(position),
        PREFIX_MAX_CHARS,
        SUFFIX_MAX_CHARS
      )
      let answer
      try {
        answer = await orca.plugin.request('completion.ask', { path: filePath(), languageId: model.getLanguageId(), prefix, suffix })
      } catch {
        // Why: the status item already says what is wrong; a failed request just offers nothing.
        return { items: [] }
      }
      const { suggestion, id } = answer
      // Why: an answer for text or a cursor that already moved would flash stale ghost text.
      if (!suggestion || token.isCancellationRequested || model.getVersionId() !== version) {
        if (suggestion) {
          report(id, 'stale')
        }
        return { items: [] }
      }
      offered = { offset: cursor, text: suggestion, id }
      return { items: [itemFor(id, suggestion, position)] }
    },
    handleItemDidShow(_completions, item) {
      const id = idOf(item)
      if (id > 0 && !shown.has(id)) {
        shown.add(id)
        if (shown.size > SHOWN_IDS_KEPT) {
          shown.delete(shown.values().next().value as number)
        }
        report(id, 'shown')
      }
    },
    // Taking a word or a line of it: counted, but not judged for how long it lasts (only a whole acceptance is).
    handlePartialAccept(_completions, item) {
      report(idOf(item), 'partial')
    },
    // Monaco calls this when a suggestion list is done; there is nothing to release.
    freeInlineCompletions() {}
  })

  // Monaco takes a suggestion a word at a time with Ctrl+Right and has a command for a line, but no key for it.
  const acceptLine = editor.addAction({
    id: 'orcaAutocomplete.acceptLine',
    label: 'Autocomplete: accept the next line of the suggestion',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.RightArrow],
    precondition: 'inlineSuggestionVisible',
    run: () => {
      editor.trigger('orcaAutocomplete', 'editor.action.inlineSuggest.acceptNextLine', {})
    }
  })

  return {
    dispose() {
      provider.dispose()
      accepted.dispose()
      changes.dispose()
      acceptLine.dispose()
    }
  }
}
