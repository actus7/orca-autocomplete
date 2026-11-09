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
  }

  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'status.get': { input: Record<string, never>; output: StatusSnapshot }
    /** Stores the key in the plugin's encrypted secrets; an empty string removes it. */
    'key.set': { input: { key: string }; output: { hasKey: boolean } }
    /** The models a provider lists. A blank key uses the saved one; the key is never stored here. */
    'models.list': {
      input: { format: 'openai' | 'anthropic'; baseUrl: string; key: string }
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
    'editor.settings': { input: Record<string, never>; output: { settings: OrcaEditorSettings | null } }
    /** One suggestion for the text around the cursor of the plugin's own editor; '' when there is none. */
    'completion.ask': {
      input: { path: string; languageId: string; prefix: string; suffix: string }
      output: { suggestion: string }
    }
    /** Times one real completion per model (the panel sends a few at a time); nothing is saved. */
    'models.bench': {
      input: { format: 'openai' | 'anthropic'; baseUrl: string; key: string; models: string[] }
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
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'status.changed': StatusSnapshot
    'editor.settings.changed': { settings: OrcaEditorSettings | null }
    'lsp.diagnostics': { docId: string; diagnostics: unknown[] }
    'lsp.status': { docId: string; status: LspStatus }
  }
}
