/**
 * stdio upstream transport: one spawned child process speaking JSON-RPC on
 * stdin/stdout, with both supported framings (newline-delimited JSON and
 * `Content-Length` blocks), per-call timeout isolation, respawn after EOF, and
 * best-effort child cleanup.
 *
 * Concurrency model: a single reader loop drains stdout and dispatches each
 * frame to the caller waiting on its request id; stdin writes are serialized
 * through a promise chain so two frames can never interleave bytes, while
 * requests themselves stay in flight concurrently so a server that handles
 * requests in-process is not serialized by this client.
 *
 * Owner: upstream. Contract: DESIGN.md § src/upstream-stdio.ts and
 * the retired service's `upstream.py:274-612`.
 *
 * @module
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import { UpstreamRpcError, UpstreamTransportError } from './errors.ts'
import type { JsonObject, Tool, UpstreamTransport } from './types.ts'

/** Seconds a single request may wait for its response. */
const DEFAULT_READ_TIMEOUT = 120

/** Host env vars a child keeps when the config omits `inherit_env`. */
const DEFAULT_INHERIT_ENV: readonly string[] = ['PATH']

/** Graceful wait for the child to exit before escalating to a kill (ms). */
const TERMINATE_GRACE_MS = 5000

/** How long the reader waits for the child to exit before reporting EOF (ms). */
const EXIT_REPORT_WAIT_MS = 1000

/** Upper bound on stderr kept for the exit message; only 500 chars are reported. */
const STDERR_CAPTURE_LIMIT = 8 * 1024

/** Construction options for one stdio upstream. */
export interface StdioTransportOptions {
  name: string
  command: string
  args?: string[]
  /** Extra child environment; values are already `${VAR}`-resolved. */
  env?: Record<string, string>
  /** Host env vars the child keeps. @default ['PATH'] */
  inheritEnv?: string[]
  /** Per-request read timeout in seconds. @default 120 */
  readTimeout?: number
}

/** One in-flight request waiting for the reader to dispatch its response. */
interface PendingCall {
  /** Deliver the full JSON-RPC response message. */
  resolve(message: JsonObject): void
  /** Fail the caller (timeout, transport teardown, JSON-RPC error). */
  reject(error: Error): void
}

/**
 * Report whether an untrusted JSON value is a JSON object (not null, not an array).
 * @param value - value to inspect.
 * @returns true when `value` is a non-null, non-array object.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Render the `message` of a JSON-RPC `error` member.
 * @param value - the untrusted `error` member.
 * @returns its message, or `'unknown'` when there is none.
 */
function rpcErrorMessage(value: unknown): string {
  if (isJsonObject(value)) {
    const message = value['message']
    if (typeof message === 'string') {
      return message
    }
  }
  return 'unknown'
}

/**
 * Project one untrusted wire tool into the gateway's `Tool` type; unknown
 * members are dropped, mirroring the retired service's pydantic model.
 * @param value - one entry of a `tools/list` result.
 * @returns the tool, or null when the entry is not an object with a string name.
 */
function toTool(value: unknown): Tool | null {
  if (!isJsonObject(value)) {
    return null
  }
  const name = value['name']
  if (typeof name !== 'string') {
    return null
  }
  const tool: Tool = { name }
  const description = value['description']
  if (typeof description === 'string') {
    tool.description = description
  }
  const inputSchema = value['inputSchema']
  if (isJsonObject(inputSchema)) {
    tool.inputSchema = inputSchema
  }
  const annotations = value['annotations']
  if (isJsonObject(annotations)) {
    tool.annotations = annotations
  }
  const title = value['title']
  if (typeof title === 'string') {
    tool.title = title
  }
  return tool
}

/**
 * Buffered stdout reader for framing work. Bytes accumulate until a frame
 * reader consumes them; EOF surfaces as a null line (or a short-body error for
 * a `Content-Length` block).
 */
class StdoutReader {
  private buffer: Buffer = Buffer.alloc(0)

  private eof = false

  private failure: Error | null = null

  private waiters: Array<() => void> = []

