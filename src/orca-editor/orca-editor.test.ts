import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readDocuments } from './reader.ts'
import { resolveOrcaEditor } from './resolve.ts'
import { parseUserDataDir, userDataDirOfHost } from './host-process.ts'
import { activeProfileId, findProfileDatabase, userDataCandidates } from './userdata.ts'
import { EditorSettingsWatcher, fileStamp } from './watcher.ts'

// --- resolve: the rules Orca applies to its own editor ---

test('with no settings the editor is Orca\u2019s default: monospace 13, wrapped, no minimap', () => {
  assert.deepEqual(resolveOrcaEditor({}, {}), {
    fontFamily: 'monospace', fontSize: 13, fontWeight: 'normal', lineHeight: 0,
    fontLigatures: false, wordWrap: true, minimap: false
  })
})

test('the editor follows the terminal font until an editor font is set (a real profile)', () => {
  const real = { editorFontFamily: '', terminalFontFamily: 'Cascadia Mono', terminalFontSize: 14, editorWordWrap: true, editorMinimapEnabled: false }
  const resolved = resolveOrcaEditor(real, {})
  assert.equal(resolved.fontFamily, 'Cascadia Mono')
  assert.equal(resolved.fontSize, 14)
  assert.equal(resolved.wordWrap, true)
  assert.equal(resolved.minimap, false)
})

test('an editor font and size win over the terminal ones, and the editor size is clamped to 10-24', () => {
  const settings = { editorFontFamily: ' Fira Code ', editorFontSize: 40, terminalFontFamily: 'X', terminalFontSize: 14 }
  assert.equal(resolveOrcaEditor(settings, {}).fontFamily, 'Fira Code')
  assert.equal(resolveOrcaEditor(settings, {}).fontSize, 24)
  assert.equal(resolveOrcaEditor({ editorFontSize: 3 }, {}).fontSize, 10)
})

test('the zoom level moves the size and the result stays between 8 and 32', () => {
  assert.equal(resolveOrcaEditor({ editorFontSize: 14 }, { editorFontZoomLevel: 3 }).fontSize, 17)
  assert.equal(resolveOrcaEditor({ editorFontSize: 14 }, { editorFontZoomLevel: -6 }).fontSize, 8)
  assert.equal(resolveOrcaEditor({ editorFontSize: 24 }, { editorFontZoomLevel: 18 }).fontSize, 32)
  assert.equal(resolveOrcaEditor({ editorFontSize: 14 }, { editorFontZoomLevel: 'x' }).fontSize, 14)
})

test('line height is a ratio below 8 and pixels from 8, clamped, and 0 stays automatic', () => {
  assert.equal(resolveOrcaEditor({ editorFontSize: 14, editorLineHeight: 1.5 }, {}).lineHeight, 21)
  assert.equal(resolveOrcaEditor({ editorFontSize: 14, editorLineHeight: 28 }, {}).lineHeight, 28)
  assert.equal(resolveOrcaEditor({ editorFontSize: 14, editorLineHeight: 99 }, {}).lineHeight, 42)
  assert.equal(resolveOrcaEditor({ editorFontSize: 14, editorLineHeight: 0 }, {}).lineHeight, 0)
})

test('ligatures: off unless on, or auto with a font known for them', () => {
  assert.equal(resolveOrcaEditor({ terminalFontFamily: 'Fira Code' }, {}).fontLigatures, false)
  assert.equal(resolveOrcaEditor({ editorLigatures: 'on' }, {}).fontLigatures, true)
  assert.equal(resolveOrcaEditor({ editorLigatures: 'auto', terminalFontFamily: 'JetBrainsMono NF' }, {}).fontLigatures, true)
  assert.equal(resolveOrcaEditor({ editorLigatures: 'auto', terminalFontFamily: 'Consolas' }, {}).fontLigatures, false)
  assert.equal(resolveOrcaEditor({ editorLigatures: 'off', terminalFontFamily: 'Fira Code' }, {}).fontLigatures, false)
})

test('weight, wrap and minimap follow Orca\u2019s rules', () => {
  assert.equal(resolveOrcaEditor({ editorFontWeight: 650 }, {}).fontWeight, '650')
  assert.equal(resolveOrcaEditor({ editorFontWeight: 5000 }, {}).fontWeight, '900')
  assert.equal(resolveOrcaEditor({ editorWordWrap: false }, {}).wordWrap, false)
  assert.equal(resolveOrcaEditor({ editorMinimapEnabled: true }, {}).minimap, true)
  assert.equal(resolveOrcaEditor({ editorMinimapEnabled: 'yes' }, {}).minimap, false)
})

// --- userdata: which Orca is this ---

