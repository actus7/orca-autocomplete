// Makes Monaco look like the rest of Orca: its colors come from the --orca-* variables the frame
// receives, and follow the app when the theme changes.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'

const THEME_NAME = 'orca'
const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

/** Any CSS color as #rrggbbaa, which is the only form Monaco's theme accepts. */
export function toHex(css: string): string {
  if (!context || !css.trim()) {
    return '#00000000'
  }
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = '#000000'
  context.fillStyle = css
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b, a].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function variable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** `#rrggbb` of a CSS color with its own transparency replaced by `alpha` (0 to 1). */
function faded(css: string, alpha: number): string {
  return `${toHex(css).slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

export function defineOrcaTheme(): void {
  const dark = document.documentElement.classList.contains('dark')
  const color = (name: string, fallback: string): string => toHex(variable(name) || fallback)
  const background = color('--orca-background', dark ? '#0a0a0a' : '#ffffff')
  const foreground = variable('--orca-foreground') || (dark ? '#f0f0f0' : '#171717')
  const popover = color('--orca-popover', dark ? '#171717' : '#ffffff')
  const accent = color('--orca-accent', dark ? '#404040' : '#e5e5e5')
  const muted = variable('--orca-muted-foreground') || '#808080'
  const border = color('--orca-border', dark ? '#ffffff12' : '#00000014')
  const ring = color('--orca-ring', '#737373')
  monaco.editor.defineTheme(THEME_NAME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': background,
      'editor.foreground': toHex(foreground),
      'editorGutter.background': background,
      'editorLineNumber.foreground': faded(muted, 0.7),
      'editorLineNumber.activeForeground': toHex(foreground),
      'editor.lineHighlightBackground': faded(foreground, 0.05),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': accent,
      'editor.inactiveSelectionBackground': faded(muted, 0.2),
      'editor.findMatchBackground': faded(ring, 0.5),
      'editor.findMatchHighlightBackground': faded(ring, 0.25),
      'editorCursor.foreground': toHex(foreground),
      'editorWhitespace.foreground': faded(muted, 0.3),
      'editorIndentGuide.background1': border,
      'editorIndentGuide.activeBackground1': faded(muted, 0.5),
      'editorBracketMatch.background': faded(ring, 0.3),
      'editorBracketMatch.border': ring,
      'editorGhostText.foreground': faded(muted, 0.75),
      'editorWidget.background': popover,
      'editorWidget.border': border,
      'editorSuggestWidget.background': popover,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': accent,
      'editorHoverWidget.background': popover,
      'editorHoverWidget.border': border,
      'list.hoverBackground': faded(foreground, 0.06),
      'list.activeSelectionBackground': accent,
      'list.focusBackground': accent,
      'input.background': background,
      'input.border': border,
      'focusBorder': ring,
      'scrollbarSlider.background': faded(muted, 0.25),
      'scrollbarSlider.hoverBackground': faded(muted, 0.4),
      'scrollbarSlider.activeBackground': faded(muted, 0.5),
      'minimap.background': background,
      'editorOverviewRuler.border': '#00000000'
    }
  })
  monaco.editor.setTheme(THEME_NAME)
}

/** Applies the theme now and again each time Orca changes it. */
export function followOrcaTheme(): void {
  defineOrcaTheme()
  orca.on('theme', () => defineOrcaTheme())
}
