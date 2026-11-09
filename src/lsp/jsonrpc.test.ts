import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RpcConnection } from './jsonrpc.ts'

const frame = (message: object): Buffer => {
  const body = JSON.stringify(message)
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function connect() {
  const sent: string[] = []
  const notifications: { method: string; params: unknown }[] = []
  const connection = new RpcConnection((out) => sent.push(out), {
    onRequest: (method) => (method === 'workspace/configuration' ? [null] : undefined),
    onNotification: (method, params) => void notifications.push({ method, params })
  })
  return { connection, sent, notifications }
}

test('a request resolves with the matching response', async () => {
  const { connection, sent } = connect()
  const answer = connection.request('textDocument/hover', { a: 1 })
  assert.match(sent[0], /^Content-Length: \d+\r\n\r\n\{"jsonrpc":"2.0","id":1,"method":"textDocument\/hover"/)
  connection.feed(frame({ jsonrpc: '2.0', id: 1, result: { contents: 'x' } }))
  assert.deepEqual(await answer, { contents: 'x' })
})

test('an error response rejects with its message', async () => {
  const { connection } = connect()
  const answer = connection.request('x', {})
  connection.feed(frame({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no such method' } }))
  await assert.rejects(answer, /no such method/)
})

test('messages split across chunks, and several in one chunk, are all delivered', () => {
  const { connection, notifications } = connect()
  const both = Buffer.concat([
    frame({ jsonrpc: '2.0', method: 'a', params: 1 }),
    frame({ jsonrpc: '2.0', method: 'b', params: 2 })
  ])
  connection.feed(both.subarray(0, 10))
  connection.feed(both.subarray(10, 40))
  connection.feed(both.subarray(40))
  assert.deepEqual(notifications.map((n) => n.method), ['a', 'b'])
})

test('multi-byte text is measured in bytes, not characters', () => {
  const { connection, notifications } = connect()
  connection.feed(frame({ jsonrpc: '2.0', method: 'm', params: 'café \u{1F600}' }))
  assert.equal(notifications[0].params, 'café \u{1F600}')
})

test('a request from the server is answered with the handler result', async () => {
  const { connection, sent } = connect()
  connection.feed(frame({ jsonrpc: '2.0', id: 7, method: 'workspace/configuration', params: {} }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.match(sent[0], /"id":7,"result":\[null\]/)
})

test('closing fails every waiting request instead of hanging', async () => {
  const { connection } = connect()
  const waiting = connection.request('x', {})
  connection.close('gone')
  await assert.rejects(waiting, /gone/)
  await assert.rejects(connection.request('y', {}), /not running/)
})

test('junk before a header is skipped', () => {
  const { connection, notifications } = connect()
  connection.feed(Buffer.from('garbage\r\n\r\n'))
  connection.feed(frame({ jsonrpc: '2.0', method: 'ok', params: null }))
  assert.deepEqual(notifications.map((n) => n.method), ['ok'])
})
