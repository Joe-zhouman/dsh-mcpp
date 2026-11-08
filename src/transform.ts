/**
 * Downstream tool-surface transformation: display names, description
 * cross-references, input schemas, and argument mapping back to upstream
 * parameter names.
 *
 * Ported from the retired service's `transform.py`.
 *
 * Owner: config-transform. Contract: DESIGN.md § src/transform.ts.
 *
 * @module
 */

import { ParamError } from './errors.ts'
import { getFormat } from './presets.ts'
import type { ClientFormat, ExposeEntry, GatewayConfig, JsonObject, Tool } from './types.ts'

/** One backtick-quoted token from a description (`BACKTICK_REF` in the old model). */
const BACKTICK_REF = /`(\S+)`/g

/**
 * Narrow a JSON value to an object.
 * @param value - value to check.
 * @returns whether it is a non-array object.
 */
function isMapping(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a map has at least one key (a truthiness check on the old models).
 * @param map - map to inspect; absent maps are falsy.
 * @returns whether the map is present and non-empty.
 */
function hasKeys(map: Record<string, unknown> | undefined): map is Record<string, unknown> {
  return map !== undefined && map !== null && Object.keys(map).length > 0
}

/**
 * Format a rejected downstream value the way the old service's f-string did.
 * @param value - value the client sent.
 * @returns a bare rendering of the value.
 */
function renderValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
}

/**
 * Format an allowed-value list the way Python's `list(dict)` repr did.
 * @param values - allowed keys, in configured order.
 * @returns the bracketed, quoted list.
 */
function renderAllowed(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`
}

/**
 * Display name of one expose entry: `as` when set, else the key's last segment.
 * @param entry - expose entry.
 * @param key - stable `upstream/tool` key.
 * @returns the downstream display name.
 */
export function displayName(entry: ExposeEntry, key: string): string {
  return entry.as ?? key.slice(key.lastIndexOf('/') + 1)
}

/**
 * Build the downstream input schema for one expose entry.
 *
 * With `params === undefined` the upstream schema passes through unchanged.
 * Otherwise every visible transform contributes a property: the build starts
 * from a copy of the upstream property so constraints (enum, format, items,
 * minimum, …) survive; `type: enum`/`type: preset` replace `type` and `enum`.
 * A param with an explicit `required` overrides upstream optionality, otherwise
 * optionality is inherited from the upstream `required` list.
 * @param entry - expose entry carrying the transforms.
 * @param upstreamSchema - raw upstream `inputSchema`.
 * @returns the downstream schema, or undefined when both are absent.
 */
export function buildDownstreamSchema(
  entry: ExposeEntry,
  upstreamSchema?: JsonObject,
): JsonObject | undefined {
  if (entry.params === undefined) return upstreamSchema

  const upstream = upstreamSchema ?? {}
  const upstreamProps = isMapping(upstream['properties']) ? upstream['properties'] : {}
  const upstreamRequiredRaw = upstream['required']
  const upstreamRequired = Array.isArray(upstreamRequiredRaw)
    ? upstreamRequiredRaw.filter((name): name is string => typeof name === 'string')
    : []
  const properties: JsonObject = {}
  const required: string[] = []

  for (const param of entry.params) {
    if (param.hidden) continue
    const upstreamName = param.mapFrom ?? param.name
    const candidate = upstreamProps[upstreamName]
    const upstreamParam = isMapping(candidate) ? candidate : {}
    // Start from a copy of the upstream property so its constraints survive.
    const prop: JsonObject = Object.keys(upstreamParam).length === 0 ? { type: 'string' } : { ...upstreamParam }
    // A per-param description overrides the upstream's; empty falls back.
    const description = param.description || readDescription(upstreamParam)
    if (description) prop['description'] = description
    const enumKeys = param.mapping === undefined || param.mapping === null ? [] : Object.keys(param.mapping)
    const presetKeys = param.preset === undefined || param.preset === null ? [] : Object.keys(param.preset)
    if (param.type === 'enum' && enumKeys.length > 0) {
      prop['type'] = 'string'
      prop['enum'] = enumKeys
    } else if (param.type === 'preset' && presetKeys.length > 0) {
      prop['type'] = 'string'
      prop['enum'] = presetKeys
    }
    properties[param.name] = prop
    // Optionality: explicit `required` wins; otherwise inherit upstream.
    const isRequired = param.required ?? upstreamRequired.includes(upstreamName)
    if (isRequired) required.push(param.name)
  }

  const schema: JsonObject = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required
  return schema
}

/**
 * Read an upstream property's description when it is a string.
 * @param upstreamParam - upstream property schema.
 * @returns the description, or an empty string.
 */
function readDescription(upstreamParam: JsonObject): string {
  const description = upstreamParam['description']
  return typeof description === 'string' ? description : ''
}

/**
 * Map downstream arguments back to upstream parameter names.
 *
 * Hidden params inject their `default` upstream; omitted (undefined/null)
 * values are not sent so the upstream default applies; enum/preset values are
 * checked against the configured whitelist.
 * @param rawArgs - arguments exactly as the client sent them.
 * @param entry - expose entry carrying the transforms.
 * @returns upstream arguments.
 * @throws ParamError when an enum/preset value is not in the configured whitelist.
 */
export function paramTransformValue(rawArgs: JsonObject, entry: ExposeEntry): JsonObject {
  if (entry.params === undefined) return rawArgs

  const upstream: JsonObject = {}
  for (const param of entry.params) {
    const upstreamName = param.mapFrom ?? param.name
    if (param.hidden) {
      if (param.default !== undefined && param.default !== null) upstream[upstreamName] = param.default
      continue
    }
    const value = rawArgs[param.name]
    if (value === undefined || value === null) continue
    const mapping = param.mapping
    const preset = param.preset
    if (param.type === 'enum' && hasKeys(mapping)) {
      if (typeof value === 'string' && Object.hasOwn(mapping, value)) {
        upstream[upstreamName] = mapping[value]
      } else {
        throw new ParamError(
          `Invalid value '${renderValue(value)}' for enum param '${param.name}'. ` +
            `Valid: ${renderAllowed(Object.keys(mapping))}`,
        )
      }
    } else if (param.type === 'preset' && hasKeys(preset)) {
      if (typeof value === 'string' && Object.hasOwn(preset, value)) {
        Object.assign(upstream, preset[value])
      } else {
        throw new ParamError(
          `Invalid value '${renderValue(value)}' for preset param '${param.name}'. ` +
            `Valid: ${renderAllowed(Object.keys(preset))}`,
        )
      }
    } else {
      upstream[upstreamName] = value
    }
  }
  return upstream
}

/**
 * Expand `` `upstream/tool` `` backtick refs to the name the client sees.
 *
 * Each ref expands through the same per-client naming format as the tool's own
 * name; refs that do not name an expose key are left verbatim.
 * @param description - description text.
 * @param refs - stable key to `[toolset, display name]`.
 * @param format - naming strategy for the client.
 * @returns the description with refs expanded.
 */
function resolveBackticks(
  description: string,
  refs: ReadonlyMap<string, readonly [string, string]>,
  format: ClientFormat,
): string {
  return description.replace(BACKTICK_REF, (match, ref: string) => {
    const hit = refs.get(ref)
    if (hit === undefined) return match
    return `\`${format.formatName(hit[0], hit[1])}\``
  })
}

