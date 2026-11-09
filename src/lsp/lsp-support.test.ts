import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { locateFile } from './locate.ts'
import { findExecutable, findTypeScriptServer, lspLanguageId, pickServer } from './servers.ts'

test('findExecutable looks through PATH and, on Windows, through PATHEXT', () => {
  const seen = new Set(['C:\\tools\\gopls.EXE'.toLowerCase()])
  const exists = (path: string) => seen.has(path.toLowerCase())
  assert.equal(
    findExecutable('gopls', { PATH: 'C:\\bin;C:\\tools', PATHEXT: '.COM;.EXE' }, 'win32', exists)?.toLowerCase(),
    'c:\\tools\\gopls.exe'
  )
  assert.equal(findExecutable('missing', { PATH: 'C:\\bin' }, 'win32', exists), null)
})

test('findExecutable on Windows ignores a bare Unix script and takes the runnable .cmd', () => {
  const present = new Set(['c:\\nodejs\\tsserver', 'c:\\nodejs\\tsserver.cmd'])
  const exists = (path: string) => present.has(path.toLowerCase())
  assert.equal(
    findExecutable('tsserver', { PATH: 'C:\\nodejs', PATHEXT: '.EXE;.CMD' }, 'win32', exists)?.toLowerCase(),
    'c:\\nodejs\\tsserver.cmd'
  )
})

test('findExecutable on Unix uses the bare name', () => {
  const exists = (path: string) => path === '/usr/bin/rust-analyzer'
  assert.equal(findExecutable('rust-analyzer', { PATH: '/bin:/usr/bin' }, 'linux', exists), '/usr/bin/rust-analyzer')
})

test('pickServer takes the first installed candidate and says nothing when none is', () => {
  const only = (command: string) => (command === 'pylsp' ? '/x/pylsp' : null)
  assert.equal(pickServer('python', only)?.spec.name, 'python-lsp-server')
  assert.equal(pickServer('python', () => null), null)
  assert.equal(pickServer('html', () => '/anything'), null)
})

test('lspLanguageId is finer than the editor language for tsx and C', () => {
  assert.equal(lspLanguageId('typescript', '/p/a.tsx'), 'typescriptreact')
  assert.equal(lspLanguageId('cpp', '/p/a.c'), 'c')
  assert.equal(lspLanguageId('cpp', '/p/a.cc'), 'cpp')
  assert.equal(lspLanguageId('rust', '/p/a.rs'), 'rust')
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'orca-locate-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'node_modules'))
  return { root, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('locateFile finds the one file whose content equals the document', async () => {
  const { root, done } = workspace()
  try {
    writeFileSync(join(root, 'src', 'a.rs'), 'fn a() {}\n')
    writeFileSync(join(root, 'src', 'b.rs'), 'fn b() {}\n')
    const found = await locateFile([root], ['.rs'], 'fn b() {}\n')
    assert.deepEqual(found, { status: 'found', path: join(root, 'src', 'b.rs'), root })
  } finally {
    done()
  }
})

test('locateFile ignores node_modules, other extensions and a BOM', async () => {
  const { root, done } = workspace()
  try {
    writeFileSync(join(root, 'node_modules', 'x.ts'), 'same')
    writeFileSync(join(root, 'src', 'x.js'), 'same')
    writeFileSync(join(root, 'src', 'y.ts'), '\uFEFFsame')
    const found = await locateFile([root], ['.ts'], 'same')
    assert.deepEqual(found, { status: 'found', path: join(root, 'src', 'y.ts'), root })
  } finally {
    done()
  }
})

test('locateFile says ambiguous for identical files and none for no match', async () => {
  const { root, done } = workspace()
  try {
    writeFileSync(join(root, 'src', 'one.go'), 'package x\n')
    writeFileSync(join(root, 'src', 'two.go'), 'package x\n')
    assert.deepEqual(await locateFile([root], ['.go'], 'package x\n'), { status: 'ambiguous' })
    assert.deepEqual(await locateFile([root], ['.go'], 'package y\n'), { status: 'none' })
  } finally {
    done()
  }
})

test('locateFile matches an exact file name such as Gemfile', async () => {
  const { root, done } = workspace()
  try {
    writeFileSync(join(root, 'Gemfile'), "source 'https://rubygems.org'\n")
    assert.equal((await locateFile([root], ['Gemfile'], "source 'https://rubygems.org'\n")).status, 'found')
  } finally {
    done()
  }
})

test('findTypeScriptServer walks up from the file to the workspace root, then looks beside the server', () => {
  const lib = (dir: string): string => join(dir, 'node_modules', 'typescript', 'lib', 'tsserver.js')
  const context = { root: join('/w'), documentPath: join('/w', 'app', 'src', 'a.ts'), executable: join('/g', 'bin', 'server') }
  assert.equal(findTypeScriptServer(context, (p) => p === lib(join('/w', 'app'))), lib(join('/w', 'app')))
  assert.equal(findTypeScriptServer(context, (p) => p === lib(join('/w'))), lib(join('/w')))
  assert.equal(findTypeScriptServer(context, (p) => p === lib(join('/g', 'bin'))), lib(join('/g', 'bin')))
  assert.equal(findTypeScriptServer(context, () => false), null)
  // A copy above the workspace root belongs to something else and is not used.
  assert.equal(findTypeScriptServer(context, (p) => p === lib('/')), null)
})
