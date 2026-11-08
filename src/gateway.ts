/**
 * MCP protocol layer: one JSON-RPC request in, one HTTP reply out, for one
 * (toolset, naming mode) endpoint.
 *
 * Owner: gateway-admin. Contract: DESIGN.md § src/gateway.ts and the retired
 * service's `main.py:35-85,417-679`.
 *
 * The endpoint is stateless: every request re-reads the live configuration and
 * the live transport map, so an admin reload is visible to the next call
 * without any session bookkeeping.
 *
 * @module
 */

import { ParamError, UpstreamHttpError } from './errors.ts'
import { getFormat } from './presets.ts'
import { displayName, paramTransformValue, transformTools } from './transform.ts'
import { PROTOCOL_VERSION, SERVER_VERSION } from './types.ts'
import type {
  ExposeEntry,
  GatewayConfig,
  HttpReply,
  JsonObject,
  McpHandlerDeps,
  Tool,
} from './types.ts'

/** One inbound JSON-RPC request already routed to (toolset, naming mode). */
export interface McpRequestContext {
  /** Naming mode the endpoint serves (`claude`, `cursor`, … `default`). */
  clientId: string
  /**
   * Raw toolset segment from the URL path. The legacy `/mcp` alias carries an
   * empty string, meaning the default toolset.
   */
  rawToolset: string
  /** Parsed JSON body. */
  body: unknown
}

/**
 * Timeout marker for one upstream's `tools/list`. Kept distinct from transport
 * errors so the log line can say "timed out" instead of echoing a raw abort.
 */
class ListTimeoutError extends Error {
  override readonly name = 'ListTimeoutError'
}

/**
 * Narrow an unknown JSON value to a plain object.
 * @param value - candidate.
 * @returns whether the value is a non-null, non-array object.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Render an unknown thrown value as a message.
 * @param error - thrown value.
 * @returns the message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Race a promise against a timeout.
 * @param promise - the operation to cap.
 * @param timeoutMs - cap in milliseconds.
 * @returns the operation's value.
 * @throws ListTimeoutError when the cap expires first; otherwise the
 * operation's own rejection.
 */
function withListTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ListTimeoutError()) }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** One JSON-RPC success answer. */
function rpcResult(id: unknown, result: unknown): HttpReply {
  return { status: 200, body: { jsonrpc: '2.0', id, result } }
}

/** One JSON-RPC error answer. */
function rpcError(id: unknown, code: number, message: string): HttpReply {
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code, message } } }
}

/** Current wall-clock time in seconds, the unit `/api/calls` and the UI expect. */
function nowSeconds(): number {
  return Date.now() / 1000
}

/**
 * Every toolset name used by the expose table, plus the default server name.
 * @param config - gateway configuration.
 * @returns the set of known toolset names.
 */
export function knownToolsets(config: GatewayConfig): Set<string> {
  const names = new Set<string>()
  for (const entry of Object.values(config.expose)) {
    names.add(entry.toolset ?? config.serverName)
  }
  names.add(config.serverName)
  return names
}

/**
 * Normalize a URL toolset segment to a real toolset name.
 * @param config - gateway configuration.
 * @param toolset - raw segment; the literal `mcpp` maps to the default server.
 * @returns the resolved name, or null when unknown.
 */
export function resolveToolset(config: GatewayConfig, toolset: string): string | null {
  if (knownToolsets(config).has(toolset)) return toolset
  if (toolset === 'mcpp') return config.serverName
  return null
}

/**
 * Fetch one upstream's tools with a list timeout, transform them, and swallow
 * per-upstream failures into an empty list plus a warning.
 * @param deps - handler dependencies.
 * @param config - gateway configuration.
 * @param upstreamName - upstream to fetch.
 * @param client - naming mode.
 * @param toolset - aggregated server filter, or undefined for all.
 * @param listTimeout - per-upstream cap in seconds.
 * @returns transformed tools, or `[]` when the upstream failed or timed out.
 */
export async function fetchTools(
  deps: McpHandlerDeps,
  config: GatewayConfig,
  upstreamName: string,
  client: string,
  toolset: string | undefined,
  listTimeout: number,
): Promise<Tool[]> {
  const transport = deps.transport(upstreamName)
  if (transport === undefined) return []
  try {
    const tools = await withListTimeout(transport.listTools(), listTimeout * 1000)
    return transformTools(upstreamName, tools, config, client, toolset)
  } catch (error) {
    if (error instanceof ListTimeoutError) {
      deps.logger.warn(`Upstream '${upstreamName}' tools/list timed out after ${listTimeout}s, skipped`)
    } else {
      deps.logger.warn(`Upstream '${upstreamName}' failed: ${messageOf(error)}`)
    }
    return []
  }
}

