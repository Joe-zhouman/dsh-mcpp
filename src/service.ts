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
import { collectNativeToolSpecs, type NativeToolSpec } from './native-tools.ts'
import { getFormat } from './presets.ts'
import { displayName, paramTransformValue } from './transform.ts'
import type { ExposeEntry, GatewayRuntime, JsonObject, Tool } from './types.ts'

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

/**
 * Names a {@link McppService.specs} call selects from. A spec is selected when
 * it satisfies every list that is present; an excluded spec is dropped even
 * when the include lists selected it.
 */
export interface McppToolFilter {
  /**
   * Tool names to include, in any of the three spellings the gateway knows:
   * the public name (`mcp__search__searxng`), the display name (`searxng`), or
   * the stable key (`search/searxng_search`).
   */
  tools?: string[]
  /** Aggregated server names; a spec is selected when its toolset is one of them. */
  toolsets?: string[]
  /** Tool names to drop, using the same three spellings as {@link tools}. */
  exclude?: string[]
}

/** One registrable native tool and the deadline its upstream policy implies. */
export interface McppToolSpec {
  /** The tool to register into the calling scope. */
  spec: NativeToolSpec
  /** Per-call deadline in milliseconds; undefined when the upstream is not configured. */
  timeoutMs: number | undefined
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
  /**
   * Collect the exposed tools a preset-scoped surface should register. The
   * filter is conjunctive and an empty include filter selects nothing, so a row
   * that names no tool can never inherit the whole catalog.
   * @param filter - names and toolsets to include, plus names to exclude.
   * @returns the selected tools with their upstream deadlines, in expose order.
   * @throws when an explicitly named tool or toolset matches no exposed tool.
   */
  specs(filter?: McppToolFilter): Promise<McppToolSpec[]>
  /**
   * Invoke one upstream tool whose arguments are already mapped for the
   * upstream. Unlike {@link call} there is no name resolution and no parameter
   * transform: the caller owns both.
   * @param upstreamName - configured upstream to call.
   * @param tool - upstream tool name.
   * @param args - upstream arguments.
   * @param signal - optional cancellation; checked before dispatch.
   * @returns the upstream JSON-RPC `result` object.
   * @throws when the upstream is not configured or the call fails.
   */
  invoke(upstreamName: string, tool: string, args: JsonObject, signal?: AbortSignal): Promise<JsonObject>
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
  /**
   * Raw upstream tool lists used to build native specs. The host serves its
   * most recent sync snapshot and falls back to a live fetch.
   */
  rawTools(): Promise<Map<string, Tool[]>>
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
 * Test one spec against a caller-supplied tool name. The gateway addresses a
 * tool by its public name, its display name, or its stable key; a preset row
 * may use any of the three.
 * @param spec - candidate tool.
 * @param name - caller-supplied name.
 * @returns whether the name identifies this spec.
 */
function matchesSpecName(spec: NativeToolSpec, name: string): boolean {
  return name === spec.publicName || name === spec.key || name === displayName(spec.entry, spec.key)
}

/**
 * Read the deadline a tool inherits from its upstream policy. The +15s margin
 * matches the native host surface, so a preset-scoped tool is not cut off
 * before its upstream answers.
 * @param runtime - live runtime.
 * @param upstreamName - upstream the tool calls.
 * @returns the deadline in milliseconds, or undefined for an unconfigured upstream.
 */
function deadlineFor(runtime: GatewayRuntime, upstreamName: string): number | undefined {
  const upstream = runtime.config.upstreams.find((candidate) => candidate.name === upstreamName)
  return upstream === undefined ? undefined : (upstream.readTimeout + 15) * 1000
}

/**
 * Build the error for a filter naming tools or toolsets that no exposed tool
 * answers to.
 * @param unknownTools - tool names that matched nothing.
 * @param unknownToolsets - toolset names that matched nothing.
 * @returns the aggregated error.
 */
function noMatchError(unknownTools: readonly string[], unknownToolsets: readonly string[]): Error {
  const parts: string[] = []
  if (unknownTools.length > 0) parts.push(`tools ${unknownTools.map((name) => JSON.stringify(name)).join(', ')}`)
  if (unknownToolsets.length > 0) parts.push(`toolsets ${unknownToolsets.map((name) => JSON.stringify(name)).join(', ')}`)
  return new Error(`[mcpp] no exposed tool matches filter ${parts.join(' and ')}`)
}

/**
 * Create the `ctx.mcpp` service.
 * @param deps - runtime, selection lookup, live registration view, and raw tools.
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

    async specs(filter = {}) {
      const tools = filter.tools ?? []
      const toolsets = filter.toolsets ?? []
      const exclude = filter.exclude ?? []
      // An empty include filter means "nothing", never "everything": a preset
      // that forgot its filter must fail instead of inheriting the catalog.
      if (tools.length === 0 && toolsets.length === 0) return []

      const all = collectNativeToolSpecs(runtime.config, await deps.rawTools())
      const unknownTools = tools.filter((name) => !all.some((spec) => matchesSpecName(spec, name)))
      const unknownToolsets = toolsets.filter((name) => !all.some((spec) => spec.toolset === name))
      if (unknownTools.length > 0 || unknownToolsets.length > 0) throw noMatchError(unknownTools, unknownToolsets)

      const selected: McppToolSpec[] = []
      for (const spec of all) {
        if (tools.length > 0 && !tools.some((name) => matchesSpecName(spec, name))) continue
        if (toolsets.length > 0 && !toolsets.includes(spec.toolset)) continue
        if (exclude.some((name) => matchesSpecName(spec, name))) continue
        selected.push({ spec, timeoutMs: deadlineFor(runtime, spec.upstreamName) })
      }
      return selected
    },

    async invoke(upstreamName, tool, args, signal) {
      if (signal?.aborted === true) throw new Error('[mcpp] the call was canceled before dispatch')
      const transport = runtime.upstreams.get(upstreamName)
      if (transport === undefined) throw new Error(`[mcpp] upstream '${upstreamName}' is not configured`)
      return await transport.callTool(tool, args)
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
