// The panel ↔ worker contract: src/panel.tsx and src/main.ts both read it.
export {}

declare module 'orca' {
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
    /** One real completion against the configured provider. */
    'provider.test': {
      input: Record<string, never>
      output: { ok: boolean; message: string; ms: number | null }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'status.changed': StatusSnapshot
  }
}