test('the data folders are the platform\u2019s application data folder plus orca or orca-dev', () => {
  assert.deepEqual(userDataCandidates('C:\\Users\\me', 'win32'), {
    packaged: join('C:\\Users\\me', 'AppData', 'Roaming', 'orca'),
    development: join('C:\\Users\\me', 'AppData', 'Roaming', 'orca-dev')
  })
  assert.equal(userDataCandidates('/Users/me', 'darwin').packaged, join('/Users/me', 'Library', 'Application Support', 'orca'))
  assert.equal(userDataCandidates('/home/me', 'linux', '/cfg').development, join('/cfg', 'orca-dev'))
})

test('activeProfileId accepts only a known profile with a safe id, and falls back to the backup', () => {
  const index = (id: string, profiles: string[]) => JSON.stringify({ activeProfileId: id, profiles: profiles.map((p) => ({ id: p })) })
  assert.equal(activeProfileId('/d', () => index('p1', ['p1', 'p2'])), 'p1')
  assert.equal(activeProfileId('/d', () => index('p3', ['p1'])), null)
  assert.equal(activeProfileId('/d', () => index('../x', ['../x'])), null)
  assert.equal(activeProfileId('/d', (path) => (path.endsWith('.bak') ? index('p1', ['p1']) : '{broken')), 'p1')
})

const profileIndex = (id: string) => JSON.stringify({ activeProfileId: id, profiles: [{ id }] })

test('findProfileDatabase uses the usual folder of this kind of Orca once it holds this plugin’s data', async () => {
  const folders = userDataCandidates('/home/me', 'linux', '/cfg')
  const present = [join(folders.packaged, 'orca-profile-index.json'), join(folders.packaged, 'plugins-data', 'actus7.autocomplete'), join(folders.development, 'orca-profile-index.json'), join(folders.development, 'plugins-data', 'local.autocomplete')]
  const common = { home: '/home/me', platform: 'linux', xdgConfig: '/cfg', exists: (p: string) => present.includes(p), read: () => profileIndex('main'), userDataOfHost: async () => null }
  assert.equal(await findProfileDatabase({ ...common, hostEntry: '/opt/Orca/resources/app.asar/out/main/plugin-host-entry.js' }), join(folders.packaged, 'profiles', 'main', 'profile-state.db'))
  assert.equal(await findProfileDatabase({ ...common, hostEntry: '/src/orca/out/main/plugin-host-entry.js' }), join(folders.development, 'profiles', 'main', 'profile-state.db'))
})

test('a packaged Orca never takes the development folder, even when only that one holds the plugin', async () => {
  const folders = userDataCandidates('/h', 'linux', '/c')
  const present = [join(folders.development, 'orca-profile-index.json'), join(folders.development, 'plugins-data', 'local.autocomplete')]
  const found = await findProfileDatabase({ home: '/h', platform: 'linux', xdgConfig: '/c', exists: (p) => present.includes(p), read: () => profileIndex('x'), hostEntry: '/opt/Orca/resources/app.asar/x', userDataOfHost: async () => null })
  assert.equal(found, null)
})

test('an Orca started with its own data folder is found through its command line', async () => {
  const custom = '/data/portable-orca'
  const found = await findProfileDatabase({
    home: '/h', platform: 'linux', xdgConfig: '/c', hostEntry: '/opt/Orca/resources/app.asar/x',
    exists: (p) => p === join(custom, 'orca-profile-index.json'), read: () => profileIndex('p1'), userDataOfHost: async () => custom
  })
  assert.equal(found, join(custom, 'profiles', 'p1', 'profile-state.db'))
  assert.equal(await findProfileDatabase({ home: '/h', platform: 'linux', exists: () => false, userDataOfHost: async () => custom }), null)
})

test('parseUserDataDir reads every way the flag is written', () => {
  assert.equal(parseUserDataDir('Orca.exe --user-data-dir=E:\\tmp\\orca --remote-debugging-port=9'), 'E:\\tmp\\orca')
  assert.equal(parseUserDataDir('Orca.exe --user-data-dir="C:\\My Data\\orca" --x'), 'C:\\My Data\\orca')
  assert.equal(parseUserDataDir("orca --user-data-dir '/home/me/o d' --x"), '/home/me/o d')
  assert.equal(parseUserDataDir('orca --user-data-dir /data/o'), '/data/o')
  assert.equal(parseUserDataDir('Orca.exe --type=utility'), null)
})

