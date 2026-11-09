// Runs language servers for the plugin's editors. A server is started per language and workspace
// folder, shared by every open document there, and stopped when it has been idle for a while.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { RpcConnection } from './jsonrpc.ts'
import { lspLanguageId, pickServer, type ServerSpec } from './servers.ts'
import { locateFile } from './locate.ts'
import { sameUri } from './uri.ts'

export type LspStatus =
  | { state: 'ready'; server: string; path: string; uri: string; capabilities: Record<string, unknown> }
  | { state: 'none' | 'off' | 'ambiguous' | 'no-file' }
  | { state: 'error'; message: string }

export type Diagnostics = { docId: string; diagnostics: unknown[] }

export type ManagerOptions = {
  /** Local workspace folders, asked for each attach so a new workspace is seen. */
  workspaceRoots(): Promise<string[]>
  /** Where to send a document's diagnostics and status changes. */
  post(event: 'lsp.diagnostics', payload: Diagnostics): void
  post(event: 'lsp.status', payload: { docId: string; status: LspStatus }): void
  log(message: string): void
  /** Test seam: how servers are looked up and started. */
  find?: (language: string) => { spec: ServerSpec; path: string } | null
  launch?: (spec: ServerSpec, executable: string, cwd: string) => ChildProcessWithoutNullStreams
  idleMs?: number
  initializeTimeoutMs?: number
}

const IDLE_STOP_MS = 5 * 60_000
const INITIALIZE_TIMEOUT_MS = 30_000
const STDERR_LINES_KEPT = 8

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { workspaceFolders: true, configuration: true, applyEdit: false },
  textDocument: {
    synchronization: { didSave: false, willSave: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
      },
      contextSupport: true
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } }
    },
    definition: { linkSupport: false },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: true },
    codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } }, isPreferredSupport: true },
    publishDiagnostics: { relatedInformation: false, versionSupport: false }
  }
}

function launchDefault(spec: ServerSpec, executable: string, cwd: string): ChildProcessWithoutNullStreams {
  // Why a shell for .cmd and .bat: on Windows, npm installs servers as such shims, which cannot be started directly.
  const shim = /\.(cmd|bat)$/i.test(executable)
  if (shim) {
    // Why one string: Node warns (DEP0190) when arguments are passed beside shell:true. They are fixed
    // flags of the server, never user input, so joining them is safe.
    return spawn(`"${executable}" ${spec.args.join(' ')}`, { cwd, shell: true, windowsHide: true, env: process.env })
  }
  return spawn(executable, spec.args, { cwd, windowsHide: true, env: process.env })
}

class Server {
  readonly rpc: RpcConnection
  readonly openDocuments = new Map<string, number>()
  capabilities: Record<string, unknown> = {}
  idleSince: number | null = null
  private readonly child: ChildProcessWithoutNullStreams
  private readonly stderrTail: string[] = []
  private readonly onDiagnostics: (uri: string, diagnostics: unknown[]) => void
  private readonly onExit: (message: string) => void

  constructor(
    child: ChildProcessWithoutNullStreams,
    handlers: { onDiagnostics(uri: string, diagnostics: unknown[]): void; onExit(message: string): void; log(message: string): void }
  ) {
    this.child = child
    this.onDiagnostics = handlers.onDiagnostics
    this.onExit = handlers.onExit
    this.rpc = new RpcConnection((frame) => child.stdin.write(frame), {
      onRequest: (method) => {
        // Servers ask for settings and to register watchers; "nothing special" is a valid answer to each.
        if (method === 'workspace/configuration') {
          return []
        }
        return null
      },
      onNotification: (method, params) => {
        if (method === 'textDocument/publishDiagnostics') {
          const { uri, diagnostics } = params as { uri: string; diagnostics: unknown[] }
          this.onDiagnostics(uri, diagnostics)
        }
      }
    })
    child.stdout.on('data', (chunk: Buffer) => this.rpc.feed(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean))
      this.stderrTail.splice(0, Math.max(0, this.stderrTail.length - STDERR_LINES_KEPT))
    })
    // Why: writing to a server that just died raises EPIPE here; that is the exit, not a second failure.
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => this.finish(`could not start: ${error.message}`))
    child.on('exit', (code) => this.finish(`stopped (code ${code ?? 'unknown'})`))
    this.handlersLog = handlers.log
  }

  private handlersLog: (message: string) => void
  private finished = false

  private finish(reason: string): void {
    if (this.finished) {
      return
    }
    this.finished = true
    this.rpc.close(reason)
    this.handlersLog(`language server ${reason}${this.stderrTail.length ? `: ${this.stderrTail.join(' | ')}` : ''}`)
    this.onExit(reason)
  }

  get alive(): boolean {
    return !this.finished
  }

  stop(): void {
    this.finished = true
    this.rpc.notify('exit', null)
    this.rpc.close('stopped')
    this.child.kill()
  }
}

type Attached = { docId: string; uri: string; language: string; serverKey: string; version: number }

export class LspManager {
  private readonly servers = new Map<string, Server>()
  private readonly starting = new Map<string, Promise<Server | { error: string }>>()
  private readonly documents = new Map<string, Attached>()
  private readonly options: ManagerOptions
  private sweeper: ReturnType<typeof setInterval> | null = null

  constructor(options: ManagerOptions) {
    this.options = options
  }

