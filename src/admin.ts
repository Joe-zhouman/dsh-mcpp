/**
 * Admin API layer: the `/api/*` management surface the ported admin page and
 * the service owner use to inspect and edit the live configuration.
 *
 * Owner: gateway-admin. Contract: DESIGN.md § src/admin.ts and the retired
 * service's `main.py:682-1223`.
 *
 * Every mutation is staged first: the candidate configuration is serialized and
 * re-parsed (the same validation a restart performs) before it is handed to
 * `persistConfig`. A rejected edit therefore never reaches the live object.
 *
 * @module
 */

import { dumpConfig, parseConfig } from './config.ts'
import { ConfigError } from './errors.ts'
import { fetchAllTools } from './gateway.ts'
import { presets } from './presets.ts'
import type {
  AdminDeps,
  ExposeEntry,
  GatewayConfig,
  HttpReply,
  JsonObject,
  ParamTransform,
  Tool,
  UpstreamConfig,
} from './types.ts'

/** One inbound admin request, already split into route segments. */
export interface AdminRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path segments after `/api`, percent-decoded; empty for `/api`. */
  segments: string[]
  query: URLSearchParams
  /** Raw request body text (empty for GET/DELETE). */
  bodyText(): Promise<string>
  /** Parsed JSON body.
   * @throws when the body is not valid JSON (the caller maps that to 400). */
  bodyJson(): Promise<unknown>
}

/** Timeout marker for an admin-initiated `tools/list` probe. */
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
 * @param seconds - cap in seconds.
 * @returns the operation's value.
 * @throws ListTimeoutError when the cap expires first.
 */
function withTimeout<T>(promise: Promise<T>, seconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ListTimeoutError(`timed out after ${seconds}s`)) }, seconds * 1000)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** A 404 with the retired service's unknown-referent wording. */
function notFound(message = 'Not Found'): HttpReply {
  return { status: 404, body: { error: message } }
}

/** A 400 with the retired service's `{error}` body. */
function badRequest(message: string): HttpReply {
  return { status: 400, body: { error: message } }
}

/**
 * Read a JSON object body, or undefined when it is not one.
 * @param request - inbound request.
 * @returns the parsed object, or undefined for null/array/scalar bodies.
 */
async function jsonObjectBody(request: AdminRequest): Promise<JsonObject | undefined> {
  const body = await request.bodyJson()
  return isJsonObject(body) ? body : undefined
}

/**
 * Find one upstream by name.
 * @param config - gateway configuration.
 * @param name - upstream name.
 * @returns the upstream, or undefined when absent.
 */
function findUpstream(config: GatewayConfig, name: string): UpstreamConfig | undefined {
  return config.upstreams.find((upstream) => upstream.name === name)
}

/**
 * Copy a configuration with one upstream replaced.
 * @param config - source configuration.
 * @param index - index of the upstream to replace.
 * @param upstream - replacement upstream.
 * @returns a new configuration object.
 */
function withUpstream(config: GatewayConfig, index: number, upstream: UpstreamConfig): GatewayConfig {
  const upstreams = config.upstreams.map((existing, at) => (at === index ? upstream : existing))
  return { ...config, upstreams }
}

/**
 * Copy a configuration with one expose entry written or deleted.
 * @param config - source configuration.
 * @param key - stable `upstream/tool` key.
 * @param entry - replacement entry, or null to delete.
 * @returns a new configuration object.
 */
function withExposeEntry(config: GatewayConfig, key: string, entry: ExposeEntry | null): GatewayConfig {
  const expose: Record<string, ExposeEntry> = { ...config.expose }
  if (entry === null) delete expose[key]
  else expose[key] = entry
  return { ...config, expose }
}

/**
 * Validate a candidate configuration the way a restart would.
 * @param staged - candidate configuration.
 * @returns the validation message, or undefined when valid.
 */
function validateStaged(staged: GatewayConfig): string | undefined {
  try {
    parseConfig(dumpConfig(staged))
    return undefined
  } catch (error) {
    return messageOf(error)
  }
}

/**
 * Validate a staged configuration and, when it passes, persist it.
 * @param deps - admin dependencies.
 * @param staged - candidate configuration.
 * @param success - reply body on success.
 * @returns the success reply, or a 400 carrying the validation message.
 */
async function persistStaged(deps: AdminDeps, staged: GatewayConfig, success: HttpReply): Promise<HttpReply> {
  const invalid = validateStaged(staged)
  if (invalid !== undefined) return { status: 400, body: { error: invalid } }
  await deps.persistConfig(staged)
  return success
}

