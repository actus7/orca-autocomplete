// Finding the folder Orca keeps its data in, and the active profile's database inside it. The worker
// is told neither, so look where Orca puts them: the packaged app uses `orca`, a development build
// `orca-dev`, under the platform's application data folder.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Platform = 'win32' | 'darwin' | 'linux' | string

/** The folders that may hold Orca's data on this computer, most likely first for a packaged app. */
export function userDataCandidates(home: string, platform: Platform, xdgConfig?: string): { packaged: string; development: string } {
  const base =
    platform === 'win32'
      ? join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : (xdgConfig || join(home, '.config'))
  return { packaged: join(base, 'orca'), development: join(base, 'orca-dev') }
}

/** Orca's own pattern for a profile id; nothing else is ever put in a path. */
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function activeProfileId(userData: string, read: (path: string) => string | null = readText): string | null {
  const indexPath = join(userData, 'orca-profile-index.json')
  for (const candidate of [indexPath, `${indexPath}.bak`]) {
    const text = read(candidate)
    if (text === null) {
      continue
    }
    try {
      const parsed = JSON.parse(text) as { activeProfileId?: unknown; profiles?: unknown }
      const id = parsed.activeProfileId
      const known = Array.isArray(parsed.profiles) && parsed.profiles.some((p) => (p as { id?: unknown })?.id === id)
      if (typeof id === 'string' && PROFILE_ID.test(id) && known) {
        return id
      }
    } catch {
      // Try the backup of the index before giving up.
    }
  }
  return null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The database of the active profile of the Orca that is running this worker. A packaged Orca runs
 * its plugin host from inside `resources/app.asar`; a development build runs it from the source tree.
 * When only one of the two folders exists there is nothing to choose.
 */
export function findProfileDatabase(options: {
  home?: string
  platform?: Platform
  xdgConfig?: string
  hostEntry?: string
  exists?: (path: string) => boolean
  read?: (path: string) => string | null
} = {}): string | null {
  const exists = options.exists ?? existsSync
  const { packaged, development } = userDataCandidates(options.home ?? homedir(), options.platform ?? process.platform, options.xdgConfig ?? process.env.XDG_CONFIG_HOME)
  const available = [packaged, development].filter((folder) => exists(join(folder, 'orca-profile-index.json')))
  if (available.length === 0) {
    return null
  }
  const entry = (options.hostEntry ?? process.argv[1] ?? '').replaceAll('\\', '/')
  const isPackaged = /\/resources\/app\.asar(\/|$)/.test(entry)
  const folder = available.length === 1 ? available[0] : isPackaged ? packaged : development
  const id = activeProfileId(folder, options.read)
  return id ? join(folder, 'profiles', id, 'profile-state.db') : null
}
