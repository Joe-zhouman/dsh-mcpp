/**
 * HTTP carrier for the gateway: one `node:http` listener that routes the
 * retired service's URL space onto the MCP protocol layer and the admin API.
 *
 * The route table, status codes, and body shapes mirror the FastAPI app being
 * replaced: same paths, same `{"detail": ...}` bodies for framework-level
 * failures (404/405), same `{"error": ...}` bodies for handler failures.
 *
 * @module
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleAdminRequest, type AdminRequest } from './admin.ts'
import { resolveEnvValue } from './config.ts'
import { handleMcpRequest } from './gateway.ts'
import { getFormat, NAMING_IDS } from './presets.ts'
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  type AdminDeps,
  type GatewayRuntime,
  type HttpReply,
  type Logger,
  type McpHandlerDeps,
} from './types.ts'

/** Everything the listener needs from the composition root. */
export interface ServerOptions {
  host: string
  port: number
  runtime: GatewayRuntime
  mcp: McpHandlerDeps
  admin: AdminDeps
  logger: Logger
  /** Absolute path of the ported admin page. */
  adminHtmlPath: string
  /** Environment used to resolve `${VAR}` in the gateway token. @default process.env */
  env?: NodeJS.ProcessEnv
}

/** Handle for the listening HTTP server. */
export interface HttpServerHandle {
  /** Bound address, or undefined before {@link start} resolves. */
  readonly address: { host: string; port: number } | undefined
  /**
   * Bind the listener.
   * @returns the bound address; a port of `0` resolves to the OS-assigned one.
   */
  start(): Promise<{ host: string; port: number }>
  /** Stop accepting connections and destroy open ones. Idempotent. */
  close(): Promise<void>
}

/** JSON body helper: one `application/json` response. */
function jsonReply(status: number, body: unknown, headers?: Record<string, string>): HttpReply {
  return { status, body, headers }
}

/** Framework-level not-found body, matching FastAPI. */
function detail(status: number, message: string): HttpReply {
  return jsonReply(status, { detail: message })
}

/**
 * Constant-time string equality over SHA-256 digests (length-independent).
 * @param provided - caller-supplied token.
 * @param expected - configured token.
 * @returns whether they are equal.
 */
function tokenEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** Read a request body to a UTF-8 string. */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Where one request path routes to. */
type Route =
  | { kind: 'mcp'; clientId: string; rawToolset: string }
  | { kind: 'legacy-mcp' }
  | { kind: 'admin'; segments: string[] }
  | { kind: 'admin-ui' }
  | { kind: 'not-found' }
  | { kind: 'method-not-allowed' }

/** Methods the admin API answers; anything else is a 405 at the framework layer. */
const ADMIN_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

/**
 * Resolve one request path onto the route table.
 * @param segments - percent-decoded path segments.
 * @param method - HTTP method.
 * @returns the route the request maps to.
 */
function routeFor(segments: string[], method: string): Route {
  if (segments.length === 1 && segments[0] === 'mcp') {
    return method === 'POST' ? { kind: 'legacy-mcp' } : { kind: 'method-not-allowed' }
  }
  const naming = segments[1]
  if (segments.length === 3 && segments[2] === 'mcp' && naming !== undefined && NAMING_IDS.includes(naming)) {
    return method === 'POST'
      ? { kind: 'mcp', clientId: naming, rawToolset: segments[0]! }
      : { kind: 'method-not-allowed' }
  }
  if (segments.length === 1 && segments[0] === 'admin') {
    return method === 'GET' || method === 'HEAD' ? { kind: 'admin-ui' } : { kind: 'method-not-allowed' }
  }
  if (segments[0] === 'api') {
    return ADMIN_METHODS.has(method) ? { kind: 'admin', segments: segments.slice(1) } : { kind: 'method-not-allowed' }
  }
  if (segments[0] === 'mcp') {
    // `/mcp/...` has no route in the retired service either.
    return { kind: 'not-found' }
  }
  return { kind: 'not-found' }
}

/** The bearer token a request presents, and where it came from. */
interface PresentedToken {
  token: string | undefined
  source: 'header' | 'query' | 'cookie' | ''
}

/**
 * Extract a token from the `Authorization: Bearer` header, `?token=`, or the
 * session cookie, in that order.
 * @param req - inbound request.
 * @param url - parsed request URL.
 * @returns the presented token and its source.
 */
function presentedToken(req: IncomingMessage, url: URL): PresentedToken {
  const header = req.headers.authorization ?? ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return { token: header.slice(7).trim(), source: 'header' }
  }
  const query = url.searchParams.get('token')
  if (query !== null) return { token: query, source: 'query' }
  const cookie = readCookie(req.headers.cookie, AUTH_COOKIE_NAME)
  if (cookie !== undefined) return { token: cookie, source: 'cookie' }
  return { token: undefined, source: '' }
}

