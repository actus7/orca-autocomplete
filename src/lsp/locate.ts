// A custom editor never learns its file's path, but a language server needs one. The open document
// equals the file on disk, so find it: look through the workspaces for a file of the right type
// whose content is exactly this text. If several files are identical there is no safe answer.
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type Located = { status: 'found'; path: string; root: string } | { status: 'none' } | { status: 'ambiguous' }

// Folders full of generated or foreign files: never the file being edited, and slow to walk.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'target', 'dist', 'build', 'out', '.next', '.nuxt',
  'venv', '__pycache__', 'vendor', 'Pods', 'AppData', 'Library'
])
const MAX_FILES_VISITED = 80_000
const BUDGET_MS = 3000
const BOM_BYTES = 3

type Options = { maxFiles?: number; budgetMs?: number }

/** What a file is matched by: its extension, or its whole name when it has none (Gemfile). */
function fileKey(name: string): string {
  return (/\.[^.]+$/.exec(name)?.[0] ?? name).toLowerCase()
}

export async function locateFile(
  roots: readonly string[],
  extensions: readonly string[],
  content: string,
  options: Options = {}
): Promise<Located> {
  const wanted = new Set(extensions.map((extension) => extension.toLowerCase()))
  const size = Buffer.byteLength(content, 'utf8')
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS)
  let visited = 0
  const matches: { path: string; root: string }[] = []

  // Why breadth-first: the file being edited is nearly always close to the workspace root, so a huge
  // tree (a home folder used as a workspace) must not use up the time before the shallow files are seen.
  const queue = roots.map((root) => ({ root, directory: root }))
  for (let next = 0; next < queue.length; next += 1) {
    const { root, directory } = queue[next]
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (Date.now() > deadline || visited > (options.maxFiles ?? MAX_FILES_VISITED)) {
        break
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ root, directory: path })
        }
      } else if (entry.isFile() && wanted.has(fileKey(entry.name))) {
        visited += 1
        // Why stat first: reading every file of a large repository would take far too long.
        const info = await stat(path).catch(() => null)
        if (info && (info.size === size || info.size === size + BOM_BYTES)) {
          const text = (await readFile(path, 'utf8').catch(() => null))?.replace(/^\uFEFF/, '')
          if (text === content) {
            matches.push({ path, root })
          }
        }
      }
    }
  }
  if (matches.length === 1) {
    return { status: 'found', ...matches[0] }
  }
  return matches.length === 0 ? { status: 'none' } : { status: 'ambiguous' }
}