  /** @param stream - the child's stdout. */
  constructor(stream: Readable) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      this.wake()
    })
    stream.on('end', () => {
      this.eof = true
      this.wake()
    })
    stream.on('close', () => {
      // A destroyed stream may close without ever emitting end (e.g. spawn failed).
      this.eof = true
      this.wake()
    })
    stream.on('error', (error: Error) => {
      this.failure = error
      this.eof = true
      this.wake()
    })
  }

  /**
   * Read one newline-terminated line. A partial line at EOF is returned; a
   * clean EOF returns null.
   * @returns the line without its trailing newline, or null at EOF.
   */
  async readLine(): Promise<string | null> {
    for (;;) {
      const index = this.buffer.indexOf(0x0a)
      if (index !== -1) {
        const line = this.buffer.subarray(0, index).toString('utf8')
        this.consume(index + 1)
        return line
      }
      if (this.failure !== null) {
        throw this.failure
      }
      if (this.eof) {
        if (this.buffer.length === 0) {
          return null
        }
        const line = this.buffer.toString('utf8')
        this.consume(this.buffer.length)
        return line
      }
      await this.waitForData()
    }
  }

  /**
   * Read exactly `length` bytes of a body.
   * @param length - byte count from the frame's `Content-Length` header.
   * @returns the body.
   */
  async readExactly(length: number): Promise<Buffer> {
    for (;;) {
      if (this.buffer.length >= length) {
        const body = this.buffer.subarray(0, length)
        this.consume(length)
        return Buffer.from(body)
      }
      if (this.failure !== null) {
        throw this.failure
      }
      if (this.eof) {
        throw new Error('stdio stream ended inside a Content-Length body')
      }
      await this.waitForData()
    }
  }

  /** Drop the first `length` buffered bytes. */
  private consume(length: number): void {
    this.buffer = this.buffer.subarray(length)
  }

  /** Wait for more buffered bytes or EOF. */
  private async waitForData(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  /** Wake every reader waiting on more data. */
  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }
}

/** One spawned MCP server connection. */
export class StdioTransport implements UpstreamTransport {
  readonly name: string

  private readonly command: string

  private readonly args: string[]

  private readonly extraEnv: Record<string, string>

  private readonly inheritEnv: readonly string[]

  private readonly readTimeout: number

  private child: ChildProcess | null = null

  private requestId = 0

  /** Set when the child is up and the handshake finished; cleared on reader EOF. */
  private ready = false

  /** The in-flight spawn + handshake, shared by concurrent first callers. */
  private initializing: Promise<void> | null = null

  private readonly pending = new Map<number, PendingCall>()

  /** Serializes stdin writes so frames never interleave. */
  private writeQueue: Promise<void> = Promise.resolve()

  /** Completion of the current reader loop, awaited by {@link close}. */
  private readerDone: Promise<void> | null = null

  /** @param options - command, environment, and timeout. */
  constructor(options: StdioTransportOptions) {
    this.name = options.name
    this.command = options.command
    this.args = options.args ?? []
    this.extraEnv = options.env ?? {}
    this.inheritEnv = options.inheritEnv ?? DEFAULT_INHERIT_ENV
    this.readTimeout = options.readTimeout ?? DEFAULT_READ_TIMEOUT
  }

  /**
   * Spawn the child and complete the MCP handshake when the transport is not
   * ready yet. Concurrent callers share one spawn.
   * @returns resolves once the handshake completed and requests may be sent.
   */
  ensureProcess(): Promise<void> {
    if (this.ready) {
      return Promise.resolve()
    }
    const inflight = this.initializing
    if (inflight !== null) {
      return inflight
    }
    const started = this.startProcess()
    this.initializing = started
    const clear = (): void => {
      if (this.initializing === started) {
        this.initializing = null
      }
    }
    started.then(clear, clear)
    return started
  }

  /** Tear down a child left behind by a handshake that never finished. */
  async closeIfUnready(): Promise<void> {
    if (!this.ready) {
      await this.close()
    }
  }

  /** Synchronous last-resort kill for teardown paths with no live event loop. */
  killNowait(): void {
    const child = this.child
    if (child === null) {
      return
    }
    this.signalChild(child, true)
  }