/**
 * Fetch and transform tools from every configured upstream concurrently.
 * @param deps - handler dependencies.
 * @param config - gateway configuration.
 * @param client - naming mode id.
 * @param toolset - aggregated server filter, or undefined for all.
 * @returns concatenated tools in configuration order.
 */
export async function fetchAllTools(
  deps: McpHandlerDeps,
  config: GatewayConfig,
  client = 'default',
  toolset?: string,
): Promise<Tool[]> {
  const results = await Promise.all(
    config.upstreams.map(async (upstream) =>
      fetchTools(deps, config, upstream.name, client, toolset, upstream.listTimeout),
    ),
  )
  return results.flat()
}

/**
 * Find the expose entry a client-visible or stable name refers to.
 * @param config - gateway configuration.
 * @param nameOrKey - client-formatted name, display name, or stable key.
 * @param client - naming mode id.
 * @param toolset - aggregated server filter, or undefined for any.
 * @returns the entry and its upstream name, or null when nothing matches.
 */
export function findExposeEntry(
  config: GatewayConfig,
  nameOrKey: string,
  client: string,
  toolset: string | undefined,
): { entry: ExposeEntry; upstreamName: string } | null {
  const inToolset = (entry: ExposeEntry): boolean =>
    toolset === undefined || (entry.toolset ?? config.serverName) === toolset

  // Client-formatted names carry the toolset prefix; strip it first, then match
  // the recovered display name against the expose table.
  if (client !== 'default') {
    const format = getFormat(client)
    let display = format.parseName(toolset ?? config.serverName, nameOrKey)
    // The prefix uses the resolved toolset name; a custom server_name can make
    // the URL segment differ from it, so retry with the configured name.
    if (display === null && toolset !== undefined && toolset !== config.serverName) {
      display = format.parseName(config.serverName, nameOrKey)
    }
    if (display !== null) {
      for (const [key, entry] of Object.entries(config.expose)) {
        if (entry.hide || !inToolset(entry)) continue
        if (displayName(entry, key) === display) {
          return { entry, upstreamName: key.split('/')[0] ?? '' }
        }
      }
    }
  }

  // Default / fallback: match by stable key or display name within the toolset.
  for (const [key, entry] of Object.entries(config.expose)) {
    if (entry.hide || !inToolset(entry)) continue
    if (nameOrKey === key || nameOrKey === displayName(entry, key)) {
      return { entry, upstreamName: key.split('/')[0] ?? '' }
    }
  }
  return null
}

/**
 * Record one `tools/call` outcome. Arguments and results are deliberately not
 * recorded: they may carry secrets and the log is a health signal, not traffic.
 * @param deps - handler dependencies.
 * @param tool - client-visible tool name.
 * @param upstream - upstream that served the call.
 * @param ok - whether the call succeeded.
 * @param latencyMs - call duration in milliseconds.
 * @param error - failure message, truncated to 200 characters.
 */
function recordCall(
  deps: McpHandlerDeps,
  tool: string,
  upstream: string,
  ok: boolean,
  latencyMs: number,
  error?: string,
): void {
  const entry = { ts: nowSeconds(), tool, upstream, ok, latencyMs }
  deps.recordCall(error === undefined ? entry : { ...entry, error: error.slice(0, 200) })
}

/**
 * Answer one `tools/call` request: resolve the tool, map the arguments, invoke
 * the upstream, and turn every failure into a JSON-RPC error.
 * @param deps - handler dependencies.
 * @param config - live gateway configuration.
 * @param clientId - naming mode the endpoint serves.
 * @param toolset - resolved toolset the endpoint serves.
 * @param params - the request's `params` object.
 * @param id - JSON-RPC request id (echoed back).
 * @returns status plus JSON-RPC body.
 */
