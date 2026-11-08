/**
 * The `ctx.mcpp` host service: the programmatic face of the gateway for other
 * plugins. This is the "other plugins can integrate these tools" seam — it is
 * independent of which tools the user happens to register for the main agent,
 * so a plugin can call any exposed tool without touching the selection.
 *
 * Consumers reach it through Cordis: `inject: ['mcpp']` or `ctx.get('mcpp')`.
 *
 * @module
 */

import { resolveEnvValue } from './config.ts'
import { getFormat } from './presets.ts'
import { displayName, paramTransformValue } from './transform.ts'
import type { ExposeEntry, GatewayRuntime, JsonObject } from './types.ts'

/**
 * Resolve a client-facing (`mcp__<toolset>__<tool>`), display, or stable-key
 * name to its expose entry. The gateway's own resolver needs a known toolset
 * because an MCP request arrives on a toolset-specific endpoint; the service is
 * called out of band, so it matches across every toolset instead.
 * @param runtime - live runtime.
 * @param name - caller-supplied tool name.
 * @returns the entry and its upstream, or null.
 */
function resolveExposedTool(
  runtime: GatewayRuntime,
  name: string,
): { entry: ExposeEntry; upstreamName: string } | null {
  const config = runtime.config
  const format = getFormat('claude')
  for (const [key, entry] of Object.entries(config.expose)) {
    if (entry.hide) continue
    const toolset = entry.toolset ?? config.serverName
    const publicName = format.formatName(toolset, displayName(entry, key))
    if (name === publicName || name === key || name === displayName(entry, key)) {
      return { entry, upstreamName: entry.upstream }
    }
  }
  return null
}

/** One exposed tool as the catalog reports it. */
export interface McppToolInfo {
  /** Stable `upstream/tool` key (the selection identity). */
  key: string
  /** Public DSH-facing name, `mcp__<toolset>__<tool>`. */
  name: string
  /** Aggregated server the tool belongs to. */
  toolset: string
  /** Downstream description. */
  description: string
  /** Whether the user registered it for the main agent. */
  enabled: boolean
  /** Whether it is actually live in the DSH tool registry right now. */
  registered: boolean
}

/** One aggregated server and its tools. */
export interface McppToolsetInfo {
  name: string
  /** Whether this is the default toolset (`server_name`). */
  default: boolean
  tools: McppToolInfo[]
}

/** Catalog snapshot for other plugins and the settings page. */
export interface McppCatalog {
  /** Configured default aggregated-server name. */
  serverName: string
  toolsets: McppToolsetInfo[]
  /** Upstream names with their transport kind. */
  upstreams: { name: string; transport: 'http' | 'stdio' }[]
}

/** The service published as `ctx.mcpp`. */
export interface McppService {
  /** Current tool catalog with selection and registration state. */
  catalog(): Promise<McppCatalog>
  /**
   * Invoke one exposed tool by its client-facing name, display name, or stable
   * key. Arguments are mapped through the same transforms the MCP endpoint uses.
   * @param name - tool name as the model or a plugin sees it.
   * @param args - downstream arguments.
   * @param signal - optional cancellation; checked before the upstream call.
   * @returns the upstream JSON-RPC `result` object.
   * @throws when the tool is unknown or the upstream call fails.
   */
  call(name: string, args?: JsonObject, signal?: AbortSignal): Promise<JsonObject>
  /** Configured upstream names. */
  upstreams(): string[]
  /** Aggregated server names (including the default one). */
  toolsets(): string[]
}

/** Dependencies of the service. */
export interface McppServiceDeps {
  runtime: GatewayRuntime
  /** Enabled stable keys from the selection document. */
  enabledKeys(): Promise<string[]>
  /** Names currently registered in the DSH tool registry. */
  registeredNames(): string[]
}

/**
 * Build the catalog from the live configuration.
 * @param runtime - live gateway runtime.
 * @param enabled - enabled stable keys.
 * @param registered - names live in the DSH registry.
 * @returns the catalog snapshot.
 */
export function buildCatalog(runtime: GatewayRuntime, enabled: readonly string[], registered: readonly string[]): McppCatalog {
  const config = runtime.config
  const format = getFormat('claude')
  const enabledSet = new Set(enabled)
  const registeredSet = new Set(registered)
  const toolsets = new Map<string, McppToolsetInfo>()
  toolsets.set(config.serverName, { name: config.serverName, default: true, tools: [] })
  for (const [key, entry] of Object.entries(config.expose)) {
    if (entry.hide) continue
    const toolset = entry.toolset ?? config.serverName
    const group = toolsets.get(toolset) ?? { name: toolset, default: false, tools: [] }
    toolsets.set(toolset, group)
    const name = format.formatName(toolset, displayName(entry, key))
    group.tools.push({
      key,
      name,
      toolset,
      description: entry.description ?? '',
      enabled: enabledSet.has(key),
      registered: registeredSet.has(name),
    })
  }
  return {
    serverName: config.serverName,
    toolsets: [...toolsets.values()],
    upstreams: config.upstreams.map((upstream) => ({ name: upstream.name, transport: upstream.transport })),
  }
}

/**
 * Create the `ctx.mcpp` service.
 * @param deps - runtime, selection lookup, and live registration view.
 * @returns the service value.
 */
export function createMcppService(deps: McppServiceDeps): McppService {
  const { runtime } = deps
  return {
    async catalog() {
      return buildCatalog(runtime, await deps.enabledKeys(), deps.registeredNames())
    },

    async call(name, args = {}, signal) {
      if (signal?.aborted === true) throw new Error('[mcpp] the call was canceled before dispatch')
      const found = resolveExposedTool(runtime, name)
      if (found === null) throw new Error(`[mcpp] unknown tool: ${name}`)
      const transport = runtime.upstreams.get(found.upstreamName)
      if (transport === undefined) throw new Error(`[mcpp] upstream '${found.upstreamName}' is not configured`)
      const upstreamArgs = paramTransformValue(args, found.entry)
      return await transport.callTool(found.entry.tool, upstreamArgs)
    },

    upstreams() {
      return runtime.config.upstreams.map((upstream) => upstream.name)
    },

    toolsets() {
      const names = new Set<string>([runtime.config.serverName])
      for (const entry of Object.values(runtime.config.expose)) names.add(entry.toolset ?? runtime.config.serverName)
      return [...names]
    },
  }
}

/**
 * Resolve the gateway token for the admin page's connect templates.
 * @param runtime - live gateway runtime.
 * @param env - environment for `${VAR}` resolution.
 * @returns the token, or the empty string when auth is open.
 */
export function gatewayToken(runtime: GatewayRuntime, env: NodeJS.ProcessEnv = process.env): string {
  const configured = runtime.config.auth?.token
  return configured === undefined ? '' : resolveEnvValue(configured, env)
}
