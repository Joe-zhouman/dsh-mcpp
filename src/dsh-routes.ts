/**
 * Same-origin routes the DSH host serves for the sidebar admin page and the
 * tool-selection settings page.
 *
 * Everything the side panel needs is served from the DSH origin under
 * `/plugins/mcpp/**`, so the iframe carries the browser's DSH session instead of
 * a copy of the gateway token, and the admin API is answered in-process (no
 * round trip through the 9020 listener).
 *
 * Owner: dsh-routes. Contract: DESIGN.md § src/dsh-routes.ts.
 *
 * @module
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAdminRequest, type AdminRequest } from './admin.ts'
import { getFormat } from './presets.ts'
import { displayName } from './transform.ts'
import type { DshRouteHandler, DshWebServer } from './dsh.ts'
import type { SelectionStore } from './selection.ts'
import type { AdminDeps, GatewayRuntime, HttpReply, Logger } from './types.ts'

/** Registration failures surfaced to the settings page. */
export interface NativeToolErrorView {
  name: string
  message: string
}

/** Live native-surface view the routes report and re-sync. */
export interface NativeToolView {
  /** Names currently registered in the DSH tool registry. */
  registeredNames(): string[]
  /** Failures from the last sync. */
  errors(): NativeToolErrorView[]
  /**
   * Re-fetch upstream tools, apply the selection, and re-register.
   * @returns the registered names and per-tool failures after the sync.
   */
  resync(): Promise<{ registered: string[]; errors: NativeToolErrorView[] }>
}

/** Dependencies of the same-origin routes. */
export interface DshRoutesDeps {
  runtime: GatewayRuntime
  /** The in-process admin surface (same deps the 9020 listener uses). */
  admin: AdminDeps
  native: NativeToolView
  selection: SelectionStore
  logger: Logger
  /** Absolute path of the admin page artifact. */
  adminHtmlPath: string
  /** Origin external MCP clients use, injected into the page's connect templates. */
  publicOrigin(): string
  /** Gateway bearer token, injected for the page's connect templates. */
  token(): string
  /** Browser-request fence from `ctx.connection.requestRejection`. */
  rejectRequest?(req: IncomingMessage): 401 | 403 | string | undefined
}

/** One exposed tool as the settings page renders it. */
export interface CatalogToolView {
  /** Stable `upstream/tool` key; the selection identity. */
  key: string
  /** Public DSH-facing name, `mcp__<toolset>__<tool>`. */
  name: string
  /** Downstream description; empty when the expose entry has none. */
  description: string
  /** Whether the selection document lists this key. */
  enabled: boolean
}

/** One aggregated server (toolset) and its exposed tools. */
export interface CatalogToolsetView {
  name: string
  /** Whether this is the configured default aggregated server. */
  default: boolean
  tools: CatalogToolView[]
}

/** One configured upstream as the settings page lists it. */
export interface CatalogUpstreamView {
  name: string
  transport: 'http' | 'stdio'
}

/** Payload of `GET /plugins/mcpp/ui/catalog`. */
export interface CatalogView {
  serverName: string
  publicOrigin: string
  toolsets: CatalogToolsetView[]
  /** Names currently registered in the DSH tool registry. */
  registered: string[]
  /** Per-tool registration failures from the last sync. */
  errors: NativeToolErrorView[]
  upstreams: CatalogUpstreamView[]
}

/** Path the sidebar iframe loads. */
const ADMIN_PATH = '/plugins/mcpp/admin'
/** Admin API root; the page's own request paths append their remainder here. */
const API_PATH = '/plugins/mcpp/api'
/** Everything this plugin owns, answered 404 when unmatched. */
const PLUGIN_PATH = '/plugins/mcpp'

/** Methods the in-process admin handler answers. */
const ADMIN_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE']

/**
 * Render a thrown value as a message.
 * @param error - thrown value.
 * @returns the message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Narrow an unknown JSON value to a plain object.
 * @param value - candidate.
 * @returns whether the value is a non-null, non-array object.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Render one string as a JavaScript string literal safe inside a `<script>`
 * element: the `<` escape keeps a value from closing the element early.
 * @param value - raw string.
 * @returns the quoted literal.
 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * Build the script that hands the page its API root, public origin, and token.
 * @param deps - routes dependencies (origin and token are read per page load).
 * @returns the complete `<script>` element.
 */
