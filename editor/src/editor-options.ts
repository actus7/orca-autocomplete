// The editor's options, taken from Orca's own file editor (MonacoEditor.tsx, editor-typography.ts,
// file-editor-word-wrap-options.ts in the Orca repository) so this editor looks and behaves like it.
// Orca keeps the person's editor settings to itself, so the few that matter are mirrored by settings
// of this plugin; leave them alone and the editor matches Orca's defaults.
//
// Pure data in, options out: no Monaco import, so Node can test it.

/** Orca's own limits for the editor font size. */
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
/** The size Orca uses when none is set. */
export const FONT_SIZE_DEFAULT = 13

/** What Orca's own editor uses, read from Orca's settings by the plugin's worker. */
export type OrcaEditor = {
  fontFamily: string
  fontSize: number
  fontWeight: string
  lineHeight: number
  fontLigatures: boolean
  wordWrap: boolean
  minimap: boolean
}

export type EditorSettings = {
  /** On by default: take the values from Orca. Off, or when Orca's cannot be read, the ones below apply. */
  editorFollowOrca?: unknown
  /** Empty follows Orca's default, which is the plain `monospace` family (Monaco adds its fallbacks). */
  editorFontFamily?: unknown
  /** 0 or empty follows Orca's default. */
  editorFontSize?: unknown
  /** Orca wraps long lines unless the person turned it off. */
  editorWordWrap?: unknown
  /** Orca keeps the minimap off unless the person turned it on. */
  editorMinimap?: unknown
}

/** Clamped to Orca's range; anything that is not a positive number falls back to the default. */
export function resolveFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return FONT_SIZE_DEFAULT
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value))
}

export function resolveFontFamily(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'monospace'
}

/**
 * The options that change with the person's settings; applied again whenever one changes. Orca's own
 * values win, so the two editors side by side look the same; the plugin's settings are the fallback.
 */
export function settingOptions(settings: EditorSettings, orca: OrcaEditor | null = null) {
  if (orca && settings.editorFollowOrca !== false) {
    return {
      fontFamily: orca.fontFamily,
      fontSize: orca.fontSize,
      fontWeight: orca.fontWeight,
      lineHeight: orca.lineHeight,
      fontLigatures: orca.fontLigatures,
      wordWrap: orca.wordWrap ? ('on' as const) : ('off' as const),
      minimap: { enabled: orca.minimap }
    }
  }
  return {
    fontFamily: resolveFontFamily(settings.editorFontFamily),
    fontSize: resolveFontSize(settings.editorFontSize),
    fontWeight: 'normal',
    // Why 0: Monaco's automatic line spacing, as Orca does when no line height is set.
    lineHeight: 0,
    fontLigatures: false,
    wordWrap: settings.editorWordWrap === false ? ('off' as const) : ('on' as const),
    minimap: { enabled: settings.editorMinimap === true }
  }
}

/** Everything else Orca sets on its file editor, copied as it is. */
export const NATIVE_OPTIONS = {
  dropIntoEditor: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: 'on' as const,
  renderLineHighlight: 'line' as const,
  automaticLayout: true,
  tabSize: 2,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'off' as const,
  padding: { top: 0 },
  find: {
    addExtraSpaceOnTop: false,
    autoFindInSelection: 'never' as const,
    seedSearchStringFromSelection: 'selection' as const
  }
}

/** What this plugin adds on top: the AI's gray text leads, so word popups wait for a trigger. */
export const PLUGIN_OPTIONS = {
  inlineSuggest: { enabled: true, mode: 'subwordSmart' as const, showToolbar: 'onHover' as const },
  // Why: a word-completion popup or its inline preview would take the place of the AI's suggestion.
  suggest: { preview: false, showStatusBar: true },
  quickSuggestions: false as const
}

/** Monaco's stock themes, which is what Orca's editor uses unless an editor theme plugin replaces them. */
export const themeFor = (dark: boolean): 'vs-dark' | 'vs' => (dark ? 'vs-dark' : 'vs')