async function handleToolCall(
  deps: McpHandlerDeps,
  config: GatewayConfig,
  clientId: string,
  toolset: string,
  params: JsonObject,
  id: unknown,
): Promise<HttpReply> {
  const rawName = params['name']
  if (rawName === undefined || rawName === null || rawName === '') {
    return rpcError(id, -32602, 'Missing required parameter: name')
  }
  const toolName = typeof rawName === 'string' ? rawName : String(rawName)
  const hit = findExposeEntry(config, toolName, clientId, toolset)
  if (hit === null) {
    return rpcError(id, -32601, `Tool not found: ${toolName}`)
  }
  const rawArguments = params['arguments']
  const argumentsValue = isJsonObject(rawArguments) ? rawArguments : {}

  const transformStarted = performance.now()
  let upstreamArgs: JsonObject
  try {
    upstreamArgs = paramTransformValue(argumentsValue, hit.entry)
  } catch (error) {
    if (!(error instanceof ParamError)) throw error
    recordCall(deps, toolName, hit.upstreamName, false, Math.floor(performance.now() - transformStarted), messageOf(error))
    return rpcError(id, -32602, messageOf(error))
  }

  const transport = deps.transport(hit.upstreamName)
  if (transport === undefined) {
    return rpcError(id, -32000, `[gateway] upstream=${hit.upstreamName}: no transport`)
  }

  const startedAt = performance.now()
  try {
    const result = await transport.callTool(hit.entry.tool, upstreamArgs)
    const latencyMs = Math.floor(performance.now() - startedAt)
    deps.logger.info(`tools/call ${toolName} -> upstream ${hit.upstreamName}/${hit.entry.tool}`)
    recordCall(deps, toolName, hit.upstreamName, true, latencyMs)
    return rpcResult(id, result)
  } catch (error) {
    const latencyMs = Math.floor(performance.now() - startedAt)
    if (error instanceof UpstreamHttpError) {
      if (error.status === 401 || error.status === 403 || error.status === 429) {
        deps.onUpstreamStatus?.(hit.upstreamName, error.status)
      }
      recordCall(deps, toolName, hit.upstreamName, false, latencyMs, `HTTP ${error.status}`)
      return rpcError(id, -32000, `[gateway] upstream=${hit.upstreamName}: HTTP ${error.status}`)
    }
    const message = messageOf(error)
    deps.logger.error(`Upstream '${hit.upstreamName}' call_tool error: ${message}`)
    recordCall(deps, toolName, hit.upstreamName, false, latencyMs, message)
    return rpcError(id, -32000, `[gateway] upstream=${hit.upstreamName}: ${message}`)
  }
}

/**
 * Answer one MCP JSON-RPC request.
 * @param deps - handler dependencies.
 * @param ctx - routed request context.
 * @returns status plus JSON-RPC response body, or the HTTP-layer 404 shapes for
 * an unknown toolset / a disabled client naming mode.
 */
export async function handleMcpRequest(deps: McpHandlerDeps, ctx: McpRequestContext): Promise<HttpReply> {
  const config = deps.config()

  // Per-client disable guard: config.clients.{id} == false => 404.
  if (config.clients?.[ctx.clientId] === false) {
    return { status: 404, body: { error: `client '${ctx.clientId}' endpoint disabled` } }
  }

  // The legacy `/mcp` alias carries no toolset segment; it serves the default.
  const rawToolset = ctx.rawToolset === '' ? config.serverName : ctx.rawToolset
  const toolset = resolveToolset(config, rawToolset)
  if (toolset === null) {
    return { status: 404, body: { error: `Unknown toolset: ${rawToolset}` } }
  }

  const body = ctx.body
  if (!isJsonObject(body)) {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
      },
    }
  }
  const id = body['id'] ?? null
  const params = isJsonObject(body['params']) ? body['params'] : {}
  const method = body['method']

  // MCP initialize handshake. The endpoint is stateless, so this only
  // advertises capabilities; the client proceeds on its own session.
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: `mcpp/${toolset}`, version: SERVER_VERSION },
    })
  }

  // The handshake notification has no id and expects no JSON-RPC response; 202
  // with an empty body is what the retired service answered.
  if (method === 'notifications/initialized') {
    return { status: 202, body: {} }
  }

  if (method === 'tools/list') {
    const tools = await fetchAllTools(deps, config, ctx.clientId, toolset)
    return rpcResult(id, { tools })
  }

  if (method === 'tools/call') {
    return handleToolCall(deps, config, ctx.clientId, toolset, params, id)
  }

  if (method === 'server/discover') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: toolset, version: SERVER_VERSION },
      capabilities: { tools: {} },
    })
  }

  return rpcError(id, -32601, `Unknown method: ${String(method)}`)
}
