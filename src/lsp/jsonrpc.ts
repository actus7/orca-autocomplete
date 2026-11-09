// A minimal JSON-RPC 2.0 connection over the framing every language server uses on stdio:
// `Content-Length: n`, a blank line, then n bytes of JSON.

export type RpcHandlers = {
  /** A request the server makes of us (configuration, registering capabilities ...); its result is the answer. */
  onRequest(method: string, params: unknown): Promise<unknown> | unknown
  onNotification(method: string, params: unknown): void
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void }

const HEADER_END = Buffer.from('\r\n\r\n')
const LENGTH_HEADER = /content-length:\s*(\d+)/i

export class RpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

export class RpcConnection {
  private buffer: Buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private closed = false
  private readonly write: (frame: string) => void
  private readonly handlers: RpcHandlers

  constructor(write: (frame: string) => void, handlers: RpcHandlers) {
    this.write = write
    this.handlers = handlers
  }

  /** Feed bytes as they arrive from the server's stdout; whole messages are dispatched. */
  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END)
      if (headerEnd === -1) {
        return
      }
      const length = LENGTH_HEADER.exec(this.buffer.subarray(0, headerEnd).toString('ascii'))?.[1]
      if (!length) {
        // Why: a frame without a length cannot be skipped; drop the junk and wait for the next header.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length)
        continue
      }
      const bodyStart = headerEnd + HEADER_END.length
      const bodyEnd = bodyStart + Number(length)
      if (this.buffer.length < bodyEnd) {
        return
      }
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.subarray(bodyEnd)
      this.dispatch(body)
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('the language server is not running'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) {
      this.send({ jsonrpc: '2.0', method, params })
    }
  }

  /** The server went away: everything still waiting fails instead of hanging. */
  close(reason = 'the language server stopped'): void {
    this.closed = true
    for (const waiting of this.pending.values()) {
      waiting.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private send(message: object): void {
    const body = JSON.stringify(message)
    this.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  }

  private dispatch(body: string): void {
    let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }
    try {
      message = JSON.parse(body)
    } catch {
      return
    }
    if (message.method !== undefined && message.id !== undefined) {
      void this.answer(message.id, message.method, message.params)
    } else if (message.method !== undefined) {
      this.handlers.onNotification(message.method, message.params)
    } else if (typeof message.id === 'number') {
      const waiting = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        waiting?.reject(new RpcError(message.error.code, message.error.message))
      } else {
        waiting?.resolve(message.result ?? null)
      }
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.onRequest(method, params)
      this.send({ jsonrpc: '2.0', id, result: result ?? null })
    } catch (error) {
      this.send({ jsonrpc: '2.0', id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
    }
  }
}