/** One upstream parameter row of the expose-editor payload. */
type ParamRow = JsonObject

/**
 * Merge an expose entry's param transforms with the upstream tool's schema.
 *
 * Emits one row per upstream parameter (plus any transform whose upstream
 * parameter disappeared, kept so edits are not lost). Each row carries the
 * editable transform fields plus the read-only upstream context the admin page
 * renders: `_upstream_name`, `_upstream_type`, `_upstream_description`, and
 * `_required`.
 * @param entry - expose entry.
 * @param upstreamSchema - raw upstream `inputSchema`.
 * @returns one row per parameter.
 */
function mergeParams(entry: ExposeEntry, upstreamSchema?: JsonObject): ParamRow[] {
  const schema = upstreamSchema ?? {}
  const properties = isJsonObject(schema['properties']) ? schema['properties'] : {}
  const requiredRaw = schema['required']
  const requiredNames: unknown[] = Array.isArray(requiredRaw) ? requiredRaw : []

  const byUpstream = new Map<string, ParamTransform>()
  for (const param of entry.params ?? []) {
    byUpstream.set(param.mapFrom ?? param.name, param)
  }

  const rows: ParamRow[] = []
  const seen = new Set<string>()
  for (const [upstreamName, upstreamProperty] of Object.entries(properties)) {
    seen.add(upstreamName)
    const property = isJsonObject(upstreamProperty) ? upstreamProperty : {}
    const upstreamType = property['type'] ?? null
    const upstreamDescription = 'description' in property ? property['description'] ?? null : ''
    const param = byUpstream.get(upstreamName)
    if (param === undefined) {
      // A not-yet-transformed upstream parameter: bind map_from explicitly so
      // editing the downstream name cannot re-pair it with a different one.
      rows.push({
        name: upstreamName,
        map_from: upstreamName,
        hidden: false,
        default: null,
        type: null,
        mapping: null,
        preset: null,
        description: null,
        required: null,
        _upstream_name: upstreamName,
        _upstream_type: upstreamType,
        _upstream_description: upstreamDescription,
        _required: requiredNames.includes(upstreamName),
      })
      continue
    }
    rows.push({
      name: param.name,
      map_from: param.mapFrom ?? null,
      hidden: param.hidden,
      default: param.default ?? null,
      type: param.type ?? null,
      mapping: param.mapping ?? null,
      preset: param.preset ?? null,
      description: param.description ?? null,
      required: param.required ?? null,
      _upstream_name: upstreamName,
      _upstream_type: upstreamType,
      _upstream_description: upstreamDescription,
      _required: requiredNames.includes(upstreamName),
    })
  }

  // Preserve transforms whose upstream parameter no longer exists (orphaned).
  for (const [upstreamName, param] of byUpstream) {
    if (seen.has(upstreamName)) continue
    rows.push({
      name: param.name,
      map_from: param.mapFrom ?? null,
      hidden: param.hidden,
      default: param.default ?? null,
      type: param.type ?? null,
      mapping: param.mapping ?? null,
      preset: param.preset ?? null,
      description: param.description ?? null,
      required: param.required ?? null,
      _upstream_name: upstreamName,
      _upstream_type: null,
      _upstream_description: '',
      _required: false,
    })
  }
  return rows
}

/** Raw upstream tool lookup keyed by upstream name then tool name. */
type RawToolIndex = Map<string, Map<string, Tool>>

/**
 * Fetch every upstream's raw (untransformed) tools for schema merging.
 * Upstream failures are logged and skipped, matching the retired service.
 * @param deps - admin dependencies.
 * @param config - live gateway configuration.
 * @returns upstream name -> tool name -> raw tool.
 */
async function fetchAllRawTools(deps: AdminDeps, config: GatewayConfig): Promise<RawToolIndex> {
  const perUpstream = await Promise.all(
    config.upstreams.map(async (upstream): Promise<[string, Map<string, Tool>]> => {
      const byName = new Map<string, Tool>()
      const transport = deps.transport(upstream.name)
      if (transport === undefined) return [upstream.name, byName]
      try {
        const tools = await withTimeout(transport.listTools(), 30)
        for (const tool of tools) byName.set(tool.name, tool)
      } catch (error) {
        deps.logger.warn(`raw fetch upstream '${upstream.name}' failed: ${messageOf(error)}`)
      }
      return [upstream.name, byName]
    }),
  )
  return new Map(perUpstream)
}

/**
 * Read an optional string field.
 * @param raw - JSON object.
 * @param field - field name.
 * @returns the string, or undefined for absent/null.
 * @throws Error when the field is present with a non-string value.
 */
