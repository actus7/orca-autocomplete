// The panel ↔ worker contract: src/panel.tsx and src/main.ts both read it.
export {}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Whether an API key is stored; the key itself never leaves the worker. */
    'key.status': { input: Record<string, never>; output: { hasKey: boolean } }
    /** Stores the key in the plugin's encrypted secrets; an empty string removes it. */
    'key.set': { input: { key: string }; output: { hasKey: boolean } }
    /** One real completion against the configured provider. */
    'provider.test': { input: Record<string, never>; output: { ok: boolean; message: string } }
  }
}
