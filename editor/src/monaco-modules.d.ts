// A script file on purpose (no top-level import or export), so these are module declarations and not augmentations.
// Monaco's ESM entry points ship no declarations of their own; they expose the same API the package
// describes, so say so once here instead of losing every type.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution' {
  import type { languages } from 'monaco-editor'
  export const typescriptDefaults: languages.typescript.LanguageServiceDefaults
  export const javascriptDefaults: languages.typescript.LanguageServiceDefaults
  export import ScriptTarget = languages.typescript.ScriptTarget
  export import ModuleKind = languages.typescript.ModuleKind
  export import ModuleResolutionKind = languages.typescript.ModuleResolutionKind
  export import JsxEmit = languages.typescript.JsxEmit
}
