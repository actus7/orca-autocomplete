// Gray "ghost text" suggestions from the plugin's worker, which asks the person's AI provider.
// It also tells the worker what became of each suggestion (shown, accepted, kept ...) for the
// statistics in the panel; that stays on this computer.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { trackAcceptance, type TrackedModel } from './acceptance.ts'
import { contextAround } from './edits.ts'

// The same limits Orca's own editor uses for its hook, so both paths see the same amount of code.
const PREFIX_MAX_CHARS = 32 * 1024
const SUFFIX_MAX_CHARS = 8 * 1024
// Why: a suggestion per keystroke would hammer the provider; wait until typing pauses.
const PAUSE_MS = 300
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
  const idOf = (item: Monaco.languages.InlineCompletion): number => Number(item.command?.arguments?.[0]) || 0

  const accepted = monaco.editor.registerCommand(ACCEPTED_COMMAND, (_accessor, id: number, text: string) => {
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
      if (!(await pause(PAUSE_MS, token))) {
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
      return {
        items: [
          {
            insertText: suggestion,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            command: { id: ACCEPTED_COMMAND, title: '', arguments: [id, suggestion] }
          }
        ]
      }
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

  return {
    dispose() {
      provider.dispose()
      accepted.dispose()
    }
  }
}