function optionalString(raw: JsonObject, field: string): string | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

/**
 * Read an optional boolean field.
 * @param raw - JSON object.
 * @param field - field name.
 * @returns the boolean, or undefined for absent/null.
 * @throws Error when the field is present with a non-boolean value.
 */
function optionalBoolean(raw: JsonObject, field: string): boolean | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

/**
 * Read a boolean field with a default.
 * @param raw - JSON object.
 * @param field - field name.
 * @param fallback - value when the field is absent.
 * @returns the boolean.
 * @throws Error when the field is present with a non-boolean value.
 */
function booleanField(raw: JsonObject, field: string, fallback: boolean): boolean {
  const value = optionalBoolean(raw, field)
  return value === undefined ? fallback : value
}

/**
 * Build one validated param transform from a JSON object.
 * @param raw - one `params[]` element.
 * @param index - position in the list, for error messages.
 * @returns the typed transform.
 * @throws Error when a field has the wrong type.
 */
function buildParamTransform(raw: JsonObject, index: number): ParamTransform {
  const name = raw['name']
  if (typeof name !== 'string') {
    throw new Error(`params[${index}].name is required and must be a string`)
  }
  const param: ParamTransform = { name, hidden: booleanField(raw, 'hidden', false) }

  const mapFrom = optionalString(raw, 'map_from')
  if (mapFrom !== undefined) param.mapFrom = mapFrom
  const type = optionalString(raw, 'type')
  if (type !== undefined) {
    if (type !== 'enum' && type !== 'preset') {
      throw new Error(`params[${index}].type must be "enum" or "preset"`)
    }
    param.type = type
  }
  const mapping = raw['mapping']
  if (mapping !== undefined && mapping !== null) {
    if (!isJsonObject(mapping)) throw new Error(`params[${index}].mapping must be an object`)
    param.mapping = mapping
  }
  const preset = raw['preset']
  if (preset !== undefined && preset !== null) {
    if (!isJsonObject(preset)) throw new Error(`params[${index}].preset must be an object`)
    const normalized: Record<string, JsonObject> = {}
    for (const [presetName, presetValue] of Object.entries(preset)) {
      if (!isJsonObject(presetValue)) {
        throw new Error(`params[${index}].preset.${presetName} must be an object`)
      }
      normalized[presetName] = presetValue
    }
    param.preset = normalized
  }
  const description = optionalString(raw, 'description')
  if (description !== undefined) param.description = description
  const required = optionalBoolean(raw, 'required')
  if (required !== undefined) param.required = required
  if ('default' in raw) param.default = raw['default']
  return param
}

/**
 * Build one validated expose entry from a JSON body.
 *
 * `upstream`/`tool` are identity fields: they come from the existing entry, not
 * from the body, so this endpoint can never repoint an entry at another tool.
 * Read-only `_`-prefixed fields are dropped before this runs.
 * @param raw - editable request body.
 * @param identity - existing entry's upstream and tool.
 * @returns the typed entry.
 * @throws Error when a field has the wrong type.
 */
function buildExposeEntry(raw: JsonObject, identity: { upstream: string; tool: string }): ExposeEntry {
  const entry: ExposeEntry = {
    upstream: identity.upstream,
    tool: identity.tool,
    hide: booleanField(raw, 'hide', false),
  }
  const as = optionalString(raw, 'as')
  if (as !== undefined) entry.as = as
  const toolset = optionalString(raw, 'toolset')
  if (toolset !== undefined) entry.toolset = toolset
  const description = optionalString(raw, 'description')
  if (description !== undefined) entry.description = description
  const params = raw['params']
  if (params !== undefined && params !== null) {
    if (!Array.isArray(params)) throw new Error('params must be a list')
    entry.params = params.map((item, index) => {
      if (!isJsonObject(item)) throw new Error(`params[${index}] must be an object`)
      return buildParamTransform(item, index)
    })
  }
  return entry
}

/**
 * Parse one Claude-Desktop-style server spec into an upstream definition.
 *
 * `command` selects stdio, `url` selects http. The first usable `headers` entry
 * becomes the upstream's auth rotation pool: `Bearer <key>` is split into
 * scheme + key; transport noise headers are ignored.
 * @param name - server name from the input JSON.
 * @param spec - one server spec object.
 * @returns the upstream definition.
 * @throws Error when the spec has neither `command` nor `url`, or a field has
 * the wrong type.
 */