  /** Fetch the upstream tool list (raw). */
  async listTools(): Promise<Tool[]> {
    const message = await this.rpc('tools/list', {})
    const result = message['result']
    if (!isJsonObject(result)) {
      return []
    }
    const tools = result['tools']
    if (!Array.isArray(tools)) {
      return []
    }
    const projected: Tool[] = []
    for (const entry of tools) {
      const tool = toTool(entry)
      if (tool !== null) {
        projected.push(tool)
      }
    }
    return projected
  }

  /** Invoke one upstream tool and return its JSON-RPC `result`. */
  async callTool(name: string, args: JsonObject): Promise<JsonObject> {
    const message = await this.rpc('tools/call', { name, arguments: args })
    const result = message['result']
    return isJsonObject(result) ? result : {}
  }

  /** Terminate the child and fail every caller still waiting on it. */
  async close(): Promise<void> {
    const child = this.child
    if (child !== null) {
      this.signalChild(child, false)
      const exited = await this.waitForExit(child, TERMINATE_GRACE_MS)
      if (!exited) {
        this.signalChild(child, true)
        await this.waitForExit(child, TERMINATE_GRACE_MS)
      }
    }
    await this.awaitReader()
    if (this.child === child) {
      this.child = null
    }
    this.failPending(`Stdio upstream '${this.name}': closed`)
    this.ready = false
  }

