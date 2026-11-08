/**
 * Native DSH tool surface: one `ToolDefinition` per selected aggregated tool,
 * registered globally on `ctx.tools` with the mcp-client-compatible public name
 * `mcp__<toolset>__<tool>`.
 *
 * This is the "no second MCP hop for dsh" path: `execute` maps the model
 * arguments through the expose transforms and calls the upstream transport
 * directly; the gateway's own HTTP listener stays for external MCP clients.
 *
 * Owner: native-tools. Contract: DESIGN.md § src/native-tools.ts.
 *
 * @module
 */

import { getFormat } from './presets.ts'
import { displayName, paramTransformValue, transformTools } from './transform.ts'
import type { DshToolDefinitionLike, DshToolRunContext, DshToolsService } from './dsh.ts'
import type { ExposeEntry, GatewayConfig, JsonObject, Logger, Tool } from './types.ts'

/** One tool the native surface can register. */
export interface NativeToolSpec {
  /** DSH public name, `mcp__<toolset>__<display>`. */
  publicName: string
  /** Stable expose key, `upstream/tool`. */
  key: string
  /** Aggregated server the tool belongs to. */
  toolset: string
  /** Downstream description (backtick references already expanded). */
  description: string
  /** Downstream input schema. */
  inputSchema?: JsonObject
  /** Upstream the call goes to. */
  upstreamName: string
  /** Expose entry carrying the parameter transforms. */
  entry: ExposeEntry
}

/** A registration that failed (usually a name conflict with another plugin). */
export interface NativeToolError {
  name: string
  message: string
}

/** Dependencies of the native surface. */
export interface NativeToolDeps {
  /** DSH tool registry. */
  tools: DshToolsService
  logger: Logger
  /**
   * Invoke one upstream tool with already-transformed arguments.
   * @param upstreamName - upstream to call.
   * @param tool - upstream tool name.
   * @param args - upstream arguments.
   * @param signal - owning tool call cancellation.
   * @returns the upstream JSON-RPC `result` object.
   */
  call(upstreamName: string, tool: string, args: JsonObject, signal: AbortSignal): Promise<JsonObject>
  /** Per-tool deadline in milliseconds; undefined means no deadline. */
  timeoutFor?(spec: NativeToolSpec): number | undefined
}

/** Live native tool generation. */
export interface NativeToolSet {
  /**
   * Replace the registered generation with `specs` (diff by public name).
   * @param specs - the full desired set of tools.
   * @returns the names registered and the per-tool registration failures.
   */
  sync(specs: NativeToolSpec[]): { registered: string[]; errors: NativeToolError[] }
  /** Unregister every tool this instance registered. */
  dispose(): void
  /** Names currently registered by this instance. */
  registeredNames(): string[]
  /** Registration failures from the last sync. */
  errors(): NativeToolError[]
}

/** Placeholder for a result that legitimately carried no model-visible content. */
const EMPTY_CONTENT = '(tool returned no model-visible content)'

/**
 * Narrow an unknown JSON value to a string-keyed object.
 * @param value - value to check.
 * @returns whether it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one field of a JSON object when it is a string.
 * @param record - object to read.
 * @param field - field name.
 * @returns the string value, or undefined for an absent/non-string field.
 */