function parseClaudeDesktopEntry(name: string, spec: JsonObject): UpstreamConfig {
  const identity = {
    inheritEnv: ['PATH'],
    connectTimeout: 30,
    readTimeout: 120,
    listTimeout: 20,
  }
  let upstream: UpstreamConfig

  if ('command' in spec) {
    const command = spec['command']
    if (typeof command !== 'string') throw new Error(`server '${name}': command must be a string`)
    upstream = { name, transport: 'stdio', command, ...identity }
    const args = spec['args']
    if (args !== undefined && args !== null) {
      if (!Array.isArray(args)) throw new Error(`server '${name}': args must be a list of strings`)
      const values: string[] = []
      for (const value of args) {
        if (typeof value !== 'string') throw new Error(`server '${name}': args must be a list of strings`)
        values.push(value)
      }
      upstream.args = values
    }
    const env = spec['env']
    if (env !== undefined && env !== null) {
      if (!isJsonObject(env)) throw new Error(`server '${name}': env must be an object`)
      const values: Record<string, string> = {}
      for (const [key, value] of Object.entries(env)) {
        if (typeof value !== 'string') throw new Error(`server '${name}': env values must be strings`)
        values[key] = value
      }
      upstream.env = values
    }
  } else if ('url' in spec) {
    const url = spec['url']
    if (typeof url !== 'string') throw new Error(`server '${name}': url must be a string`)
    upstream = { name, transport: 'http', url, ...identity }
  } else {
    throw new Error(`server '${name}': spec must have 'command' or 'url'`)
  }

  const headers = spec['headers']
  if (headers !== undefined && headers !== null) {
    if (!isJsonObject(headers)) throw new Error(`server '${name}': headers must be an object`)
    const noise = new Set(['content-type', 'accept', 'user-agent', 'accept-encoding'])
    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (typeof headerValue !== 'string') continue
      if (noise.has(headerName.toLowerCase())) continue
      const bearer = headerValue.startsWith('Bearer ')
      const token = (bearer ? headerValue.slice('Bearer '.length) : headerValue).trim()
      if (token === '') continue
      upstream.auth = { keys: [token], header: headerName, scheme: bearer ? 'Bearer ' : '' }
      break
    }
  }
  return upstream
}

/**
 * Probe an upstream's tool names with a throwaway transport.
 * @param deps - admin dependencies.
 * @param upstream - upstream to probe.
 * @returns raw tool names.
 * @throws when the probe fails.
 */
async function probeTools(deps: AdminDeps, upstream: UpstreamConfig): Promise<string[]> {
  const transport = deps.createProbeTransport(upstream)
  try {
    const tools = await withTimeout(transport.listTools(), 30)
    return tools.map((tool) => tool.name)
  } finally {
    await transport.close()
  }
}

/** Read the `key_index` body field of the resume route. */
function readKeyIndex(body: unknown, fallback: number): number {
  if (!isJsonObject(body)) return fallback
  const value = body['key_index'] ?? fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('key_index must be an integer')
  }
  return value
}

/** Parse a `key_index` path segment. */
function parseKeyIndex(raw: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`key_index must be an integer, got '${raw}'`)
  return Number.parseInt(raw, 10)
}

/** `GET /api/config` — current configuration as YAML text. */
async function getConfigYaml(deps: AdminDeps): Promise<HttpReply> {
  return { status: 200, body: { yaml: dumpConfig(deps.config()) } }
}

/** `POST /api/config` — replace the whole configuration from YAML text. */
async function replaceConfig(deps: AdminDeps, request: AdminRequest): Promise<HttpReply> {
  const text = await request.bodyText()
  let next: GatewayConfig
  try {
    next = parseConfig(text)
  } catch (error) {
    return badRequest(messageOf(error))
  }
  await deps.persistConfig(next)
  return { status: 200, body: { status: 'reloaded' } }
}

/** `GET /api/tools` — preview the downstream tool surface. */
async function listToolsPreview(deps: AdminDeps, request: AdminRequest): Promise<HttpReply> {
  const config = deps.config()
  let toolset = request.query.get('toolset') ?? undefined
  if (toolset === 'mcpp') toolset = config.serverName
  const client = request.query.get('client') ?? 'default'
  const tools = await fetchAllTools(deps, config, client, toolset)
  return { status: 200, body: tools }
}

/** `GET /api/upstreams` — configured upstream names. */
async function listUpstreamNames(deps: AdminDeps): Promise<HttpReply> {
  return { status: 200, body: deps.config().upstreams.map((upstream) => upstream.name) }
}

