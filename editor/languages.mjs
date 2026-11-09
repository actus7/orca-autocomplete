// The languages the plugin's editor opens: one source for the build, the manifest and the tests.
//
// `id` is the Monaco language id and names the page (`editor/pages/<id>.html`). `dir` is the folder
// of Monaco's syntax rules under `basic-languages`. Orca picks the editor by file name, and a frame
// never sees the name, so each language is its own editor.
//
// Orca allows 16 editors per plugin. The 15 main languages get one each; the 16th, `generic`, takes
// every other extension and picks the language from the file's content.
//
// Files Orca opens itself (.ts, .md, .yaml, .env ...) always open in Orca's own editor; ours is then
// one click away in the view toggle. Every other file opens here by default.

/** @typedef {{ id: string, title: string, dir: string, extensions: string[], filenames?: string[] }} Language */

/** @type {Language[]} The languages with an editor of their own. */
export const LANGUAGES = [
  { id: 'typescript', title: 'TypeScript', dir: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'] },
  { id: 'javascript', title: 'JavaScript', dir: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'python', title: 'Python', dir: 'python', extensions: ['.py', '.pyi', '.pyw'] },
  { id: 'go', title: 'Go', dir: 'go', extensions: ['.go'] },
  { id: 'rust', title: 'Rust', dir: 'rust', extensions: ['.rs'] },
  { id: 'java', title: 'Java', dir: 'java', extensions: ['.java'] },
  { id: 'kotlin', title: 'Kotlin', dir: 'kotlin', extensions: ['.kt', '.kts'] },
  { id: 'csharp', title: 'C#', dir: 'csharp', extensions: ['.cs', '.csx'] },
  { id: 'cpp', title: 'C and C++', dir: 'cpp', extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'] },
  { id: 'php', title: 'PHP', dir: 'php', extensions: ['.php'] },
  { id: 'ruby', title: 'Ruby', dir: 'ruby', extensions: ['.rb', '.rake', '.gemspec'], filenames: ['Gemfile', 'Rakefile'] },
  { id: 'swift', title: 'Swift', dir: 'swift', extensions: ['.swift'] },
  { id: 'shell', title: 'Shell', dir: 'shell', extensions: ['.sh', '.bash', '.zsh'] },
  { id: 'sql', title: 'SQL', dir: 'sql', extensions: ['.sql'] },
  { id: 'html', title: 'HTML', dir: 'html', extensions: ['.html', '.htm'] }
]

/** @type {Language[]} Languages the generic editor can show; it picks one by looking at the content. */
const GENERIC_LANGUAGES = [
  { id: 'scss', title: 'CSS', dir: 'scss', extensions: ['.css', '.scss'] },
  { id: 'less', title: 'Less', dir: 'less', extensions: ['.less'] },
  { id: 'xml', title: 'XML', dir: 'xml', extensions: ['.xml'] },
  { id: 'yaml', title: 'YAML', dir: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'markdown', title: 'Markdown', dir: 'markdown', extensions: ['.md'] },
  { id: 'dart', title: 'Dart', dir: 'dart', extensions: ['.dart'] },
  { id: 'lua', title: 'Lua', dir: 'lua', extensions: ['.lua'] },
  { id: 'r', title: 'R', dir: 'r', extensions: ['.r'] },
  { id: 'powershell', title: 'PowerShell', dir: 'powershell', extensions: ['.ps1'] },
  { id: 'bat', title: 'Batch', dir: 'bat', extensions: ['.bat'] },
  { id: 'scala', title: 'Scala', dir: 'scala', extensions: ['.scala'] },
  // `.exs` is left out: the catalog's listing text for this editor is limited to 160 characters and is at the limit.
  { id: 'elixir', title: 'Elixir', dir: 'elixir', extensions: ['.ex'] },
  { id: 'clojure', title: 'Clojure', dir: 'clojure', extensions: ['.clj'] },
  { id: 'perl', title: 'Perl', dir: 'perl', extensions: ['.pl'] },
  { id: 'fsharp', title: 'F#', dir: 'fsharp', extensions: ['.fs'] },
  { id: 'julia', title: 'Julia', dir: 'julia', extensions: ['.jl'] },
  { id: 'hcl', title: 'HCL', dir: 'hcl', extensions: ['.tf'] },
  { id: 'protobuf', title: 'Protocol Buffers', dir: 'protobuf', extensions: ['.proto'] },
  { id: 'graphql', title: 'GraphQL', dir: 'graphql', extensions: ['.graphql'] },
  { id: 'dockerfile', title: 'Dockerfile', dir: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] }
]

export const GENERIC = {
  id: 'generic',
  title: 'Code',
  dir: '',
  // `.txt` is text with no grammar of its own: it opens here and is recognised as plain text.
  extensions: [...GENERIC_LANGUAGES.flatMap((language) => language.extensions), '.txt'],
  filenames: GENERIC_LANGUAGES.flatMap((language) => language.filenames ?? [])
}

/** Every grammar the bundle can load, by Monaco language id. */
export const GRAMMARS = [...LANGUAGES, ...GENERIC_LANGUAGES]

/** The pages to write: one per main language, and the generic one. */
export const PAGES = [...LANGUAGES, GENERIC]

/** The `customEditors` entries of the manifest. */
export function customEditors() {
  return PAGES.map((language) => ({
    id: `code-${language.id}`,
    title: 'Autocomplete',
    extensions: language.extensions,
    ...(language.filenames?.length ? { filenames: language.filenames } : {}),
    entry: `editor/pages/${language.id}.html`,
    priority: 'default',
    frame: 'isolated'
  }))
}

/** The HTML page of one language: it names the language, then loads the shared bundle. */
export function pageFor(language) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <title>${language.title}</title>
    <link rel="stylesheet" href="../dist/main.css" />
    <style>
      html, body, #root { height: 100%; margin: 0; overflow: hidden; }
      body { background: var(--orca-background); color: var(--orca-foreground); }
      .start-failed { display: flex; flex-direction: column; gap: 6px; max-width: 60ch; margin: 0 auto; padding: 48px 24px; font: 13px/1.5 system-ui, sans-serif; }
      .start-failed span { color: var(--orca-muted-foreground); overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__LANGUAGE__ = ${JSON.stringify(language.id)}</script>
    <script type="module" src="../dist/main.js"></script>
  </body>
</html>
`
}
