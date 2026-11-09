// The few words the editor itself says (the panel and the worker have theirs in src/i18n.ts), in English
// and Brazilian Portuguese, following Orca's language.
import { pickLocale } from '../../src/i18n.ts'

const en = {
  'nextEdit.hover': 'Suggested edit: Tab applies it, Esc dismisses it.',
  'nextEdit.accept': 'Autocomplete: apply the suggested edit',
  'nextEdit.dismiss': 'Autocomplete: dismiss the suggested edit',
  'ghost.acceptLine': 'Autocomplete: accept the next line of the suggestion',
  'lsp.ready': 'Language server',
  'lsp.stopped': 'Language server stopped',
  'rename.otherFiles': 'Renaming this would also change {count} other file(s), which this editor cannot apply yet.',
  'rename.nothing': 'Nothing to rename here.',
  'rename.cannot': 'This cannot be renamed.',
  'start.failed': 'Autocomplete could not start'
} as const

export type EditorKey = keyof typeof en

const pt: Record<EditorKey, string> = {
  'nextEdit.hover': 'Edição sugerida: Tab aplica, Esc descarta.',
  'nextEdit.accept': 'Autocomplete: aplicar a edição sugerida',
  'nextEdit.dismiss': 'Autocomplete: descartar a edição sugerida',
  'ghost.acceptLine': 'Autocomplete: aceitar a próxima linha da sugestão',
  'lsp.ready': 'Servidor de linguagem',
  'lsp.stopped': 'O servidor de linguagem parou',
  'rename.otherFiles': 'Renomear isto também mudaria {count} outro(s) arquivo(s), o que este editor ainda não consegue aplicar.',
  'rename.nothing': 'Nada para renomear aqui.',
  'rename.cannot': 'Isto não pode ser renomeado.',
  'start.failed': 'O Autocomplete não conseguiu iniciar'
}

export const EDITOR_STRINGS = { en, pt }

/** A string in Orca's language. Why read the language each time: the page's `orca` object arrives after this module loads. */
export function say(key: EditorKey, vars: Record<string, string | number> = {}): string {
  // Why the check: this also words the failure of a page that was opened outside Orca, where there is no `orca`.
  const locale = pickLocale(typeof orca === 'undefined' ? null : orca.locale)
  return EDITOR_STRINGS[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