function stringField(record: JsonObject, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Compact placeholder for a non-text media block. The mime type is shortened to
 * its subtype so `image/png` reads as `[image png]`, matching the diagnostic
 * the mcp-client bridge produces for blocks it cannot admit.
 * @param family - block family used as the placeholder label.
 * @param mimeType - declared media type, when the upstream sent one.
 * @returns the bracketed placeholder.
 */
function mediaPlaceholder(family: 'image' | 'audio', mimeType: string | undefined): string {
  const slash = mimeType?.indexOf('/') ?? -1
  const subtype = mimeType === undefined ? undefined : slash >= 0 ? mimeType.slice(slash + 1) : mimeType
  return `[${family} ${subtype ?? 'unknown'}]`
}

/**
 * Project one MCP content block to its model-visible text line.
 * @param block - raw block from the upstream result.
 * @returns the line, always defined.
 */
function blockText(block: unknown): string {
  if (!isRecord(block)) return '[unsupported MCP content block: expected an object]'
  const type = block['type']
  if (type === 'text') {
    // A text block without a string payload carries nothing model-visible.
    return stringField(block, 'text') ?? ''
  }
  if (type === 'image' || type === 'audio') return mediaPlaceholder(type, stringField(block, 'mimeType'))
  if (type === 'resource') return '[embedded resource]'
  if (type === 'resource_link') {
    const name = stringField(block, 'name')
    const uri = stringField(block, 'uri')
    return name !== undefined && uri !== undefined
      ? `Resource link: ${name} (${uri})`
      : '[resource link unavailable: the MCP block is missing its name or URI]'
  }
  return `[unsupported MCP content type: ${typeof type === 'string' ? type : 'unknown'}]`
}

/**
 * Project a canonical MCP result value to one model-visible string: text blocks
 * join by line, other block families become placeholders, and an empty result
 * becomes an explicit no-content marker.
 * @param value - canonical `{content, structuredContent?}` value.
 * @returns the projected text.
 */
function projectContentText(value: unknown): string {
  const content = isRecord(value) && Array.isArray(value['content']) ? value['content'] : []
  const lines: string[] = []
  for (const block of content) {
    const text = blockText(block)
    // Empty text blocks project nothing, exactly like a missing text field.
    if (text !== '') lines.push(text)
  }
  return lines.length === 0 ? EMPTY_CONTENT : lines.join('\n')
}

/**
 * The canonical output schema every native tool declares.
 * @returns a fresh JSON Schema value for `{content, structuredContent?}`.
 */
function outputSchema(): JsonObject {
  return {
    type: 'object',
    properties: {
      content: { type: 'array', items: {} },
      structuredContent: {},
    },
    required: ['content'],
    additionalProperties: false,
  }
}

/**
 * Argument schema for a tool whose upstream advertised no `inputSchema`.
 * @returns an empty JSON object schema.
 */
function emptyParameters(): JsonObject {
  return { type: 'object', properties: {} }
}

/**
 * Pure output projection: raw supported JSON value -> one model-visible text block.
 * @param _args - validated arguments (unused; projection depends on the value only).
 * @param value - validated canonical value.
 * @returns the single text content block.
 */
function renderOutput(_args: unknown, value: unknown): unknown[] {
  return [{ type: 'text', text: projectContentText(value) }]
}

/**
 * Render one thrown value as a registration error message.
 * @param error - thrown value.
 * @returns the error message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Serialize a JSON-ish value with object keys in sorted order, so equal content
 * yields an equal string regardless of construction order.
 * @param value - value to serialize.
 * @returns the canonical serialization.
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`
}

/**
 * Content identity of one desired registration. A changed identity means the old
 * definition must be disposed and the new one registered.
 * @param spec - desired tool spec.
 * @param timeoutMs - deadline the definition would carry.
 * @returns the stable identity string.
 */
function specHash(spec: NativeToolSpec, timeoutMs: number | undefined): string {
  return stableSerialize({
    name: spec.publicName,
    description: spec.description,
    schema: spec.inputSchema ?? null,
    key: spec.key,
    upstream: spec.upstreamName,
    tool: spec.entry.tool,
    timeoutMs: timeoutMs ?? null,
  })
}

/**
 * Collect every exposed tool of a configuration as a native spec.
 * @param config - gateway configuration.
 * @param upstreamTools - raw tool lists keyed by upstream name.
 * @returns one spec per non-hidden expose entry whose upstream tool is live.
 */
export function collectNativeToolSpecs(
  config: GatewayConfig,
  upstreamTools: Map<string, Tool[]>,
): NativeToolSpec[] {
  const format = getFormat('claude')
  const transformedByUpstream = new Map<string, Map<string, Tool>>()
  const specs: NativeToolSpec[] = []

  for (const [key, entry] of Object.entries(config.expose)) {
    if (entry.hide) continue
    let transformed = transformedByUpstream.get(entry.upstream)
    if (transformed === undefined) {
      const rawTools = upstreamTools.get(entry.upstream) ?? []
      transformed = new Map(
        transformTools(entry.upstream, rawTools, config, 'claude').map((tool) => [tool.name, tool]),
      )
      transformedByUpstream.set(entry.upstream, transformed)
    }
    const toolset = entry.toolset ?? config.serverName
    const publicName = format.formatName(toolset, displayName(entry, key))
    const source = transformed.get(publicName)
    // The upstream does not list this tool right now: nothing to register.
    if (source === undefined) continue
    const spec: NativeToolSpec = {
      publicName,
      key,
      toolset,
      description: source.description ?? '',
      upstreamName: entry.upstream,
      entry,
    }
    if (source.inputSchema !== undefined) spec.inputSchema = source.inputSchema
    specs.push(spec)
  }
  return specs
}

/**
 * Filter specs by their stable expose keys, the selection document's unit.
 * @param specs - candidate specs.
 * @param enabledKeys - stable `upstream/tool` keys that stay enabled.
 * @returns the specs whose key is enabled, in their original order.
 */
export function selectSpecs(
  specs: readonly NativeToolSpec[],
  enabledKeys: ReadonlySet<string> | readonly string[],
): NativeToolSpec[] {
  const enabled = new Set(enabledKeys)
  return specs.filter((spec) => enabled.has(spec.key))
}

/**
 * Build one DSH tool definition from a spec.
 * @param deps - call path and registry dependencies.
 * @param spec - desired tool.
 * @param timeoutMs - precomputed deadline; undefined omits the field.
 * @returns the definition to register.
 */
function buildDefinition(
  deps: NativeToolDeps,
  spec: NativeToolSpec,
  timeoutMs: number | undefined,
): DshToolDefinitionLike {
  const execute = async (args: unknown, exec: DshToolRunContext): Promise<unknown> => {
    // The model can answer with any JSON value; {} lets the upstream report a
    // missing mandatory parameter it owns the wording for.
    const rawArgs = isRecord(args) ? args : {}
    const upstreamArgs = paramTransformValue(rawArgs, spec.entry)
    const result = await deps.call(spec.upstreamName, spec.entry.tool, upstreamArgs, exec.signal)
    // MCP `isError` becomes a thrown error so the DSH executor records failure.
    if (result['isError'] === true) throw new Error(projectContentText(result))
    const content = result['content']
    const structuredContent = result['structuredContent']
    return {
      content: content === undefined ? [] : content,
      ...(structuredContent !== undefined ? { structuredContent } : {}),
    }
  }
  return {
    name: spec.publicName,
    description: spec.description,
    parameters: spec.inputSchema ?? emptyParameters(),
    output: { schema: outputSchema(), render: renderOutput },
    execute,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

/**
 * Create the native tool surface (nothing is registered until {@link NativeToolSet.sync}).
 *
 * Sync is a differential generation swap keyed by public name: unchanged names
 * keep their existing registration, vanished names are disposed, and changed or
 * new names are registered. A single failed registration is reported in
 * `errors` and never aborts the rest of the generation, so a foreign plugin
 * squatting on one name cannot take down the whole toolset.
 * @param deps - registry, call path, and deadline policy.
 * @returns the handle.
 */
export function createNativeToolSet(deps: NativeToolDeps): NativeToolSet {
  const live = new Map<string, { hash: string; dispose: () => void }>()
  let lastErrors: NativeToolError[] = []

  const retire = (name: string): void => {
    const registration = live.get(name)
    if (registration === undefined) return
    live.delete(name)
    try {
      registration.dispose()
    } catch (error) {
      // Disposal failure is reported but must not block the remaining tools.
      deps.logger.warn(`native-tools: disposing "${name}" failed: ${messageOf(error)}`)
    }
  }

  return {
    sync(specs: NativeToolSpec[]): { registered: string[]; errors: NativeToolError[] } {
      const desired = new Map<string, { spec: NativeToolSpec; hash: string; timeoutMs: number | undefined }>()
      for (const spec of specs) {
        const timeoutMs = deps.timeoutFor?.(spec)
        // A duplicate public name keeps the last spec; the name is the identity
        // the registry sees, so one registration is the only valid generation.
        desired.set(spec.publicName, { spec, hash: specHash(spec, timeoutMs), timeoutMs })
      }

      for (const name of [...live.keys()]) {
        if (!desired.has(name)) retire(name)
      }

      const errors: NativeToolError[] = []
      for (const [name, { spec, hash, timeoutMs }] of desired) {
        const registration = live.get(name)
        if (registration !== undefined && registration.hash === hash) continue
        if (registration !== undefined) retire(name)
        try {
          live.set(name, { hash, dispose: deps.tools.register(buildDefinition(deps, spec, timeoutMs)) })
        } catch (error) {
          const message = messageOf(error)
          errors.push({ name, message })
          deps.logger.warn(`native-tools: cannot register "${name}": ${message}`)
        }
      }
      lastErrors = errors
      return { registered: [...live.keys()], errors: [...errors] }
    },

    dispose(): void {
      for (const name of [...live.keys()]) retire(name)
      lastErrors = []
    },

    registeredNames(): string[] {
      return [...live.keys()]
    },

    errors(): NativeToolError[] {
      return [...lastErrors]
    },
  }
}