/** `GET /api/upstreams/{name}` — identity plus editable env fields. */
async function getUpstream(deps: AdminDeps, name: string): Promise<HttpReply> {
  const upstream = findUpstream(deps.config(), name)
  if (upstream === undefined) return notFound(`Unknown upstream: ${name}`)
  return {
    status: 200,
    body: {
      name: upstream.name,
      transport: upstream.transport,
      env: upstream.env ?? null,
      inherit_env: upstream.transport === 'stdio' ? upstream.inheritEnv : null,
    },
  }
}

/** `PUT /api/upstreams/{name}` — edit only env and inherit_env. */
async function putUpstream(deps: AdminDeps, request: AdminRequest, name: string): Promise<HttpReply> {
  const config = deps.config()
  const index = config.upstreams.findIndex((upstream) => upstream.name === name)
  if (index === -1) return notFound(`Unknown upstream: ${name}`)
  const body = await jsonObjectBody(request)
  if (body === undefined) return badRequest('body must be a JSON object')

  const existing = config.upstreams[index]!
  const next: UpstreamConfig = { ...existing }

  if ('env' in body) {
    const envValue = body['env']
    if (envValue !== undefined && envValue !== null && !isJsonObject(envValue)) {
      return badRequest('env must be an object or null')
    }
    if (isJsonObject(envValue)) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(envValue)) {
        if (typeof value !== 'string') return badRequest('env keys and values must be strings')
        env[key] = value
      }
      next.env = env
    } else {
      delete next.env
    }
  }

  if ('inherit_env' in body) {
    const inheritValue = body['inherit_env']
    const list = inheritValue === undefined || inheritValue === null ? [] : inheritValue
    if (!Array.isArray(list)) return badRequest('inherit_env must be a list of strings')
    const values: string[] = []
    for (const value of list) {
      if (typeof value !== 'string') return badRequest('inherit_env must be a list of strings')
      values.push(value)
    }
    next.inheritEnv = values
  }

  const staged = withUpstream(config, index, next)
  return persistStaged(deps, staged, { status: 200, body: { status: 'saved', name } })
}

/** `GET /api/upstreams/{name}/tools` — raw upstream tools, untransformed. */
async function rawUpstreamTools(deps: AdminDeps, name: string): Promise<HttpReply> {
  const transport = deps.transport(name)
  if (transport === undefined) return notFound(`Unknown upstream: ${name}`)
  try {
    const tools = await withTimeout(transport.listTools(), 30)
    return {
      status: 200,
      body: {
        upstream: name,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
        })),
      },
    }
  } catch (error) {
    return { status: 502, body: { error: messageOf(error) } }
  }
}

/** `POST /api/upstreams/{name}/test` — connectivity probe with raw tool names. */
async function testUpstream(deps: AdminDeps, name: string): Promise<HttpReply> {
  const transport = deps.transport(name)
  if (transport === undefined) return notFound(`Unknown upstream: ${name}`)
  const startedAt = performance.now()
  try {
    const tools = await withTimeout(transport.listTools(), 30)
    return {
      status: 200,
      body: {
        ok: true,
        latency_ms: Math.floor(performance.now() - startedAt),
        tool_count: tools.length,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? null })),
        error: null,
      },
    }
  } catch (error) {
    const message = messageOf(error)
    deps.logger.warn(`Test upstream '${name}' failed: ${message}`)
    return {
      status: 200,
      body: {
        ok: false,
        latency_ms: Math.floor(performance.now() - startedAt),
        tool_count: 0,
        tools: [],
        error: message,
      },
    }
  }
}

/** `GET /api/toolsets` — aggregated servers and their member tool keys. */
async function listToolsets(deps: AdminDeps): Promise<HttpReply> {
  const config = deps.config()
  const groups = new Map<string, string[]>([[config.serverName, []]])
  for (const [key, entry] of Object.entries(config.expose)) {
    if (entry.hide) continue
    const name = entry.toolset ?? config.serverName
    const members = groups.get(name)
    if (members === undefined) groups.set(name, [key])
    else members.push(key)
  }
  return {
    status: 200,
    body: [...groups].map(([toolset, tools]) => ({
      toolset,
      tools,
      default: toolset === config.serverName,
    })),
  }
}

/** `GET /api/expose` — expose entries with the upstream schema merged in. */
async function listExpose(deps: AdminDeps): Promise<HttpReply> {
  const config = deps.config()
  const raw = await fetchAllRawTools(deps, config)
  const out: JsonObject[] = []
  for (const [key, entry] of Object.entries(config.expose)) {
    const upstreamTool = raw.get(entry.upstream)?.get(entry.tool)
    out.push({
      key,
      upstream: entry.upstream,
      tool: entry.tool,
      as: entry.as ?? null,
      toolset: entry.toolset ?? config.serverName,
      hide: entry.hide,
      description: entry.description ?? null,
      raw_description: upstreamTool?.description ?? null,
      params: mergeParams(entry, upstreamTool?.inputSchema),
    })
  }
  return { status: 200, body: out }
}

