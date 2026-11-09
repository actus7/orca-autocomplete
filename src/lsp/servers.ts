// Which language server to run for a language, and finding it on this computer. Nothing is bundled
// or downloaded: a server is used only when the person already has it installed.
import { existsSync } from 'node:fs'
import { dirname, join, posix, win32 } from 'node:path'

export type ServerContext = { root: string; documentPath: string; executable: string }

export type ServerSpec = {
  name: string
  command: string
  args: string[]
  /** Settings the server wants at startup, found from where the file lives. */
  initializationOptions?(context: ServerContext): unknown
}

/**
 * The project's TypeScript, which typescript-language-server needs and does not bundle. Looks in the
 * `node_modules` of the file's folder and each folder above it up to the workspace, then beside the
 * server itself.
 */
export function findTypeScriptServer(
  context: ServerContext,
  exists: (path: string) => boolean = existsSync
): string | null {
  const relative = join('node_modules', 'typescript', 'lib', 'tsserver.js')
  let directory = dirname(context.documentPath)
  for (;;) {
    if (exists(join(directory, relative))) {
      return join(directory, relative)
    }
    if (directory === context.root || dirname(directory) === directory) {
      break
    }
    directory = dirname(directory)
  }
  const beside = join(dirname(context.executable), relative)
  return exists(beside) ? beside : null
}

const tsServer: ServerSpec = {
  name: 'typescript-language-server',
  command: 'typescript-language-server',
  args: ['--stdio'],
  initializationOptions(context) {
    const path = findTypeScriptServer(context)
    return path ? { tsserver: { path } } : undefined
  }
}
const clangd: ServerSpec = { name: 'clangd', command: 'clangd', args: [] }

/** Candidates per language of the editor, best first. Languages with a built-in service are left out on purpose. */
const SERVERS: Record<string, readonly ServerSpec[]> = {
  typescript: [tsServer],
  javascript: [tsServer],
  python: [
    { name: 'pyright', command: 'pyright-langserver', args: ['--stdio'] },
    { name: 'python-lsp-server', command: 'pylsp', args: [] },
    { name: 'ruff', command: 'ruff', args: ['server'] }
  ],
  go: [{ name: 'gopls', command: 'gopls', args: [] }],
  rust: [{ name: 'rust-analyzer', command: 'rust-analyzer', args: [] }],
  cpp: [clangd],
  kotlin: [{ name: 'kotlin-language-server', command: 'kotlin-language-server', args: [] }],
  csharp: [{ name: 'csharp-ls', command: 'csharp-ls', args: [] }],
  php: [{ name: 'intelephense', command: 'intelephense', args: ['--stdio'] }],
  ruby: [{ name: 'solargraph', command: 'solargraph', args: ['stdio'] }],
  swift: [{ name: 'sourcekit-lsp', command: 'sourcekit-lsp', args: [] }],
  shell: [{ name: 'bash-language-server', command: 'bash-language-server', args: ['start'] }],
  lua: [{ name: 'lua-language-server', command: 'lua-language-server', args: [] }],
  dart: [{ name: 'dart', command: 'dart', args: ['language-server', '--protocol=lsp'] }],
  yaml: [{ name: 'yaml-language-server', command: 'yaml-language-server', args: ['--stdio'] }]
}

/** The LSP `languageId` for a file, which is finer than the editor's language (tsx, c versus cpp). */
const LSP_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp'
}

export function lspLanguageId(editorLanguage: string, filePath: string): string {
  const extension = /\.[^./\\]+$/.exec(filePath)?.[0].toLowerCase() ?? ''
  return LSP_LANGUAGE_BY_EXTENSION[extension] ?? editorLanguage
}

type Environment = { PATH?: string; Path?: string; PATHEXT?: string }

/** The full path of a command on PATH, or null. Windows also tries the PATHEXT extensions. */
export function findExecutable(
  command: string,
  env: Environment = process.env,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync
): string | null {
  const flavour = platform === 'win32' ? win32 : posix
  const directories = (env.PATH ?? env.Path ?? '').split(flavour.delimiter).filter(Boolean)
  // Why not the bare name on Windows: npm leaves a Unix script with no extension beside the .cmd, and
  // Windows cannot run it. Only the PATHEXT forms (.exe, .cmd ...) are runnable there.
  const extensions =
    platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((extension) => extension.toLowerCase()) : ['']
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = flavour.join(directory, command + extension)
      if (exists(candidate)) {
        return candidate
      }
    }
  }
  return null
}

/** The first candidate for a language that is installed, with where it was found. */
export function pickServer(
  language: string,
  find: (command: string) => string | null = (command) => findExecutable(command)
): { spec: ServerSpec; path: string } | null {
  for (const spec of SERVERS[language] ?? []) {
    const path = find(spec.command)
    if (path) {
      return { spec, path }
    }
  }
  return null
}
