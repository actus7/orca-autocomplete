// The panel ↔ worker contract: src/panel.tsx and src/main.ts both read it.
export {}

declare module 'orca' {
  export type LspStatus =
    | { state: 'ready'; server: string; path: string; uri: string; capabilities: Record<string, unknown> }
    | { state: 'none' | 'off' | 'ambiguous' | 'no-file' }
    | { state: 'error'; message: string }
  /** What Orca's own editor uses, so the plugin's editor can match it. */
  export type OrcaEditorSettings = {
    fontFamily: string
    fontSize: number
    fontWeight: string
    lineHeight: number
    fontLigatures: boolean
    wordWrap: boolean
    minimap: boolean
  }
  export type StatusState = 'on' | 'off' | 'setup' | 'slow' | 'error'
  /** How a provider is asked; see ProviderFormat in src/complete.ts. */
  export type ProviderFormatName = 'openai' | 'anthropic' | 'ollama' | 'mistral-fim'
  export type StatsSnapshot = {
    model: string
    /** When counting started (ms since 1970). */
    since: number
    summary: {
      shown: number
      accepted: number
      partial: number
      kept: number
      undone: number
      stale: number
      /** Milliseconds; null before the first answer. */
      p50: number | null
      p95: number | null
      samples: number
    }
  }
  export type StatusSnapshot = {
    state: StatusState
    /** Milliseconds the last suggestion took, null before the first one. */
    lastMs: number | null
    /** Suggestions shown since Orca started. */
    suggested: number
    /** One sentence about the last failure, already in the person's language. */
    reason: string | null
    host: string
    model: string
    hasKey: boolean
    /** Where the code near the cursor goes: nowhere (AI off or not set up), this computer, or a server elsewhere. */
    destination: 'none' | 'local' | 'remote'
  }

  interface PluginRequests {
    'status.get': { input: Record<string, never>; output: StatusSnapshot }
    /** Stores the key in the plugin's encrypted secrets; an empty string removes it. */
    'key.set': { input: { key: string }; output: { hasKey: boolean } }
    /** The models a provider lists. A blank key uses the saved one; the key is never stored here. */
    'models.list': {
      input: { format: ProviderFormatName; baseUrl: string; key: string }
      output: { ok: boolean; models: string[]; message: string }
    }
    /** The editor asks for a language server for its document; the answer says what is running or why not. */
    'lsp.attach': {
      input: { docId: string; language: string; extensions: string[]; content: string }
      output: { status: LspStatus }
    }
    /** The document's whole new text, so the server stays in step. */
    'lsp.sync': { input: { docId: string; text: string }; output: Record<string, never> }
    /** Any LSP request about the document (the worker adds the document's address). */
    'lsp.request': {
      input: { docId: string; method: string; params: Record<string, unknown> }
      output: { result: unknown; error?: string }
    }
    'lsp.detach': { input: { docId: string }; output: Record<string, never> }
    /** How Orca's editor looks now, or null when Orca's settings cannot be read. */
    'editor.settings': {
      input: Record<string, never>
      output: { settings: OrcaEditorSettings | null; source: string | null }
    }
    /**
     * One suggestion for the text around the cursor of the plugin's own editor; '' when there is none.
     * `id` names the suggestion so the editor can report what became of it (`metrics.event`); 0 when there is none.
     */
    'completion.ask': {
      input: { path: string; languageId: string; prefix: string; suffix: string }
      output: { suggestion: string; id: number }
    }
    /**
     * The next edit, asked of the model after the person changed something: replace the whole line `line`, which
     * is `old`, with `new`. Null when the setting is off, the provider cannot be asked this way, or the model had
     * nothing to propose that holds up. The editor shows it and the person decides.
     */
    'edits.predict': {
      input: { path: string; languageId: string; startLine: number; text: string; recent: { line: number; before: string; after: string }[] }
      output: { edit: { line: number; old: string; new: string } | null }
    }
    /** What became of a suggestion the editor showed. Kept on this computer only, for the statistics in the panel. */
    'metrics.event': {
      input: { id: number; kind: 'shown' | 'accepted' | 'partial' | 'kept' | 'undone' | 'stale' }
      output: Record<string, never>
    }
    /** How the suggestions of the model in use have done so far. */
    'stats.get': { input: Record<string, never>; output: StatsSnapshot }
    /** Starts the statistics again from zero. */
    'stats.reset': { input: Record<string, never>; output: Record<string, never> }
    /** Times one real completion per model (the panel sends a few at a time); nothing is saved. */
    'models.bench': {
      input: { format: ProviderFormatName; baseUrl: string; key: string; models: string[] }
      output: { results: { model: string; ok: boolean; ms: number | null }[]; message: string }
    }
    /** Median latency of the real suggestions each model gave, newest samples only. */
    'models.usage': {
      /** Only what was measured against this address is returned. */
      input: { baseUrl: string }
      output: { usage: Record<string, { ms: number; uses: number }> }
    }
    /** One real completion against the configured provider. */
    'provider.test': {
      input: Record<string, never>
      output: { ok: boolean; message: string; ms: number | null }
    }
  }
  interface PluginPanelEvents {
    'status.changed': StatusSnapshot
    'editor.settings.changed': { settings: OrcaEditorSettings | null }
    'lsp.diagnostics': { docId: string; diagnostics: unknown[] }
    'lsp.status': { docId: string; status: LspStatus }
  }
}