/** `PUT /api/expose/{key}` — replace one expose entry's editable fields. */
async function putExpose(deps: AdminDeps, request: AdminRequest, key: string): Promise<HttpReply> {
  const config = deps.config()
  const existing = config.expose[key]
  if (existing === undefined) return notFound(`Unknown expose key: ${key}`)
  const body = await jsonObjectBody(request)
  if (body === undefined) return badRequest('body must be a JSON object')

  // Drop client-only read-only fields the GET emits (prefixed `_`).
  const editable: JsonObject = {}
  for (const [field, value] of Object.entries(body)) {
    if (field.startsWith('_')) continue
    editable[field] = value
  }

  let entry: ExposeEntry
  try {
    entry = buildExposeEntry(editable, { upstream: existing.upstream, tool: existing.tool })
  } catch (error) {
    return badRequest(messageOf(error))
  }
  const staged = withExposeEntry(config, key, entry)
  return persistStaged(deps, staged, { status: 200, body: { status: 'saved', key } })
}

/** `DELETE /api/expose/{key}` — delete one entry unless something references it. */
async function deleteExpose(deps: AdminDeps, key: string): Promise<HttpReply> {
  const config = deps.config()
  if (config.expose[key] === undefined) return notFound(`Unknown expose key: ${key}`)
  const referrers = Object.entries(config.expose)
    .filter(([other, entry]) =>
      other !== key
      && entry.description !== undefined
      && entry.description !== ''
      && entry.description.includes(`\`${key}\``))
    .map(([other]) => other)
  if (referrers.length > 0) {
    const rendered = referrers.map((referrer) => `'${referrer}'`).join(', ')
    return {
      status: 409,
      body: {
        error: `Cannot delete '${key}': referenced by [${rendered}]. Remove those backtick refs first.`,
      },
    }
  }
  const staged = withExposeEntry(config, key, null)
  return persistStaged(deps, staged, { status: 200, body: { status: 'deleted', key } })
}

/** `POST /api/add-server` — add servers from Claude-Desktop-style JSON. */
async function addServer(deps: AdminDeps, request: AdminRequest): Promise<HttpReply> {
  const body = await jsonObjectBody(request)
  if (body === undefined) return badRequest('body must be a JSON object')

  const rawText = body['json_text'] ?? ''
  if (typeof rawText !== 'string') return badRequest('json_text must be a string')
  const toolsetValue = body['toolset']
  let toolset: string | undefined
  if (toolsetValue !== undefined && toolsetValue !== null && toolsetValue !== '') {
    if (typeof toolsetValue !== 'string') return badRequest('toolset must be a string')
    toolset = toolsetValue
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return badRequest(`Invalid JSON: ${messageOf(error)}`)
  }
  if (!isJsonObject(parsed)) return badRequest('Top-level JSON must be an object')
  const wrapped = parsed['mcpServers']
  const servers: JsonObject = isJsonObject(wrapped) ? wrapped : parsed

  const config = deps.config()
  let upstreams = [...config.upstreams]
  let expose = { ...config.expose }
  let existingNames = new Set(upstreams.map((upstream) => upstream.name))
  const added: JsonObject[] = []
  const errors: JsonObject[] = []

  for (const [serverName, spec] of Object.entries(servers)) {
    try {
      if (!isJsonObject(spec)) throw new Error('server spec must be an object')
      const upstream = parseClaudeDesktopEntry(serverName, spec)
      let rawTools: string[]
      try {
        rawTools = await probeTools(deps, upstream)
      } catch (error) {
        throw new Error(`failed to fetch tools: ${messageOf(error)}`)
      }

      const candidateUpstreams = [...upstreams]
      const candidateExpose = { ...expose }
      const candidateNames = new Set(existingNames)
      if (!candidateNames.has(serverName)) {
        candidateUpstreams.push(upstream)
        candidateNames.add(serverName)
      }
      const newTools: string[] = []
      for (const toolName of rawTools) {
        const key = `${serverName}/${toolName}`
        if (key in candidateExpose) continue
        const entry: ExposeEntry = { upstream: serverName, tool: toolName, hide: false }
        if (toolset !== undefined) entry.toolset = toolset
        candidateExpose[key] = entry
        newTools.push(toolName)
      }

      const staged: GatewayConfig = { ...config, upstreams: candidateUpstreams, expose: candidateExpose }
      const invalid = validateStaged(staged)
      if (invalid !== undefined) throw new ConfigError(invalid)

      upstreams = candidateUpstreams
      expose = candidateExpose
      existingNames = candidateNames
      added.push({ server: serverName, toolset: toolset ?? null, tools: newTools })
      deps.logger.info(
        `Added server '${serverName}' via JSON (${newTools.length} tools, toolset=${toolset ?? 'None'})`,
      )
    } catch (error) {
      errors.push({ server: serverName, error: messageOf(error) })
    }
  }

  if (added.length === 0) {
    return {
      status: 400,
      body: { added: [], errors: errors.length > 0 ? errors : [{ server: '*', error: 'no servers added' }] },
    }
  }
  await deps.persistConfig({ ...config, upstreams, expose })
  return { status: 200, body: { added, errors } }
}