/**
 * Composite map key for one `(upstream, tool)` pair.
 * @param upstreamName - upstream name.
 * @param toolName - upstream tool name.
 * @returns the composite key.
 */
function upstreamToolKey(upstreamName: string, toolName: string): string {
  return `${upstreamName}\u0000${toolName}`
}

/**
 * Transform one upstream's raw tools into the downstream surface for one
 * client naming mode and one toolset.
 *
 * Tools whose `(upstream, tool)` pair is not exposed, or whose entry is hidden,
 * are dropped; `toolset` filters to one aggregated server. Only `name`,
 * `description`, and `inputSchema` are emitted, as the old service did.
 * @param upstreamName - upstream these tools came from.
 * @param tools - raw upstream tools.
 * @param config - gateway configuration (expose table, server name).
 * @param client - naming mode id; defaults to `default`.
 * @param toolset - when set, keep only tools of that aggregated server.
 * @returns transformed tools in upstream order.
 */
export function transformTools(
  upstreamName: string,
  tools: Tool[],
  config: GatewayConfig,
  client = 'default',
  toolset?: string,
): Tool[] {
  const byUpstreamTool = new Map<string, readonly [string, ExposeEntry]>()
  const displayNames = new Map<string, string>()
  const refs = new Map<string, readonly [string, string]>()
  for (const [key, entry] of Object.entries(config.expose)) {
    const name = displayName(entry, key)
    byUpstreamTool.set(upstreamToolKey(entry.upstream, entry.tool), [key, entry])
    displayNames.set(key, name)
    refs.set(key, [entry.toolset ?? config.serverName, name])
  }
  const format = getFormat(client)
  const result: Tool[] = []

  for (const tool of tools) {
    const lookup = byUpstreamTool.get(upstreamToolKey(upstreamName, tool.name))
    if (lookup === undefined) continue
    const [key, entry] = lookup
    if (entry.hide) continue
    const resolvedToolset = entry.toolset ?? config.serverName
    if (toolset !== undefined && resolvedToolset !== toolset) continue
    const name = displayNames.get(key) ?? tool.name
    const description = resolveBackticks(entry.description ?? tool.description ?? '', refs, format)
    const inputSchema = buildDownstreamSchema(entry, tool.inputSchema)
    result.push({ name: format.formatName(resolvedToolset, name), description, inputSchema })
  }
  return result
}
