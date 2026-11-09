// The language services Monaco brings along (TypeScript and JavaScript, HTML, CSS, SCSS, Less). They
// run in the frame in their own workers, with no network and nothing to install, and give errors,
// completion, hover, go to definition and rename for those languages.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { looksLikeJsx, serviceModelName } from './services-config.ts'

// Why these codes: the frame sees a single file, never node_modules, so "cannot find module" and the
// missing Node and test globals would be reported on every import of a normal project.
const MISSING_PROJECT_CODES = [2307, 2792, 7016, 2688, 2580, 2581, 2582, 2591, 2592, 2593, 2503]

type TypeScriptApi = typeof import('monaco-editor/esm/vs/language/typescript/monaco.contribution')

const loaded = new Set<string>()

async function typescript(): Promise<TypeScriptApi> {
  const ts = (await import('monaco-editor/esm/vs/language/typescript/monaco.contribution')) as unknown as TypeScriptApi
  if (!loaded.has('typescript')) {
    loaded.add('typescript')
    const options = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      allowNonTsExtensions: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true
    }
    for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      defaults.setCompilerOptions(options)
      defaults.setEagerModelSync(true)
      defaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        diagnosticCodesToIgnore: MISSING_PROJECT_CODES
      })
    }
  }
  return ts
}

/**
 * Makes the language's service ready and returns the name its model needs, since the TypeScript
 * service tells `.ts` from `.tsx` by the model's name. Languages without a service return undefined.
 */
export async function prepareLanguageService(
  monaco: typeof Monaco,
  language: string,
  content: string
): Promise<Monaco.Uri | undefined> {
  switch (language) {
    case 'typescript':
    case 'javascript':
      await typescript()
      return monaco.Uri.parse(serviceModelName(language, looksLikeJsx(content)))
    case 'html':
      await import('monaco-editor/esm/vs/language/html/monaco.contribution')
      return undefined
    case 'css':
    case 'scss':
    case 'less':
      await import('monaco-editor/esm/vs/language/css/monaco.contribution')
      return undefined
    default:
      return undefined
  }
}

/** The worker file Monaco should start for a language service label. */
export function workerFileFor(label: string): string {
  switch (label) {
    case 'typescript':
    case 'javascript':
      return './ts.worker.js'
    case 'css':
    case 'scss':
    case 'less':
      return './css.worker.js'
    case 'html':
    case 'handlebars':
    case 'razor':
      return './html.worker.js'
    default:
      return './editor.worker.js'
  }
}

/**
 * Turns the built-in TypeScript and JavaScript service off. Used when a real language server serves
 * the file, so errors, completion and hover do not appear twice.
 */
export async function stepAsideBuiltInTypeScript(): Promise<void> {
  const ts = await typescript()
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true })
    defaults.setModeConfiguration({
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      diagnostics: false,
      documentRangeFormattingEdits: false,
      signatureHelp: false,
      onTypeFormattingEdits: false,
      codeActions: false,
      inlayHints: false
    })
  }
}
