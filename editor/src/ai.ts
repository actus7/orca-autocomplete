// Gray "ghost text" suggestions from the plugin's worker, which asks the person's AI provider.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { contextAround } from './edits.ts'

// The same limits Orca's own editor uses for its hook, so both paths see the same amount of code.
const PREFIX_MAX_CHARS = 32 * 1024
const SUFFIX_MAX_CHARS = 8 * 1024
// Why: a suggestion per keystroke would hammer the provider; wait until typing pauses.
const PAUSE_MS = 300

function pause(ms: number, token: Monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms)
    token.onCancellationRequested(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

export function registerInlineAi(monaco: typeof Monaco, filePath: () => string): Monaco.IDisposable {
  // Why '*': the language of the one open file can change (the generic editor detects it).
  return monaco.languages.registerInlineCompletionsProvider('*', {
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
      let suggestion = ''
      try {
        suggestion = (await orca.plugin.request('completion.ask', { path: filePath(), languageId: model.getLanguageId(), prefix, suffix })).suggestion
      } catch {
        // Why: the status item already says what is wrong; a failed request just offers nothing.
        return { items: [] }
      }
      // Why: an answer for text or a cursor that already moved would flash stale ghost text.
      if (!suggestion || token.isCancellationRequested || model.getVersionId() !== version) {
        return { items: [] }
      }
      return {
        items: [
          {
            insertText: suggestion,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
          }
        ]
      }
    },
    // Monaco calls the free/dispose pair when a suggestion list is done; there is nothing to release.
    freeInlineCompletions() {},
    disposeInlineCompletions() {}
  } as Monaco.languages.InlineCompletionsProvider)
}
