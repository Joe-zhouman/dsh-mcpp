/**
 * HTTP upstream transport: JSON-RPC over the MCP Streamable HTTP framing,
 * including the initialize handshake, session recovery, and one retry after a
 * transport-level failure.
 *
 * The retired service used httpx; here the connection pool is a per-transport
 * `keepAlive` agent. Recovering destroys that agent and builds a fresh one,
 * which drops every pooled socket exactly like rebuilding the httpx client did.
 *
 * Owner: upstream. Contract: DESIGN.md § src/upstream-http.ts and
 * the retired service's `upstream.py:74-271`.
 *
 * @module
 */

import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import type { Socket } from 'node:net'

import { UpstreamHttpError, UpstreamRpcError, UpstreamTransportError } from './errors.ts'
import type { JsonObject, Tool, UpstreamTransport } from './types.ts'

/** Seconds allowed for the TCP/TLS connection before the request fails. */
const DEFAULT_CONNECT_TIMEOUT = 30

/** Seconds allowed from sending the request until the response body ends. */
const DEFAULT_READ_TIMEOUT = 120

/** Construction options for one HTTP upstream. */
export interface HttpTransportOptions {
  name: string
  url: string
  /** Fresh auth headers per outbound request (key-pool rotation). */
  getAuth?: () => Record<string, string> | undefined
  /** Connect timeout in seconds. @default 30 */
  connectTimeout?: number
  /** Read timeout in seconds. @default 120 */
  readTimeout?: number
}

/** One fully read HTTP response, as the framing logic consumes it. */
interface HttpResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/**
 * Extract the first JSON-RPC object from an SSE body. Consecutive `data:` lines
 * belong to one event and are joined with newlines; a trailing event without a
 * blank-line terminator still flushes.
 * @param text - raw response body.
 * @returns the parsed object, or null when no data event parses.
 */
export function parseSseJson(text: string): JsonObject | null {
  let dataLines: string[] = []

  const flush = (): JsonObject | null => {
    if (dataLines.length === 0) {
      return null
    }
    const blob = dataLines.join('\n')
    dataLines = []
    try {
      const parsed: unknown = JSON.parse(blob)
      return isJsonObject(parsed) ? parsed : null
    } catch {
      // A malformed event is simply not the JSON-RPC payload; later events may be.
      return null
    }
  }

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^\s+/, ''))
    } else if (line.trim() === '' && dataLines.length > 0) {
      const parsed = flush()
      if (parsed !== null) {
        return parsed
      }
    }
  }
  return flush()
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
 * Read one header value out of Node's decoded response headers.
 * @param value - raw header value.
 * @returns the first value, or undefined when the header is absent.
 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value[0]
  }
  return undefined
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

/** One Streamable-HTTP upstream connection. */
export class HttpTransport implements UpstreamTransport {
  readonly name: string

  /** Resolved MCP endpoint (`/mcp` appended only when the URL lacks it). */
  private readonly endpoint: URL

  private readonly getAuth: (() => Record<string, string> | undefined) | undefined

  /** Connect timeout in seconds. */
  private readonly connectTimeout: number

  /** Read timeout in seconds. */
  private readonly readTimeout: number

  /** Keep-alive pool; replaced wholesale by {@link recoverConnection}. */
  private agent: HttpAgent

  private sessionId: string | null = null

  private requestId = 0

  private closed = false

  /** @param options - endpoint, auth resolver, and timeouts. */
  constructor(options: HttpTransportOptions) {
    this.name = options.name
    const base = options.url.replace(/\/+$/, '')
    const resolved = base.toLowerCase().includes('/mcp') ? base : `${base}/mcp`
    this.endpoint = new URL(resolved)
    this.getAuth = options.getAuth
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
    this.readTimeout = options.readTimeout ?? DEFAULT_READ_TIMEOUT
    this.agent = this.newAgent()
  }

