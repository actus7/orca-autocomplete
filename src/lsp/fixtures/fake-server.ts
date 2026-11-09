// A tiny language server for the manager's tests: it reports one error for text containing BAD and
// answers hover with the document it was asked about.
import { RpcConnection } from '../jsonrpc.ts'

const documents = new Map<string, string>()

const connection = new RpcConnection((frame) => process.stdout.write(frame), {
  onRequest(method, params) {
    const uri = (params as { textDocument?: { uri: string } })?.textDocument?.uri ?? ''
    if (method === 'initialize') {
      return { capabilities: { hoverProvider: true, definitionProvider: true, textDocumentSync: 1 } }
    }
    if (method === 'textDocument/hover') {
      return { contents: { kind: 'markdown', value: `hover ${uri} (${documents.get(uri)?.length ?? 0} chars)` } }
    }
    if (method === 'shutdown') {
      return null
    }
    return null
  },
  onNotification(method, params) {
    const p = params as { textDocument: { uri: string; text?: string }; contentChanges?: { text: string }[] }
    if (method === 'textDocument/didOpen' || method === 'textDocument/didChange') {
      const text = p.textDocument.text ?? p.contentChanges?.[0]?.text ?? ''
      documents.set(p.textDocument.uri, text)
      const at = text.indexOf('BAD')
      // Real servers respell a Windows file URI (lowercase drive, escaped colon); do the same here.
      const respelled = p.textDocument.uri.replace(/^file:\/\/\/([A-Za-z]):/, (_match, drive: string) => `file:///${drive.toLowerCase()}%3A`)
      connection.notify('textDocument/publishDiagnostics', {
        uri: respelled,
        diagnostics:
          at === -1
            ? []
            : [{ range: { start: { line: 0, character: at }, end: { line: 0, character: at + 3 } }, severity: 1, message: 'BAD found' }]
      })
    }
    if (method === 'exit') {
      process.exit(0)
    }
  }
})

process.stdin.on('data', (chunk: Buffer) => connection.feed(chunk))