function injectionScript(deps: DshRoutesDeps): string {
  return '<script>window.__MCPP_API_BASE__=' + scriptLiteral(API_PATH)
    + ';window.__MCPP_PUBLIC_ORIGIN__=' + scriptLiteral(deps.publicOrigin())
    + ';window.__MCPP_TOKEN__=' + scriptLiteral(deps.token())
    + ';</script>'
}

/**
 * Insert the injection script at the end of the page's `<head>`, before the
 * closing tag so the globals exist before any page script runs.
 * @param html - admin page source.
 * @param script - script element to inject.
 * @returns the page with the script as the last head child.
 */
function injectIntoHead(html: string, script: string): string {
  const closeAt = html.indexOf('</head>')
  if (closeAt !== -1) return html.slice(0, closeAt) + script + html.slice(closeAt)
  const open = /<head\b[^>]*>/i.exec(html)
  if (open !== null) {
    const at = open.index + open[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  return script + html
}

/**
 * Read a request body to a UTF-8 string.
 * @param req - inbound request.
 * @returns the decoded body.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Write one JSON answer.
 * @param res - response being owned.
 * @param status - HTTP status.
 * @param body - value to serialize as the response body.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Write one in-process admin reply unchanged: status, headers, and JSON body.
 * @param res - response being owned.
 * @param reply - handler answer as the 9020 listener writes it.
 */
function sendReply(res: ServerResponse, reply: HttpReply): void {
  const headers: Record<string, string> = { ...reply.headers }
  headers['content-type'] = headers['content-type'] ?? 'application/json'
  const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
  res.writeHead(reply.status, headers)
  res.end(payload)
}

/** One route body, run after the fence and method gate have passed. */
type RouteBody = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/**
 * Register every `/plugins/mcpp/**` route on the host web server.
 * @param webServer - host web server service.
 * @param deps - admin handler, selection store, and page assets.
 * @returns the disposer removing every route.
 */
export function registerDshRoutes(webServer: DshWebServer, deps: DshRoutesDeps): () => void {
  /** The admin page source, read at most once. */
  let adminHtml: string | undefined

  /**
   * Wrap one route body with the browser fence, the method gate, and failure
   * containment. A route owns its whole response, so a failure answers 500
   * rather than escaping into the host's generic handler.
   * @param methods - allowed HTTP methods, or undefined for any.
   * @param body - the route's work after both gates pass.
   * @returns the handler registered on the host web server.
   */
  const route = (methods: readonly string[] | undefined, body: RouteBody): DshRouteHandler => {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const rejection = deps.rejectRequest?.(req)
      if (rejection !== undefined) {
        // The host's connection fence reports its HTTP status (401/403); a
        // string is a diagnostic fallback. The page contract keeps `error` a
        // string either way.
        const status = typeof rejection === 'number' ? rejection : 403
        sendJson(res, status, { error: String(rejection) })
        return
      }
      const method = req.method ?? 'GET'
      if (methods !== undefined && !methods.includes(method)) {
        sendJson(res, 405, { error: 'Method Not Allowed' })
        return
      }
      try {
        await body(req, res)
      } catch (error) {
        const message = messageOf(error)
        const path = (req.url ?? '').split('?')[0] ?? ''
        deps.logger.error(`mcpp: ${method} ${path} failed: ${message}`)
        if (res.headersSent) res.destroy()
        else sendJson(res, 500, { error: 'Internal Server Error' })
      }
    }
  }

  /** `GET /plugins/mcpp/admin` — the ported page plus the injected globals. */
  const serveAdminPage: RouteBody = async (_req, res) => {
    adminHtml ??= await readFile(deps.adminHtmlPath, 'utf8')
    const page = injectIntoHead(adminHtml, injectionScript(deps))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
  }

  /** `/plugins/mcpp/api/**` — the same handler and reply the 9020 listener uses. */
  const serveAdminApi: RouteBody = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://placeholder')
    let segments: string[]
    try {
      segments = url.pathname.slice(API_PATH.length).split('/')
        .filter((segment) => segment !== '')
        .map(decodeURIComponent)
    } catch {
      sendJson(res, 400, { error: 'Invalid path encoding' })
      return
    }
    let bodyTextPromise: Promise<string> | undefined
    const bodyText = (): Promise<string> => {
      bodyTextPromise ??= readBody(req)
      return bodyTextPromise
    }
    const request: AdminRequest = {
      method: (req.method ?? 'GET') as AdminRequest['method'],
      segments,
      query: url.searchParams,
      bodyText,
      bodyJson: async () => JSON.parse(await bodyText()),
    }
    sendReply(res, await handleAdminRequest(deps.admin, request))
  }

  /** The selection document plus live config, as the settings page reads it. */
  const catalog = async (): Promise<CatalogView> => {
    const config = deps.runtime.config
    const format = getFormat('claude')
    const enabled = new Set((await deps.selection.load()).enabled)
    const toolsets: CatalogToolsetView[] = []
    const byName = new Map<string, CatalogToolsetView>()
    for (const [key, entry] of Object.entries(config.expose)) {
      if (entry.hide) continue
      const toolset = entry.toolset ?? config.serverName
      let group = byName.get(toolset)
      if (group === undefined) {
        group = { name: toolset, default: toolset === config.serverName, tools: [] }
        byName.set(toolset, group)
        toolsets.push(group)
      }
      group.tools.push({
        key,
        name: format.formatName(toolset, displayName(entry, key)),
        description: entry.description ?? '',
        enabled: enabled.has(key),
      })
    }
    return {
      serverName: config.serverName,
      publicOrigin: deps.publicOrigin(),
      toolsets,
      registered: deps.native.registeredNames(),
      errors: deps.native.errors(),
      upstreams: config.upstreams.map((upstream) => ({ name: upstream.name, transport: upstream.transport })),
    }
  }

  /** `GET /plugins/mcpp/ui/catalog` — exposed tools, toolsets, and selection. */
  const serveCatalog: RouteBody = async (_req, res) => {
    sendJson(res, 200, await catalog())
  }

  /** `POST /plugins/mcpp/ui/selection` — persist the selection, then re-sync. */
  const serveSelection: RouteBody = async (req, res) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      sendJson(res, 400, { ok: false, error: `invalid JSON body: ${messageOf(error)}` })
      return
    }
    if (!isJsonObject(parsed)) {
      sendJson(res, 400, { ok: false, error: 'body must be a JSON object' })
      return
    }
    const raw = parsed['enabled']
    if (!Array.isArray(raw)) {
      sendJson(res, 400, { ok: false, error: "'enabled' must be an array of stable tool keys" })
      return
    }
    const enabled = raw.filter((item): item is string => typeof item === 'string')
    await deps.selection.save(enabled)
    const result = await deps.native.resync()
    sendJson(res, 200, { ok: true, registered: result.registered, errors: result.errors })
  }

  /** `POST /plugins/mcpp/ui/sync` — re-fetch upstreams and re-register. */
  const serveSync: RouteBody = async (_req, res) => {
    const result = await deps.native.resync()
    sendJson(res, 200, { ok: true, registered: result.registered, errors: result.errors })
  }

  /** Unmatched `/plugins/mcpp/**` paths answer 404 instead of the host fallback. */
  const serveNotFound: RouteBody = async (_req, res) => {
    sendJson(res, 404, { error: 'Not Found' })
  }

  /** Roll back the routes registered so far when a later registration throws. */
  const disposers: (() => void)[] = []
  const add = (kind: 'exact' | 'prefix', path: string, methods: readonly string[] | undefined, body: RouteBody): void => {
    disposers.push(webServer.register({ kind, path, handler: route(methods, body) }))
  }
  try {
    add('exact', ADMIN_PATH, ['GET'], serveAdminPage)
    add('prefix', API_PATH, ADMIN_METHODS, serveAdminApi)
    add('exact', `${PLUGIN_PATH}/ui/catalog`, ['GET'], serveCatalog)
    add('exact', `${PLUGIN_PATH}/ui/selection`, ['POST'], serveSelection)
    add('exact', `${PLUGIN_PATH}/ui/sync`, ['POST'], serveSync)
    add('prefix', PLUGIN_PATH, undefined, serveNotFound)
  } catch (error) {
    for (const dispose of disposers.splice(0)) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