  /** Fetch the upstream tool list (raw). */
  async listTools(): Promise<Tool[]> {
    const message = await this.rpc('tools/list', undefined)
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

  /** Release the connection pool. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.sessionId = null
    this.agent.destroy()
  }

  /** Build a keep-alive pool appropriate for the endpoint's protocol. */
  private newAgent(): HttpAgent {
    return this.endpoint.protocol === 'https:'
      ? new HttpsAgent({ keepAlive: true })
      : new HttpAgent({ keepAlive: true })
  }

  /**
   * Discard the cached session and rebuild the keep-alive pool, dropping every
   * pooled socket. Used after a transport-level failure, where those sockets
   * cannot be trusted and an upstream may signal a stale session by dropping
   * the connection instead of answering 404.
   */
  private recoverConnection(): void {
    this.sessionId = null
    try {
      this.agent.destroy()
    } catch {
      // Teardown of an already-destroyed pool must not mask the original failure.
    }
    this.agent = this.newAgent()
  }

  /** Allocate the next request id, starting at 1 like the retired service. */
  private nextId(): number {
    this.requestId += 1
    return this.requestId
  }

  /** Headers for one outbound request; auth is resolved fresh on every call. */
  private headers(withSession: boolean): Record<string, string> {
    // MCP Streamable HTTP: the client must accept both the single JSON-RPC
    // response and the SSE stream forms. Some servers answer 406 without this.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (withSession && this.sessionId !== null) {
      headers['MCP-Session-Id'] = this.sessionId
    }
    if (this.getAuth !== undefined) {
      const authHeaders = this.getAuth()
      if (authHeaders !== undefined) {
        Object.assign(headers, authHeaders)
      }
    }
    return headers
  }