/**
 * Read one cookie value out of a `Cookie` header.
 * @param header - raw `Cookie` header.
 * @param name - cookie name.
 * @returns the value, or undefined when absent.
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * Build the HTTP server for the gateway. Nothing binds until {@link HttpServerHandle.start}.
 * @param options - route dependencies, bind address, and the admin page path.
 * @returns the server handle.
 */
export function createHttpServer(options: ServerOptions): HttpServerHandle {
  const { runtime, mcp, admin, logger } = options
  const env = options.env ?? process.env
  let server: Server | undefined
  let adminHtml: string | undefined
  let bound: { host: string; port: number } | undefined

  /** The live gateway token, resolved through `${VAR}` on every request. */
  const expectedToken = (): string => {
    const configured = runtime.config.auth?.token
    if (configured === undefined || configured === '') return ''
    return resolveEnvValue(configured, env)
  }

  /** Write one reply, applying the `?token=` -> cookie session upgrade. */
  const send = (res: ServerResponse, reply: HttpReply, setCookie: string | undefined): void => {
    const headers: Record<string, string> = { ...reply.headers }
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    if (setCookie !== undefined) {
      headers['set-cookie'] = `${AUTH_COOKIE_NAME}=${setCookie}; Max-Age=${AUTH_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`
    }
    const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
    res.writeHead(reply.status, headers)
    res.end(payload)
  }

  /** Full request lifecycle: route, authenticate, dispatch, respond. */
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://placeholder')
    let segments: string[]
    try {
      segments = url.pathname.split('/').filter((segment) => segment !== '').map(decodeURIComponent)
    } catch {
      send(res, detail(400, 'Invalid path encoding'), undefined)
      return
    }
    const route = routeFor(segments, method)

    // Framework-level misses answer without touching auth, matching FastAPI's
    // dependency ordering (Starlette resolves the route first).
    if (route.kind === 'not-found') {
      send(res, detail(404, 'Not Found'), undefined)
      return
    }
    if (route.kind === 'method-not-allowed') {
      send(res, detail(405, 'Method Not Allowed'), undefined)
      return
    }

    const presented = presentedToken(req, url)
    const expected = expectedToken()
    if (expected !== '' && (presented.token === undefined || !tokenEquals(presented.token, expected))) {
      send(res, detail(401, 'Invalid or missing token'), undefined)
      return
    }
    const cookieUpgrade = expected !== '' && presented.source === 'query' && readCookie(req.headers.cookie, AUTH_COOKIE_NAME) === undefined
      ? presented.token
      : undefined

    try {
      if (route.kind === 'admin-ui') {
        if (adminHtml === undefined) throw new Error('admin page was not loaded')
        send(res, jsonReply(200, adminHtml, { 'content-type': 'text/html; charset=utf-8' }), cookieUpgrade)
        return
      }

      if (route.kind === 'admin') {
        const bodyText = (): Promise<string> => readBody(req)
        const adminRequest: AdminRequest = {
          method: method as AdminRequest['method'],
          segments: route.segments,
          query: url.searchParams,
          bodyText,
          bodyJson: async () => JSON.parse(await bodyText()),
        }
        const reply = await handleAdminRequest(admin, adminRequest)
        send(res, reply, reply.status === 200 ? cookieUpgrade : undefined)
        return
      }

      const bodyText = await readBody(req)
      let body: unknown
      try {
        body = JSON.parse(bodyText)
      } catch {
        send(res, {
          status: 400,
          body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        }, undefined)
        return
      }
      const reply = await handleMcpRequest(mcp, {
        clientId: route.kind === 'legacy-mcp' ? 'default' : route.clientId,
        rawToolset: route.kind === 'legacy-mcp' ? '' : route.rawToolset,
        body,
      })
      send(res, reply, reply.status === 200 ? cookieUpgrade : undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`request ${method} ${url.pathname} failed: ${message}`)
      if (!res.headersSent) {
        send(res, detail(500, 'Internal Server Error'), undefined)
      } else {
        res.destroy()
      }
    }
  }

  return {
    get address() {
      return bound
    },

    async start() {
      adminHtml = await readFile(options.adminHtmlPath, 'utf8')
      const httpServer = createServer((req, res) => {
        // One malformed request must not take the host process down.
        void handle(req, res).catch((error: unknown) => {
          logger.error(`unhandled request failure: ${error instanceof Error ? error.message : String(error)}`)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end()
          } else {
            res.destroy()
          }
        })
      })
      server = httpServer
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          httpServer.off('error', onError)
          resolve()
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListening)
        httpServer.listen(options.port, options.host)
      })
      const address = httpServer.address() as AddressInfo
      bound = { host: options.host, port: address.port }
      return bound
    },

    async close() {
      const httpServer = server
      server = undefined
      bound = undefined
      if (httpServer === undefined) return
      await new Promise<void>((resolve) => {
        httpServer.close(() => { resolve() })
        httpServer.closeAllConnections()
      })
    },
  }
}

// Re-exported so the composition root can name the naming ids it serves without
// importing the preset catalogue again.
export { getFormat }