/** `GET /api/keys` — key-pool status for every upstream that has one. */
async function listKeys(deps: AdminDeps): Promise<HttpReply> {
  const body: JsonObject = {}
  for (const [name, pool] of deps.keypools()) {
    body[name] = { healthy_count: pool.healthyCount, keys: pool.statuses() }
  }
  return { status: 200, body }
}

/** `GET /api/calls` — recorded tool calls, newest first. */
async function listCalls(deps: AdminDeps): Promise<HttpReply> {
  return { status: 200, body: [...deps.callLogSnapshot()].reverse() }
}

/** `POST /api/keys/{upstream}/resume` — resume one paused key. */
async function resumeKey(deps: AdminDeps, request: AdminRequest, upstreamName: string): Promise<HttpReply> {
  const pool = deps.keypool(upstreamName)
  if (pool === undefined) return notFound('No keypool for this upstream')
  const keyIndex = readKeyIndex(await request.bodyJson(), 0)
  const key = pool.keyAt(keyIndex)
  pool.resume(key)
  deps.logger.info(`Upstream '${upstreamName}': key ${keyIndex} resumed manually`)
  return { status: 200, body: { status: 'resumed', key: `${key.slice(0, 4)}...` } }
}

/** `POST /api/keys/{upstream}` — append one key to an upstream's pool. */
async function addKey(deps: AdminDeps, request: AdminRequest, upstreamName: string): Promise<HttpReply> {
  const config = deps.config()
  const index = config.upstreams.findIndex((upstream) => upstream.name === upstreamName)
  if (index === -1) return notFound(`Unknown upstream: ${upstreamName}`)
  const upstream = config.upstreams[index]!
  if (upstream.auth === undefined) {
    return badRequest(
      `Upstream '${upstreamName}' has no auth block. Add one (with header+scheme) in the YAML first.`,
    )
  }
  const body = await jsonObjectBody(request)
  if (body === undefined) return badRequest('body must be {"key": "..."}')
  const keyValue = body['key']
  if (typeof keyValue !== 'string' || keyValue.trim() === '') {
    return badRequest('body must be {"key": "..."}')
  }
  const keys = [...upstream.auth.keys, keyValue.trim()]
  const next: UpstreamConfig = { ...upstream, auth: { ...upstream.auth, keys } }
  const staged = withUpstream(config, index, next)
  const reply = await persistStaged(deps, staged, {
    status: 200,
    body: { status: 'added', count: keys.length },
  })
  if (reply.status === 200) {
    deps.logger.info(`Upstream '${upstreamName}': key added (${keys.length} total)`)
  }
  return reply
}

/** `DELETE /api/keys/{upstream}/{key_index}` — remove one key by index. */
async function deleteKey(deps: AdminDeps, upstreamName: string, rawIndex: string): Promise<HttpReply> {
  const config = deps.config()
  const index = config.upstreams.findIndex((upstream) => upstream.name === upstreamName)
  if (index === -1) return notFound(`Unknown upstream: ${upstreamName}`)
  const upstream = config.upstreams[index]!
  if (upstream.auth === undefined || upstream.auth.keys.length === 0) {
    return notFound('No keys to delete')
  }
  let keyIndex: number
  try {
    keyIndex = parseKeyIndex(rawIndex)
  } catch (error) {
    return badRequest(messageOf(error))
  }
  if (keyIndex < 0 || keyIndex >= upstream.auth.keys.length) {
    return badRequest(`key_index ${keyIndex} out of range`)
  }
  const keys = upstream.auth.keys.filter((_key, at) => at !== keyIndex)
  const next: UpstreamConfig = { ...upstream, auth: { ...upstream.auth, keys } }
  const staged = withUpstream(config, index, next)
  const reply = await persistStaged(deps, staged, {
    status: 200,
    body: { status: 'deleted', count: keys.length },
  })
  if (reply.status === 200) {
    deps.logger.info(`Upstream '${upstreamName}': key ${keyIndex} deleted (${keys.length} remain)`)
  }
  return reply
}

