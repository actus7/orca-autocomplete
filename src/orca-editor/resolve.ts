// What Orca's own file editor ends up using, worked out from the person's Orca settings with the same
// rules Orca applies (editor-typography.ts, editor-font-zoom.ts, terminal-ligatures.ts and
// file-editor-word-wrap-options.ts in the Orca repository). Pure: settings in, editor values out.

export type ResolvedEditor = {
  fontFamily: string
  fontSize: number
  fontWeight: string
  /** Pixels; 0 keeps Monaco's automatic spacing. */
  lineHeight: number
  fontLigatures: boolean
  wordWrap: boolean
  minimap: boolean
}

type Raw = Record<string, unknown> | null | undefined

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
const FONT_SIZE_FALLBACK = 13
const ZOOM_MIN = -6
const ZOOM_MAX = 18
const ZOOMED_SIZE_MIN = 8
const ZOOMED_SIZE_MAX = 32
const LINE_HEIGHT_MIN = 1
const LINE_HEIGHT_MAX = 3
// At or above this a line height is read as pixels, as Monaco's own lineHeight does.
const LINE_HEIGHT_PIXEL_THRESHOLD = 8
const FONT_WEIGHT_MIN = 100
const FONT_WEIGHT_MAX = 900

// Fonts Orca turns ligatures on for when the mode is `auto`; matched on the first family only.
const LIGATURE_FONT_TOKENS = [
  'fira code', 'fira mono', 'jetbrains mono', 'jetbrainsmono', 'cascadia code', 'cascadia mono', 'iosevka',
  'victor mono', 'hasklig', 'monoid', 'operator mono', 'dank mono', 'mononoki', 'pragmatapro', 'recursive',
  'monolisa', 'commit mono', 'geist mono', 'maple mono', 'departure mono'
]

const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function hasKnownLigatures(fontFamily: string): boolean {
  const primary = fontFamily.split(',')[0]?.replaceAll('"', '').trim().toLowerCase() ?? ''
  return primary !== '' && LIGATURE_FONT_TOKENS.some((token) => primary.includes(token))
}

/** The editor font follows the terminal font until an editor font is chosen. */
function fontFamilyOf(settings: Raw): string {
  const editor = typeof settings?.editorFontFamily === 'string' ? settings.editorFontFamily.trim() : ''
  const terminal = typeof settings?.terminalFontFamily === 'string' ? settings.terminalFontFamily : ''
  return editor || terminal || 'monospace'
}

function baseFontSizeOf(settings: Raw): number {
  if (isPositive(settings?.editorFontSize)) {
    return clamp(settings.editorFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX)
  }
  return isPositive(settings?.terminalFontSize) ? settings.terminalFontSize : FONT_SIZE_FALLBACK
}

export function resolveOrcaEditor(settings: Raw, ui: Raw): ResolvedEditor {
  const fontFamily = fontFamilyOf(settings)
  const base = baseFontSizeOf(settings)
  const zoomRaw = ui?.editorFontZoomLevel
  const zoom = typeof zoomRaw === 'number' && Number.isFinite(zoomRaw) ? clamp(zoomRaw, ZOOM_MIN, ZOOM_MAX) : 0
  const fontSize = clamp(base + zoom, ZOOMED_SIZE_MIN, ZOOMED_SIZE_MAX)

  let lineHeight = 0
  if (isPositive(settings?.editorLineHeight)) {
    const ratio = settings.editorLineHeight >= LINE_HEIGHT_PIXEL_THRESHOLD ? settings.editorLineHeight / base : settings.editorLineHeight
    lineHeight = Math.round(fontSize * clamp(ratio, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX))
  }

  const mode = settings?.editorLigatures
  const ligatures = mode === 'on' ? true : mode === 'auto' ? hasKnownLigatures(fontFamily) : false

  return {
    fontFamily,
    fontSize,
    fontWeight: isPositive(settings?.editorFontWeight)
      ? String(clamp(Math.round(settings.editorFontWeight), FONT_WEIGHT_MIN, FONT_WEIGHT_MAX))
      : 'normal',
    lineHeight,
    fontLigatures: ligatures,
    // Profiles saved before the preference existed keep Orca's wrapped default.
    wordWrap: settings?.editorWordWrap !== false,
    minimap: settings?.editorMinimapEnabled === true
  }
}
