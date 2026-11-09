import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FONT_SIZE_DEFAULT, NATIVE_OPTIONS, resolveFontFamily, resolveFontSize, settingOptions, themeFor } from './editor-options.ts'

test('with nothing set the editor matches Orca: size 13, wrapped, no minimap, monospace', () => {
  assert.deepEqual(settingOptions({}), {
    fontFamily: 'monospace',
    fontSize: FONT_SIZE_DEFAULT,
    fontWeight: 'normal',
    fontLigatures: false,
    lineHeight: 0,
    wordWrap: 'on',
    minimap: { enabled: false }
  })
})

test('wrap turns off only on an explicit false, and the minimap on only on an explicit true', () => {
  assert.equal(settingOptions({ editorWordWrap: false }).wordWrap, 'off')
  assert.equal(settingOptions({ editorWordWrap: undefined }).wordWrap, 'on')
  assert.equal(settingOptions({ editorWordWrap: 'no' }).wordWrap, 'on')
  assert.equal(settingOptions({ editorMinimap: true }).minimap.enabled, true)
  assert.equal(settingOptions({ editorMinimap: 'yes' }).minimap.enabled, false)
})

test('font size is clamped to Orca’s 10 to 24 and junk falls back to 13', () => {
  assert.deepEqual([4, 10, 16, 24, 99].map(resolveFontSize), [10, 10, 16, 24, 24])
  assert.deepEqual([0, -3, NaN, '14', null, undefined].map(resolveFontSize), Array(6).fill(13))
})

test('a font family is trimmed, and empty or not text means monospace', () => {
  assert.equal(resolveFontFamily('  Fira Code  '), 'Fira Code')
  assert.equal(resolveFontFamily(''), 'monospace')
  assert.equal(resolveFontFamily(7), 'monospace')
})

test('the theme is the stock dark or light one, like Orca’s editor', () => {
  assert.equal(themeFor(true), 'vs-dark')
  assert.equal(themeFor(false), 'vs')
})

test('the copied native options keep what makes the editor look like Orca’s', () => {
  assert.equal(NATIVE_OPTIONS.padding.top, 0)
  assert.equal(NATIVE_OPTIONS.cursorSmoothCaretAnimation, 'off')
  assert.equal(NATIVE_OPTIONS.renderLineHighlight, 'line')
  assert.equal(NATIVE_OPTIONS.scrollBeyondLastLine, false)
})

const orcaValues = { fontFamily: 'Cascadia Mono', fontSize: 14, fontWeight: 'normal', lineHeight: 0, fontLigatures: true, wordWrap: false, minimap: true }

test('Orca’s own values win by default, so both editors look alike', () => {
  assert.deepEqual(settingOptions({ editorFontSize: 20 }, orcaValues), {
    fontFamily: 'Cascadia Mono', fontSize: 14, fontWeight: 'normal', lineHeight: 0, fontLigatures: true,
    wordWrap: 'off', minimap: { enabled: true }
  })
})

test('the plugin’s settings apply when following Orca is off or Orca’s values are unavailable', () => {
  assert.equal(settingOptions({ editorFollowOrca: false, editorFontSize: 20 }, orcaValues).fontSize, 20)
  assert.equal(settingOptions({ editorFontSize: 20 }, null).fontSize, 20)
})
