// Orca's own file editor uses Monaco's stock dark or light theme, and so does this one. It follows
// the app: Orca flips the `dark` class on <html> and says so with a `theme` event.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import { themeFor } from './editor-options.ts'

export const isDark = (): boolean => document.documentElement.classList.contains('dark')

/** Applies the stock theme now and again each time Orca changes its own. */
export function followOrcaTheme(): void {
  const apply = (): void => monaco.editor.setTheme(themeFor(isDark()))
  apply()
  orca.on('theme', apply)
}