/**
 * Route one `/api/upstreams/...` request.
 * @param deps - admin dependencies.
 * @param request - inbound request.
 * @param segments - path segments after `upstreams`.
 * @returns the reply.
 */
async function handleUpstreamRoute(
  deps: AdminDeps,
  request: AdminRequest,
  segments: string[],
): Promise<HttpReply> {
  if (segments.length === 0) {
    return request.method === 'GET' ? listUpstreamNames(deps) : notFound()
  }
  const name = segments[0]!
  const tail = segments.slice(1)
  if (tail.length === 0) {
    if (request.method === 'GET') return getUpstream(deps, name)
    if (request.method === 'PUT') return putUpstream(deps, request, name)
    return notFound()
  }
  if (tail.length === 1 && tail[0] === 'tools' && request.method === 'GET') {
    return rawUpstreamTools(deps, name)
  }
  if (tail.length === 1 && tail[0] === 'test' && request.method === 'POST') {
    return testUpstream(deps, name)
  }
  return notFound()
}

/**
 * Route one `/api/expose/...` request.
 * @param deps - admin dependencies.
 * @param request - inbound request.
 * @param segments - path segments after `expose`; a key may contain `/`.
 * @returns the reply.
 */
async function handleExposeRoute(
  deps: AdminDeps,
  request: AdminRequest,
  segments: string[],
): Promise<HttpReply> {
  if (segments.length === 0) {
    return request.method === 'GET' ? listExpose(deps) : notFound()
  }
  const key = segments.join('/')
  if (request.method === 'PUT') return putExpose(deps, request, key)
  if (request.method === 'DELETE') return deleteExpose(deps, key)
  return notFound()
}

/**
 * Route one `/api/keys/...` request.
 * @param deps - admin dependencies.
 * @param request - inbound request.
 * @param segments - path segments after `keys`.
 * @returns the reply.
 */
async function handleKeysRoute(
  deps: AdminDeps,
  request: AdminRequest,
  segments: string[],
): Promise<HttpReply> {
  if (segments.length === 0) {
    return request.method === 'GET' ? listKeys(deps) : notFound()
  }
  const upstreamName = segments[0]!
  const tail = segments.slice(1)
  if (tail.length === 0) {
    return request.method === 'POST' ? addKey(deps, request, upstreamName) : notFound()
  }
  if (tail.length === 1 && tail[0] === 'resume' && request.method === 'POST') {
    return resumeKey(deps, request, upstreamName)
  }
  if (tail.length === 1 && request.method === 'DELETE') {
    return deleteKey(deps, upstreamName, tail[0]!)
  }
  return notFound()
}

/**
 * Answer one admin API request.
 * @param deps - admin dependencies (config, key pools, reload, probe factory).
 * @param request - routed request.
 * @returns status plus JSON body in the retired service's shape.
 */
export async function handleAdminRequest(deps: AdminDeps, request: AdminRequest): Promise<HttpReply> {
  const head = request.segments[0]
  const rest = request.segments.slice(1)
  switch (head) {
    case 'config':
      if (rest.length > 0) return notFound()
      if (request.method === 'GET') return getConfigYaml(deps)
      if (request.method === 'POST') return replaceConfig(deps, request)
      return notFound()
    case 'tools':
      if (rest.length > 0) return notFound()
      return request.method === 'GET' ? listToolsPreview(deps, request) : notFound()
    case 'toolsets':
      if (rest.length > 0) return notFound()
      return request.method === 'GET' ? listToolsets(deps) : notFound()
    case 'client-presets':
      if (rest.length > 0) return notFound()
      return request.method === 'GET' ? { status: 200, body: presets() } : notFound()
    case 'upstreams':
      return handleUpstreamRoute(deps, request, rest)
    case 'expose':
      return handleExposeRoute(deps, request, rest)
    case 'keys':
      return handleKeysRoute(deps, request, rest)
    case 'add-server':
      if (rest.length > 0) return notFound()
      return request.method === 'POST' ? addServer(deps, request) : notFound()
    case 'calls':
      if (rest.length > 0) return notFound()
      return request.method === 'GET' ? listCalls(deps) : notFound()
    default:
      return notFound()
  }
}
