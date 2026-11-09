import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { LspManager, type Diagnostics, type LspStatus } from './manager.ts'

const FAKE = fileURLToPath(new URL('./fixtures/fake-server.ts', import.meta.url))
const spec = { name: 'fake', command: 'node', args: [FAKE] }

function setup(options: { launchExit?: boolean; noServer?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orca-lsp-'))
  writeFileSync(join(root, 'a.rs'), 'fn a() { BAD }\n')
  const diagnostics: Diagnostics[] = []
  const statuses: { docId: string; status: LspStatus }[] = []
  const logs: string[] = []
  const manager = new LspManager({
    workspaceRoots: async () => [root],
    post: ((event: string, payload: never) => {
      if (event === 'lsp.diagnostics') diagnostics.push(payload)
      else statuses.push(payload)
    }) as never,
    log: (message) => void logs.push(message),
    find: () => (options.noServer ? null : { spec, path: process.execPath }),
    launch: () =>
      options.launchExit
        ? spawn(process.execPath, ['-e', 'process.exit(3)'])
        : spawn(process.execPath, [FAKE], { stdio: ['pipe', 'pipe', 'pipe'] }),
    initializeTimeoutMs: 8000
  })
  return { root, manager, diagnostics, statuses, logs, done: () => { manager.dispose(); rmSync(root, { recursive: true, force: true }) } }
}

const until = async (condition: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms
  while (!condition() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(condition(), 'timed out waiting')
}

test('attach starts the server, opens the document and delivers its diagnostics', async () => {
  const { manager, diagnostics, done } = setup()
  try {
    const status = await manager.attach({ docId: 'd1', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    assert.equal(status.state, 'ready')
    await until(() => diagnostics.length > 0)
    assert.equal(diagnostics[0].docId, 'd1')
    assert.equal((diagnostics[0].diagnostics[0] as { message: string }).message, 'BAD found')
    assert.ok('hoverProvider' in manager.capabilitiesOf('d1'))
  } finally {
    done()
  }
})

test('sync sends the new text and the server answers with fresh diagnostics', async () => {
  const { manager, diagnostics, done } = setup()
  try {
    await manager.attach({ docId: 'd1', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    await until(() => diagnostics.length === 1)
    manager.sync('d1', 'fn a() {}\n')
    await until(() => diagnostics.length === 2)
    assert.deepEqual(diagnostics[1].diagnostics, [])
  } finally {
    done()
  }
})

test('request fills in the document and returns the server answer', async () => {
  const { manager, done } = setup()
  try {
    await manager.attach({ docId: 'd1', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    const hover = (await manager.request('d1', 'textDocument/hover', { position: { line: 0, character: 1 } })) as { contents: { value: string } }
    assert.match(hover.contents.value, /^hover file:\/\/.*a\.rs \(15 chars\)$/)
  } finally {
    done()
  }
})

test('two documents of one language and folder share one server', async () => {
  const { root, manager, done } = setup()
  try {
    writeFileSync(join(root, 'b.rs'), 'fn b() {}\n')
    const first = await manager.attach({ docId: 'd1', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    const second = await manager.attach({ docId: 'd2', language: 'rust', extensions: ['.rs'], content: 'fn b() {}\n' })
    assert.equal(first.state, 'ready')
    assert.equal(second.state, 'ready')
    assert.equal((manager as unknown as { servers: Map<string, unknown> }).servers.size, 1)
  } finally {
    done()
  }
})

test('no installed server, an unknown file and a server that dies all say so', async () => {
  const none = setup({ noServer: true })
  try {
    assert.deepEqual(await none.manager.attach({ docId: 'd', language: 'rust', extensions: ['.rs'], content: 'x' }), { state: 'none' })
  } finally {
    none.done()
  }
  const lost = setup()
  try {
    assert.deepEqual(await lost.manager.attach({ docId: 'd', language: 'rust', extensions: ['.rs'], content: 'not on disk' }), { state: 'no-file' })
  } finally {
    lost.done()
  }
  const dies = setup({ launchExit: true })
  try {
    const status = await dies.manager.attach({ docId: 'd', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    assert.equal(status.state, 'error')
  } finally {
    dies.done()
  }
})

test('requests for a detached or unknown document return null instead of failing', async () => {
  const { manager, done } = setup()
  try {
    assert.equal(await manager.request('nobody', 'textDocument/hover', {}), null)
    await manager.attach({ docId: 'd1', language: 'rust', extensions: ['.rs'], content: 'fn a() { BAD }\n' })
    manager.detach('d1')
    assert.equal(await manager.request('d1', 'textDocument/hover', {}), null)
  } finally {
    done()
  }
})