  async attach(input: { docId: string; language: string; extensions: string[]; content: string }): Promise<LspStatus> {
    const found = (this.options.find ?? pickServer)(input.language)
    if (!found) {
      return { state: 'none' }
    }
    const located = await locateFile(await this.options.workspaceRoots(), input.extensions, input.content)
    if (located.status !== 'found') {
      return { state: located.status === 'ambiguous' ? 'ambiguous' : 'no-file' }
    }
    const key = `${input.language}|${located.root}`
    const server = await this.serverFor(key, found, located.root, located.path)
    if ('error' in server) {
      return { state: 'error', message: server.error }
    }
    const uri = pathToFileURL(located.path).href
    const attached: Attached = { docId: input.docId, uri, language: input.language, serverKey: key, version: 1 }
    this.documents.set(input.docId, attached)
    server.openDocuments.set(uri, 1)
    server.idleSince = null
    server.rpc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: lspLanguageId(input.language, located.path), version: 1, text: input.content }
    })
    return { state: 'ready', server: found.spec.name, path: located.path, uri, capabilities: server.capabilities }
  }

  /** Full-text sync: simple and correct for every server; incremental sync is an optimisation for later. */
  sync(docId: string, text: string): void {
    const doc = this.documents.get(docId)
    const server = doc && this.servers.get(doc.serverKey)
    if (!doc || !server?.alive) {
      return
    }
    doc.version += 1
    server.openDocuments.set(doc.uri, doc.version)
    server.rpc.notify('textDocument/didChange', {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text }]
    })
  }

  async request(docId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const doc = this.documents.get(docId)
    const server = doc && this.servers.get(doc.serverKey)
    if (!doc || !server?.alive) {
      return null
    }
    // Why the worker fills this in: the editor never learns the file's path or URI.
    const withDocument = method.startsWith('textDocument/') ? { ...params, textDocument: { uri: doc.uri } } : params
    return server.rpc.request(method, withDocument)
  }

  detach(docId: string): void {
    const doc = this.documents.get(docId)
    this.documents.delete(docId)
    const server = doc && this.servers.get(doc.serverKey)
    if (doc && server?.alive) {
      server.rpc.notify('textDocument/didClose', { textDocument: { uri: doc.uri } })
      server.openDocuments.delete(doc.uri)
      if (server.openDocuments.size === 0) {
        server.idleSince = Date.now()
        this.startSweeper()
      }
    }
  }

  dispose(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper)
    }
    for (const server of this.servers.values()) {
      server.stop()
    }
    this.servers.clear()
  }

  private startSweeper(): void {
    if (this.sweeper) {
      return
    }
    const idleMs = this.options.idleMs ?? IDLE_STOP_MS
    this.sweeper = setInterval(() => {
      for (const [key, server] of this.servers) {
        if (server.idleSince !== null && Date.now() - server.idleSince > idleMs) {
          server.stop()
          this.servers.delete(key)
        }
      }
    }, Math.max(1000, Math.min(idleMs, 30_000)))
    this.sweeper.unref()
  }

  private serverFor(key: string, found: { spec: ServerSpec; path: string }, root: string, documentPath: string): Promise<Server | { error: string }> {
    const running = this.servers.get(key)
    if (running?.alive) {
      return Promise.resolve(running)
    }
    let starting = this.starting.get(key)
    if (!starting) {
      starting = this.start(key, found, root, documentPath).finally(() => this.starting.delete(key))
      this.starting.set(key, starting)
    }
    return starting
  }

  private async start(key: string, found: { spec: ServerSpec; path: string }, root: string, documentPath: string): Promise<Server | { error: string }> {
    const { spec, path } = found
    const launch = this.options.launch ?? launchDefault
    let server: Server
    try {
      server = new Server(launch(spec, path, root), {
        log: (message) => this.options.log(`${spec.name} ${message}`),
        onDiagnostics: (uri, diagnostics) => {
          for (const doc of this.documents.values()) {
            if (sameUri(doc.uri, uri) && doc.serverKey === key) {
              this.options.post('lsp.diagnostics', { docId: doc.docId, diagnostics })
            }
          }
        },
        onExit: (message) => {
          this.servers.delete(key)
          for (const doc of this.documents.values()) {
            if (doc.serverKey === key) {
              this.options.post('lsp.status', { docId: doc.docId, status: { state: 'error', message: `${spec.name} ${message}` } })
            }
          }
        }
      })
    } catch (error) {
      return { error: `${spec.name} could not start: ${error instanceof Error ? error.message : String(error)}` }
    }
    try {
      const rootUri = pathToFileURL(root).href
      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('did not answer in time')), this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS).unref()
      )
      const result = (await Promise.race([
        server.rpc.request('initialize', {
          processId: process.pid,
          clientInfo: { name: 'orca-autocomplete' },
          rootUri,
          initializationOptions: spec.initializationOptions?.({ root, documentPath, executable: path }),
          workspaceFolders: [{ uri: rootUri, name: root.split(/[\\/]/).pop() ?? 'workspace' }],
          capabilities: CLIENT_CAPABILITIES
        }),
        timeout
      ])) as { capabilities?: Record<string, unknown> }
      server.capabilities = result?.capabilities ?? {}
      server.rpc.notify('initialized', {})
      this.servers.set(key, server)
      return server
    } catch (error) {
      server.stop()
      return { error: `${spec.name} ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
