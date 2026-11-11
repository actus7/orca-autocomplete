// A custom editor never learns its file's path, but a language server needs one. The open document
// equals the file on disk, so find it: look through the workspaces for a file of the right type
// whose content is exactly this text. If several files are identical there is no safe answer.
//
// A document with unsaved edits equals no file. Then the file it was opened from is the one that still
// shares most of its lines, as long as one file is clearly ahead of the rest.
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type Located =
  | { status: 'found'; path: string; root: string; approximate?: true }
  | { status: 'none' }
  | { status: 'ambiguous' }

// Folders full of generated or foreign files: never the file being edited, and slow to walk.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'target', 'dist', 'build', 'out', '.next', '.nuxt',
  'venv', '__pycache__', 'vendor', 'Pods', 'AppData', 'Library'
])
const MAX_FILES_VISITED = 80_000
const BUDGET_MS = 3000
const BOM_BYTES = 3

// The search by likeness: how alike a file must be, how far ahead of the next one, and how much is read.
const ALIKE_MIN = 0.6
const ALIKE_LEAD = 0.15
const ALIKE_MIN_LINES = 3
const ALIKE_MAX_FILES = 300
const ALIKE_MAX_BYTES = 1_000_000
const ALIKE_BUDGET_MS = 1500
/** A file this many times bigger or smaller than the document cannot share enough lines with it. */
const ALIKE_SIZE_RATIO = 3

type Options = { maxFiles?: number; budgetMs?: number; alikeBudgetMs?: number }

/** What a file is matched by: its extension, or its whole name when it has none (Gemfile). */
function fileKey(name: string): string {
  return (/\.[^.]+$/.exec(name)?.[0] ?? name).toLowerCase()
}

/** The lines that say something: trimmed, without the empty ones. */
function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * How much two texts share, by whole lines: 1 for the same lines, 0 for none in common. A line that
 * appears twice counts twice, so a file of repeated braces does not look like every other file.
 */
export function sharedLines(a: string, b: string): number {
  const linesA = meaningfulLines(a)
  const linesB = meaningfulLines(b)
  if (linesA.length < ALIKE_MIN_LINES || linesB.length < ALIKE_MIN_LINES) {
    return 0
  }
  const left = new Map<string, number>()
  for (const line of linesB) {
    left.set(line, (left.get(line) ?? 0) + 1)
  }
  let shared = 0
  for (const line of linesA) {
    const count = left.get(line) ?? 0
    if (count > 0) {
      shared += 1
      left.set(line, count - 1)
    }
  }
  return shared / Math.max(linesA.length, linesB.length)
}

type Candidate = { path: string; root: string; size: number }

/** The one file that is clearly the document with a few edits on top, if there is such a file. */
async function locateAlike(candidates: Candidate[], content: string, size: number, budgetMs: number): Promise<Located> {
  if (size > ALIKE_MAX_BYTES) {
    return { status: 'none' }
  }
  const deadline = Date.now() + budgetMs
  const near = candidates
    .filter((file) => file.size <= ALIKE_MAX_BYTES && file.size * ALIKE_SIZE_RATIO >= size && file.size <= size * ALIKE_SIZE_RATIO)
    // Why nearest in size first: a few edits barely change the size, so the right file is read early.
    .sort((a, b) => Math.abs(a.size - size) - Math.abs(b.size - size))
    .slice(0, ALIKE_MAX_FILES)
  let best: { file: Candidate; score: number } | null = null
  let second = 0
  for (const file of near) {
    if (Date.now() > deadline) {
      break
    }
    const text = await readFile(file.path, 'utf8').catch(() => null)
    if (text === null) {
      continue
    }
    const score = sharedLines(content, text)
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { file, score }
    } else if (score > second) {
      second = score
    }
  }
  if (!best || best.score < ALIKE_MIN) {
    return { status: 'none' }
  }
  if (best.score - second < ALIKE_LEAD) {
    return { status: 'ambiguous' }
  }
  return { status: 'found', path: best.file.path, root: best.file.root, approximate: true }
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
  const others: Candidate[] = []

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
        if (!info) {
          continue
        }
        let same = false
        if (info.size === size || info.size === size + BOM_BYTES) {
          const text = (await readFile(path, 'utf8').catch(() => null))?.replace(/^﻿/, '')
          same = text === content
        }
        if (same) {
          matches.push({ path, root })
        } else {
          others.push({ path, root, size: info.size })
        }
      }
    }
  }
  if (matches.length === 1) {
    return { status: 'found', ...matches[0] }
  }
  if (matches.length > 1) {
    return { status: 'ambiguous' }
  }
  return locateAlike(others, content, size, options.alikeBudgetMs ?? ALIKE_BUDGET_MS)
}
