// Reads the two documents of Orca's profile database that decide how its editor looks: `settings`
// and `ui` (the editor zoom). Read-only, one fixed query, and nothing else in the database is ever
// selected: the same database also holds data this plugin has no business reading.
export type Documents = { settings: Record<string, unknown> | null; ui: Record<string, unknown> | null }

const BUSY_TIMEOUT_MS = 250

function asRecord(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** null when the database cannot be read right now (missing, locked, a newer layout, no sqlite). */
export async function readDocuments(databaseFile: string): Promise<Documents | null> {
  try {
    // Why lazy: a Node without node:sqlite must only lose this feature, not the whole plugin.
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databaseFile, { readOnly: true })
    try {
      database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
      const rows = database
        .prepare("SELECT domain, payload FROM profile_state_documents WHERE domain IN ('settings', 'ui')")
        .all() as { domain: string; payload: string }[]
      const byDomain = new Map(rows.map((row) => [row.domain, asRecord(row.payload)]))
      return { settings: byDomain.get('settings') ?? null, ui: byDomain.get('ui') ?? null }
    } finally {
      database.close()
    }
  } catch {
    return null
  }
}