  /**
   * Run the MCP initialize handshake once and cache the session id.
   *
   * Streamable-HTTP servers require initialize → (capture session id) →
   * notifications/initialized; subsequent requests then carry MCP-Session-Id.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionId !== null) {
      return
    }
    const payload: JsonObject = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcpp', version: '0.1.0' },
      },
    }
    const response = await this.send(payload, false)
    if (response.status !== 200) {
      throw new UpstreamHttpError(
        `Upstream '${this.name}' initialize returned ${response.status}`,
        response.status,
      )
    }
    const sessionId = headerValue(response.headers['mcp-session-id'])
    if (sessionId === undefined || sessionId === '') {
      // Server doesn't use sessions — proceed stateless.
      return
    }
    this.sessionId = sessionId
    // Complete the handshake; the notification's answer carries no payload the
    // gateway needs, so its status and body are ignored like the retired service.
    await this.send(
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      true,
    )
  }

  /** One POST with a JSON body, fully read. */
  private send(payload: JsonObject, withSession: boolean): Promise<HttpResponse> {
    if (this.closed) {
      return Promise.reject(
        new UpstreamTransportError(`Upstream '${this.name}': transport is closed`),
      )
    }
    return new Promise<HttpResponse>((resolve, reject) => {
      const body = JSON.stringify(payload)
      let settled = false
      let readTimer: NodeJS.Timeout | undefined
      let request: ReturnType<typeof httpRequest> | null = null

      const clearReadTimer = (): void => {
        if (readTimer !== undefined) {
          clearTimeout(readTimer)
          readTimer = undefined
        }
      }
      const fail = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearReadTimer()
        request?.destroy()
        reject(error)
      }
      const succeed = (response: HttpResponse): void => {
        if (settled) {
          return
        }
        settled = true
        clearReadTimer()
        resolve(response)
      }
      const onResponse = (response: IncomingMessage): void => {
        if (settled) {
          return
        }
        // The socket is connected: from here the overall read timer owns the deadline.
        request?.socket?.setTimeout(0)
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          succeed({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        response.on('error', (error: Error) => {
          fail(this.transportError(`response failed: ${error.message}`))
        })
        response.on('aborted', () => {
          fail(this.transportError('response was aborted'))
        })
      }

      const options: RequestOptions = {
        method: 'POST',
        headers: this.headers(withSession),
        agent: this.agent,
      }
      request = this.endpoint.protocol === 'https:'
        ? httpsRequest(this.endpoint, options, onResponse)
        : httpRequest(this.endpoint, options, onResponse)

      // The socket-level timer covers connection establishment only; once the
      // socket is connected the overall read timer owns the deadline.
      request.setTimeout(this.connectTimeout * 1000, () => {
        fail(this.transportError(`connect timeout after ${this.connectTimeout}s`))
      })
      request.on('socket', (assigned: Socket) => {
        if (!assigned.connecting) {
          // Reused keep-alive socket: already connected.
          assigned.setTimeout(0)
          return
        }
        const clearConnectTimer = (): void => {
          assigned.setTimeout(0)
          assigned.removeListener('connect', clearConnectTimer)
          assigned.removeListener('secureConnect', clearConnectTimer)
        }
        assigned.once('connect', clearConnectTimer)
        assigned.once('secureConnect', clearConnectTimer)
      })
      request.on('error', (error: Error) => {
        fail(this.transportError(error.message))
      })
      readTimer = setTimeout(() => {
        fail(this.transportError(`read timeout after ${this.readTimeout}s`))
      }, this.readTimeout * 1000)
      request.end(body)
    })
  }

  /**
   * Build a transport-level failure carrying the `Upstream '<name>'` prefix.
   * @param detail - what failed, e.g. `connect timeout after 30s`.
   * @returns the typed failure.
   */
  private transportError(detail: string): UpstreamTransportError {
    return new UpstreamTransportError(`Upstream '${this.name}' transport error: ${detail}`)
  }

  /**
   * POST one JSON-RPC request, retrying once on a transport failure or a 404
   * for a cached session. HTTP errors are real answers and are not retried.
   * @param method - JSON-RPC method name.
   * @param params - request params, or undefined for `{}`.
   * @returns the fully read HTTP response.
   */
  private async postRpc(method: string, params: JsonObject | undefined): Promise<HttpResponse> {
    if (this.closed) {
      throw new UpstreamTransportError(`Upstream '${this.name}': transport is closed`)
    }
    for (let attempt = 0; ; attempt += 1) {
      await this.ensureSession()
      const payload: JsonObject = {
        jsonrpc: '2.0',
        id: this.nextId(),
        method,
        params: params ?? {},
      }
      try {
        const response = await this.send(payload, true)
        // Session expired / not found — drop it and retry once.
        if (response.status === 404 && attempt === 0 && this.sessionId !== null) {
          this.sessionId = null
          continue
        }
        return response
      } catch (error) {
        // No usable HTTP response — connection dropped or reset. Retry once
        // over a rebuilt pool; without this the caller eats the whole read
        // timeout on what is usually a stale socket or a session the upstream
        // signals by dropping the connection instead of answering 404.
        if (error instanceof UpstreamTransportError && attempt === 0) {
          this.recoverConnection()
          continue
        }
        throw error
      }
    }
  }

  /**
   * Run one JSON-RPC call and decode its response body.
   * @param method - JSON-RPC method name.
   * @param params - request params, or undefined for `{}`.
   * @returns the decoded JSON-RPC response object.
   */
  private async rpc(method: string, params: JsonObject | undefined): Promise<JsonObject> {
    const response = await this.postRpc(method, params)
    if (response.status !== 200) {
      throw new UpstreamHttpError(
        `Upstream '${this.name}' returned ${response.status}`,
        response.status,
      )
    }
    const data = this.decodeBody(response)
    if ('error' in data) {
      throw new UpstreamRpcError(
        `Upstream '${this.name}' JSON-RPC error: ${rpcErrorMessage(data['error'])}`,
      )
    }
    return data
  }

  /**
   * Decode a 200 response body according to its content type.
   * @param response - fully read response.
   * @returns the decoded JSON-RPC object.
   */
  private decodeBody(response: HttpResponse): JsonObject {
    const contentType = headerValue(response.headers['content-type']) ?? ''
    if (contentType.startsWith('application/json')) {
      return this.parseJsonBody(response.body)
    }
    if (contentType.startsWith('text/event-stream')) {
      // MCP Streamable HTTP: the JSON-RPC payload arrives as an SSE event.
      const data = parseSseJson(response.body)
      if (data === null) {
        throw new UpstreamTransportError(
          `Upstream '${this.name}': SSE stream had no JSON-RPC response`,
        )
      }
      return data
    }
    // Try JSON anyway; some servers omit a proper content-type.
    try {
      return this.parseJsonBody(response.body)
    } catch {
      throw new UpstreamHttpError(
        `Upstream '${this.name}': unsupported content-type '${contentType}'`,
        response.status,
      )
    }
  }

  /**
   * Parse a response body expected to be one JSON object.
   * @param body - raw response text.
   * @returns the parsed object.
   */
  private parseJsonBody(body: string): JsonObject {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new UpstreamTransportError(
        `Upstream '${this.name}': response body is not valid JSON`,
      )
    }
    if (!isJsonObject(parsed)) {
      throw new UpstreamTransportError(
        `Upstream '${this.name}': response body is not a JSON object`,
      )
    }
    return parsed
  }
}