  /**
   * Spawn a child, start its reader loop, and run the handshake.
   * @returns resolves once the transport is ready for requests.
   */
  private async startProcess(): Promise<void> {
    await this.reapLingeringChild()
    this.failPending(`Stdio upstream '${this.name}': transport respawned`)
    this.requestId = 0
    let child: ChildProcess
    try {
      child = spawn(this.command, this.args, {
        env: this.mergedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      throw new UpstreamTransportError(
        `Stdio upstream '${this.name}': spawn failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      child.kill('SIGKILL')
      throw new UpstreamTransportError(
        `Stdio upstream '${this.name}': child pipes were not created`,
      )
    }
    this.child = child
    // A late EPIPE has no request to fail any more; keep a sink so an
    // unhandled stream 'error' event cannot crash the gateway.
    child.stdin.on('error', () => undefined)
    child.once('error', (error: Error) => {
      this.failPending(`Stdio upstream '${this.name}': spawn failed: ${error.message}`)
    })
    const stderrChunks: Buffer[] = []
    let stderrBytes = 0
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STDERR_CAPTURE_LIMIT) {
        return
      }
      const remaining = STDERR_CAPTURE_LIMIT - stderrBytes
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      stderrChunks.push(kept)
      stderrBytes += kept.length
    })
    this.readerDone = this.readerLoop(new StdoutReader(child.stdout), child, stderrChunks)
    await this.handshake()
    if (this.child === child) {
      this.ready = true
    }
  }

  /**
   * MCP initialize + notifications/initialized. The reader loop is already
   * draining stdout, so the initialize response is dispatched through
   * {@link pending} instead of read inline.
   */
  private async handshake(): Promise<void> {
    const id = this.nextId()
    const frame = `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcpp', version: '0.1.0' },
      },
    })}\n`
    await this.request(id, frame)
    await this.writeFrame(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    })}\n`)
  }

  /** Allocate the next request id, starting at 1 for every spawned child. */
  private nextId(): number {
    this.requestId += 1
    return this.requestId
  }

  /**
   * Run one JSON-RPC call over the live child.
   * @param method - JSON-RPC method name.
   * @param params - request params.
   * @returns the full JSON-RPC response message.
   */
  private async rpc(method: string, params: JsonObject): Promise<JsonObject> {
    await this.ensureProcess()
    const id = this.nextId()
    const frame = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return await this.request(id, frame)
  }

  /**
   * Register a response slot, write the frame, and wait for the reader (or the
   * read timeout) to settle it.
   * @param id - request id the reader dispatches on.
   * @param frame - complete wire frame, including its trailing newline.
   * @returns the full JSON-RPC response message.
   */
  private async request(id: number, frame: string): Promise<JsonObject> {
    const result = new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new UpstreamTransportError(
            `Stdio upstream '${this.name}': read timeout after ${this.readTimeout}s`,
          ),
        )
      }, this.readTimeout * 1000)
      this.pending.set(id, {
        resolve: (message: JsonObject) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error: Error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
    // A spawn failure can reject this slot while the caller is still awaiting
    // the stdin write, before the `await result` below re-reads it; keep the
    // rejection marked handled so it is never reported as unhandled.
    void result.catch(() => undefined)
    try {
      await this.writeFrame(frame)
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending !== undefined) {
        this.pending.delete(id)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return await result
  }

  /**
   * Queue one complete frame for stdin, respecting backpressure so the buffer
   * is only written out before the next frame is appended.
   * @param frame - complete wire frame.
   */
  private async writeFrame(frame: string): Promise<void> {
    const next = this.writeQueue.then(async () => await this.writeNow(frame))
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    await next
  }

  /**
   * Write one frame to stdin, waiting for `drain` when the kernel buffer is full.
   * @param frame - complete wire frame.
   */
  private writeNow(frame: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const writable = this.child?.stdin
      if (writable === null || writable === undefined) {
        reject(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin is not writable`))
        return
      }
      if (writable.destroyed) {
        reject(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin is closed`))
        return
      }
      let settled = false
      const cleanup = (): void => {
        writable.removeListener('drain', onDrain)
        writable.removeListener('error', onError)
        writable.removeListener('close', onClose)
      }
      const finish = (error?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (error !== undefined) {
          reject(error)
        } else {
          resolve()
        }
      }
      const onDrain = (): void => {
        finish()
      }
      const onError = (error: Error): void => {
        finish(
          new UpstreamTransportError(
            `Stdio upstream '${this.name}': stdin write failed: ${error.message}`,
          ),
        )
      }
      const onClose = (): void => {
        finish(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin closed`))
      }
      writable.on('drain', onDrain)
      writable.on('error', onError)
      writable.on('close', onClose)
      let accepted: boolean
      try {
        accepted = writable.write(frame)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (accepted) {
        finish()
      }
    })
  }

  /**
   * Drain stdout for the lifetime of one child, dispatching each frame to the
   * caller waiting on its request id. EOF fails every still-pending caller and
   * clears readiness so the next call respawns.
   * @param reader - buffered stdout of this child.
   * @param child - the child this reader belongs to.
   * @param stderrChunks - stderr captured so far, reported in the EOF message.
   */
  private async readerLoop(
    reader: StdoutReader,
    child: ChildProcess,
    stderrChunks: Buffer[],
  ): Promise<void> {
    try {
      for (;;) {
        const frame = await this.readFrame(reader)
        if (frame === null) {
          break
        }
        this.dispatchFrame(frame)
      }
    } catch {
      // A torn frame or stream failure ends this reader; the child cannot be
      // trusted to answer anything else, so the cleanup below fails the callers.
    } finally {
      if (this.child === child) {
        await this.waitForExit(child, EXIT_REPORT_WAIT_MS)
        const exitCode = this.exitLabel(child)
        const stderrTail = Buffer.concat(stderrChunks).toString('utf8').slice(0, 500)
        const base = `Stdio upstream '${this.name}': stream closed (exit code ${exitCode})`
        this.failPending(stderrTail === '' ? base : `${base}. stderr: ${stderrTail}`)
        this.ready = false
        this.readerDone = null
        // Keep the reference: a reader that failed while its child still lives
        // must leave the child reapable by the next spawn or by close().
      }
    }
  }

  /**
   * Read one JSON-RPC frame in either supported wire format.
   * @param reader - buffered stdout of the current child.
   * @returns the JSON text, or null on EOF.
   */
  private async readFrame(reader: StdoutReader): Promise<string | null> {
    const first = await reader.readLine()
    if (first === null) {
      return null
    }
    const stripped = first.trim()
    if (stripped.toLowerCase().startsWith('content-length:')) {
      const rawLength = stripped.slice('content-length:'.length).trim()
      const length = Number(rawLength)
      if (!Number.isInteger(length) || length < 0) {
        throw new Error(`invalid Content-Length header: ${rawLength}`)
      }
      // Drain the rest of the header block up to its blank-line terminator.
      for (;;) {
        const header = await reader.readLine()
        if (header === null) {
          throw new Error('stdio stream ended inside a Content-Length header block')
        }
        if (header.trim() === '') {
          break
        }
      }
      const body = await reader.readExactly(length)
      return body.toString('utf8')
    }
    // Newline-delimited JSON: the first line is the whole object.
    return first
  }

  /**
   * Hand one decoded frame to the caller waiting on its id; frames without a
   * matching pending request are unsolicited notifications or late responses
   * for a timed-out call, and are dropped.
   * @param frame - one decoded frame of JSON text.
   */
  private dispatchFrame(frame: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(frame)
    } catch {
      // Unparseable output is dropped, matching the retired service's warning path.
      return
    }
    if (!isJsonObject(parsed)) {
      return
    }
    const id = parsed['id']
    if (typeof id !== 'number') {
      return
    }
    const pending = this.pending.get(id)
    if (pending === undefined) {
      return
    }
    this.pending.delete(id)
    if ('error' in parsed) {
      pending.reject(
        new UpstreamRpcError(
          `Upstream '${this.name}' JSON-RPC error: ${rpcErrorMessage(parsed['error'])}`,
        ),
      )
    } else {
      pending.resolve(parsed)
    }
  }

  /**
   * Reject every pending caller with one message.
   * @param message - failure description handed to each caller.
   */
  private failPending(message: string): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const call of pending) {
      call.reject(new UpstreamTransportError(message))
    }
  }

  /**
   * Terminate a live child that outlived its reader, so the next spawn starts
   * from a clean process table.
   */
  private async reapLingeringChild(): Promise<void> {
    const child = this.child
    if (child === null) {
      return
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    this.signalChild(child, false)
    const exited = await this.waitForExit(child, TERMINATE_GRACE_MS)
    if (!exited) {
      this.signalChild(child, true)
      await this.waitForExit(child, TERMINATE_GRACE_MS)
    }
  }

  /**
   * Deliver a terminate (or, with `force`, a kill) to the child.
   * @param child - child to signal.
   * @param force - send `SIGKILL` instead of `SIGTERM`.
   */
  private signalChild(child: ChildProcess, force: boolean): void {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    try {
      // Windows has no process groups; the direct child is the whole tree for
      // these stdio upstreams, so signalling it is the complete cleanup.
      child.kill(force ? 'SIGKILL' : 'SIGTERM')
    } catch {
      // The child exited between the liveness check and the signal.
    }
  }

  /**
   * Wait for a child to exit.
   * @param child - child to observe.
   * @param timeoutMs - how long to wait before reporting it did not exit.
   * @returns true when the child exited, false on timeout.
   */
  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const done = (exited: boolean): void => {
        child.removeListener('exit', onExit)
        child.removeListener('close', onClose)
        if (timer !== undefined) {
          clearTimeout(timer)
        }
        resolve(exited)
      }
      const onExit = (): void => {
        done(true)
      }
      const onClose = (): void => {
        done(true)
      }
      child.once('exit', onExit)
      child.once('close', onClose)
      timer = setTimeout(() => {
        done(false)
      }, timeoutMs)
    })
  }

  /**
   * Render the child's termination status for the EOF message.
   * @param child - child whose status is reported.
   * @returns exit code, signal name, or `'n/a'`.
   */
  private exitLabel(child: ChildProcess): string {
    if (child.exitCode !== null) {
      return String(child.exitCode)
    }
    if (child.signalCode !== null) {
      return String(child.signalCode)
    }
    return 'n/a'
  }

  /** Await the current reader loop, bounded so a wedged child cannot hang close. */
  private async awaitReader(): Promise<void> {
    const done = this.readerDone
    if (done === null) {
      return
    }
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      done,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          resolve()
        }, TERMINATE_GRACE_MS)
      }),
    ])
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }

  /** Build the child environment from the inherit whitelist plus explicit vars. */
  private mergedEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const key of this.inheritEnv) {
      const value = process.env[key]
      if (value !== undefined) {
        env[key] = value
      }
    }
    for (const [key, value] of Object.entries(this.extraEnv)) {
      env[key] = value
    }
    return env
  }
}
