// Finding the folder Orca keeps its data in, and the active profile's database inside it. The worker
// is told neither, so look where Orca puts them: the packaged app uses `orca`, a development build
// `orca-dev`, under the platform's application data folder.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { userDataDirOfHost } from './host-process.ts'

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

export type FindOptions = {
  home?: string
  platform?: Platform
  xdgConfig?: string
  hostEntry?: string
  parentPid?: number
  exists?: (path: string) => boolean
  read?: (path: string) => string | null
  userDataOfHost?: (pid: number) => Promise<string | null>
}

/** The worker's host does not change while the worker runs, so ask the system about it once. */
const hostFolderCache = new Map<number, Promise<string | null>>()

function hostFolder(pid: number, ask: (pid: number) => Promise<string | null>, cache: boolean): Promise<string | null> {
  if (!cache) {
    return ask(pid)
  }
  let known = hostFolderCache.get(pid)
  if (!known) {
    known = ask(pid)
    hostFolderCache.set(pid, known)
  }
  return known
}

/**
 * The database of the active profile of the Orca that is running this worker, or null when that
 * cannot be told (the plugin's own settings then apply). Reading another Orca's settings would be
 * worse than reading none, so it goes by what identifies this Orca:
 *  1. the folder it was started with (`--user-data-dir` on its own command line), which is exact; else
 *  2. the usual folder for its kind. A packaged Orca runs its plugin host from `resources/app.asar`
 *     (unpacked beside it, as `app.asar.unpacked`); a development build runs it from its source tree.
 */
export async function findProfileDatabase(options: FindOptions = {}): Promise<string | null> {
  const exists = options.exists ?? existsSync
  const { packaged, development } = userDataCandidates(options.home ?? homedir(), options.platform ?? process.platform, options.xdgConfig ?? process.env.XDG_CONFIG_HOME)
  const hasProfiles = (folder: string): boolean => exists(join(folder, 'orca-profile-index.json'))
  const entry = (options.hostEntry ?? process.argv[1] ?? '').replaceAll('\\', '/')
  const isPackaged = /\/resources\/app\.asar(\.unpacked)?(\/|$)/.test(entry)

  const asked = await hostFolder(options.parentPid ?? process.ppid, options.userDataOfHost ?? userDataDirOfHost, options.userDataOfHost === undefined)
  const usual = isPackaged ? packaged : development
  const folder = asked && hasProfiles(asked) ? asked : hasProfiles(usual) ? usual : null
  const id = folder ? activeProfileId(folder, options.read) : null
  return folder && id ? join(folder, 'profiles', id, 'profile-state.db') : null
}