test('userDataDirOfHost walks up the parents until one carries the flag, and gives up after a few levels', async () => {
  const tree: Record<number, { commandLine: string; parent: number | null }> = {
    10: { commandLine: 'Orca.exe --type=utility', parent: 20 },
    20: { commandLine: 'Orca.exe --user-data-dir=/d/orca', parent: 30 }
  }
  assert.equal(await userDataDirOfHost(10, async (pid) => tree[pid] ?? null), '/d/orca')
  assert.equal(await userDataDirOfHost(99, async () => null), null)
  const endless = async (pid: number) => ({ commandLine: 'x', parent: pid + 1 })
  assert.equal(await userDataDirOfHost(1, endless), null)
})

// --- reader: a real SQLite database laid out like Orca's ---

function profileDatabase(documents: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), 'orca-db-'))
  mkdirSync(folder, { recursive: true })
  const file = join(folder, 'profile-state.db')
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, domain_version INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, content_hash TEXT NOT NULL)')
  database.exec('CREATE TABLE secrets_like (name TEXT, value TEXT)')
  database.exec("INSERT INTO secrets_like VALUES ('token', 'must-never-be-read')")
  const insert = database.prepare('INSERT INTO profile_state_documents VALUES (?, ?, 1, 1, 0, ?)')
  for (const [domain, payload] of Object.entries(documents)) {
    insert.run(domain, payload, 'h')
  }
  database.close()
  return { file, done: () => rmSync(folder, { recursive: true, force: true }) }
}

test('readDocuments returns the settings and ui documents and nothing else', async () => {
  const { file, done } = profileDatabase({
    settings: JSON.stringify({ editorWordWrap: false, apiKey: 'secret' }),
    ui: JSON.stringify({ editorFontZoomLevel: 2 }),
    other: JSON.stringify({ private: true })
  })
  try {
    const documents = await readDocuments(file)
    assert.deepEqual(Object.keys(documents ?? {}).sort(), ['settings', 'ui'])
    assert.equal(documents?.settings?.editorWordWrap, false)
    assert.equal(documents?.ui?.editorFontZoomLevel, 2)
  } finally {
    done()
  }
})

test('readDocuments cannot write, and gives null for a missing or unreadable database', async () => {
  const { file, done } = profileDatabase({ settings: '{}' })
  try {
    const { DatabaseSync: Sqlite } = await import('node:sqlite')
    const readOnly = new Sqlite(file, { readOnly: true })
    assert.throws(() => readOnly.exec("DELETE FROM profile_state_documents"), /readonly|read-only/i)
    readOnly.close()
    assert.equal(await readDocuments(join(tmpdir(), 'orca-missing-db', 'profile-state.db')), null)
    writeFileSync(file, 'not a database')
    assert.equal(await readDocuments(file), null)
  } finally {
    done()
  }
})

test('readDocuments returns null documents for a payload that is not an object', async () => {
  const { file, done } = profileDatabase({ settings: '[1,2]', ui: 'nope' })
  try {
    assert.deepEqual(await readDocuments(file), { settings: null, ui: null })
  } finally {
    done()
  }
})

// --- watcher ---

test('the watcher reports the first values, then only real changes, and re-reads only when the file changed', async () => {
  let stamp = 'a'
  let reads = 0
  let settings: Record<string, unknown> = { editorMinimapEnabled: false }
  const changes: unknown[] = []
  const watcher = new EditorSettingsWatcher({
    find: () => '/db',
    stamp: () => stamp,
    read: async () => (reads += 1, { settings, ui: {} }),
    onChange: (value) => void changes.push(value)
  })
  await watcher.check(true)
  assert.equal(changes.length, 1)
  await watcher.check()
  assert.equal(reads, 1)
  stamp = 'b'
  await watcher.check()
  assert.equal(reads, 2)
  assert.equal(changes.length, 1, 'same values, no report')
  stamp = 'c'
  settings = { editorMinimapEnabled: true }
  await watcher.check()
  assert.equal(changes.length, 2)
  assert.equal(watcher.current()?.minimap, true)
})

test('when the database cannot be read the watcher reports null so the plugin\u2019s own settings apply', async () => {
  const changes: unknown[] = []
  const watcher = new EditorSettingsWatcher({ find: () => null, onChange: (value) => void changes.push(value) })
  await watcher.check(true)
  assert.deepEqual(changes, [])
  assert.equal(watcher.current(), null)
})

test('fileStamp notices a save that only reached the write-ahead log', () => {
  const folder = mkdtempSync(join(tmpdir(), 'orca-stamp-'))
  try {
    const database = join(folder, 'profile-state.db')
    writeFileSync(database, 'main')
    const before = fileStamp(database)
    writeFileSync(`${database}-wal`, 'a save')
    const afterWal = fileStamp(database)
    assert.notEqual(afterWal, before)
    writeFileSync(`${database}-wal`, 'a longer second save')
    assert.notEqual(fileStamp(database), afterWal)
    assert.equal(fileStamp(join(folder, 'missing.db')), null)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
