// Keeps the editor values Orca currently uses, and says when they change. The database file changes
// whenever Orca saves anything, so a cheap check of its size and time decides when to read again.
import { statSync } from 'node:fs'
import { readDocuments, type Documents } from './reader.ts'
import { resolveOrcaEditor, type ResolvedEditor } from './resolve.ts'
import { findProfileDatabase } from './userdata.ts'

const POLL_MS = 1500

export type WatcherOptions = {
  onChange(settings: ResolvedEditor | null): void
  find?: () => string | null | Promise<string | null>
  read?: (databaseFile: string) => Promise<Documents | null>
  stamp?: (databaseFile: string) => string | null
}

function stampOf(path: string): string {
  try {
    const info = statSync(path)
    return `${info.size}:${info.mtimeMs}`
  } catch {
    return '-'
  }
}

/**
 * Orca's database runs in WAL mode: a save lands in the `-wal` file and the main file keeps its old
 * time until a checkpoint, so the change shows in the pair, not in the main file alone.
 */
export function fileStamp(databaseFile: string): string | null {
  const main = stampOf(databaseFile)
  return main === '-' ? null : `${main}|${stampOf(`${databaseFile}-wal`)}`
}

export class EditorSettingsWatcher {
  private readonly options: WatcherOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private lastStamp: string | null = null
  private latest: ResolvedEditor | null = null
  private databaseFile: string | null = null
  private reading = false

  constructor(options: WatcherOptions) {
    this.options = options
  }

  /** The values now, or null when Orca's settings cannot be read (the plugin's own settings apply). */
  current(): ResolvedEditor | null {
    return this.latest
  }

  /** The database file the values come from, so a wrong choice of Orca can be seen. */
  source(): string | null {
    return this.databaseFile
  }

  /** Reads once and keeps watching. Safe to call again. */
  async start(): Promise<ResolvedEditor | null> {
    if (!this.timer) {
      this.timer = setInterval(() => void this.check(), POLL_MS)
      this.timer.unref()
      await this.check(true)
    }
    return this.latest
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Reads again if the database changed; reports only a real change in what the editor uses. */
  async check(force = false): Promise<void> {
    if (this.reading) {
      return
    }
    this.reading = true
    try {
      const file = await (this.options.find ?? findProfileDatabase)()
      const stamp = file ? (this.options.stamp ?? fileStamp)(file) : null
      if (!force && stamp === this.lastStamp) {
        return
      }
      this.lastStamp = stamp
      this.databaseFile = file
      const documents = file ? await (this.options.read ?? readDocuments)(file) : null
      const next = documents?.settings ? resolveOrcaEditor(documents.settings, documents.ui) : null
      if (JSON.stringify(next) !== JSON.stringify(this.latest)) {
        this.latest = next
        this.options.onChange(next)
      }
    } finally {
      this.reading = false
    }
  }
}
