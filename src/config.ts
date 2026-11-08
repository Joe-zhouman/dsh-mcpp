/**
 * Configuration loading, validation, and serialization for the gateway.
 *
 * A port of the retired service's `config.py`. Validation follows pydantic v2:
 * unknown fields are ignored, model defaults are filled in, and a missing
 * required field or a value of the wrong type raises {@link ConfigError}.
 * `${VAR}` references are deliberately not resolved while parsing so the admin
 * editor round-trips the literal text; transports resolve them when built.
 *
 * Owner: config-transform. Contract: DESIGN.md § src/config.ts.
 *
 * @module
 */

import { readFileSync } from 'node:fs'

import yaml from 'js-yaml'

import { ConfigError } from './errors.ts'
import type {
  AuthConfig,
  ExposeEntry,
  GatewayConfig,
  JsonObject,
  ParamTransform,
  UpstreamConfig,
} from './types.ts'

/** Toolset names that shadow a client built-in; see `Config.validate_toolsets`. */
const RESERVED_TOOLSETS: ReadonlySet<string> = new Set(['fetch'])

/** `${VAR}` reference; a bare `$VAR` is intentionally not matched. */
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** One backtick-quoted token from a description (`BACKTICK_REF` in the old model). */
const BACKTICK_REF = /`(\S+)`/g

/** Parent path of the YAML document root, used by the field-path helper. */
const ROOT = ''

/** Model defaults, kept next to their fields so a dump matches the old YAML. */
const DEFAULT_TRANSPORT = 'http'
const DEFAULT_INHERIT_ENV = ['PATH']
const DEFAULT_CONNECT_TIMEOUT = 30
const DEFAULT_READ_TIMEOUT = 120
const DEFAULT_LIST_TIMEOUT = 20
const DEFAULT_SERVER_NAME = 'mcpp'

/**
 * Join a parent path and a field name into the path used in error messages.
 * @param parent - parent path, or the empty root path.
 * @param field - field name.
 * @returns the dotted path.
 */
function fieldPath(parent: string, field: string): string {
  return parent === ROOT ? field : `${parent}.${field}`
}

/**
 * Narrow an unknown YAML value to a mapping.
 * @param value - value to check.
 * @returns whether it is a non-array object.
 */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Require a mapping.
 * @param value - value to check.
 * @param path - path for the error message.
 * @returns the mapping.
 * @throws ConfigError when the value is not a mapping.
 */
function expectMapping(value: unknown, path: string): Record<string, unknown> {
  if (!isMapping(value)) throw new ConfigError(`${path} must be a mapping`)
  return value
}

/**
 * Require a string.
 * @param value - value to check.
 * @param path - path for the error message.
 * @returns the string.
 * @throws ConfigError when the value is not a string.
 */
function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ConfigError(`${path} must be a string`)
  return value
}

/**
 * Require a key the document must provide.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the field value.
 * @throws ConfigError when the field is absent or not a string.
 */
function requireString(raw: Record<string, unknown>, field: string, parent: string): string {
  const value = raw[field]
  if (value === undefined) throw new ConfigError(`${fieldPath(parent, field)} is required`)
  return expectString(value, fieldPath(parent, field))
}

/**
 * Read an optional string field (`null` means absent, like `Optional[str]`).
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the string, or undefined when the field is absent or null.
 */
function optionalString(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): string | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  return expectString(value, fieldPath(parent, field))
}

/**
 * Read a string field that has a model default. An explicit `null` is a type
 * error, not "use the default" — that is what pydantic does for `str = "…"`.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @param fallback - model default.
 * @returns the configured string or the default.
 */
function defaultedString(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
  fallback: string,
): string {
  const value = raw[field]
  if (value === undefined) return fallback
  return expectString(value, fieldPath(parent, field))
}

/**
 * Read an optional boolean field.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the boolean, or undefined when absent or null.
 */
function optionalBoolean(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): boolean | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new ConfigError(`${fieldPath(parent, field)} must be a boolean`)
  return value
}

/**
 * Read a boolean field that has a model default.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @param fallback - model default.
 * @returns the configured boolean or the default.
 */
function defaultedBoolean(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
  fallback: boolean,
): boolean {
  const value = raw[field]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ConfigError(`${fieldPath(parent, field)} must be a boolean`)
  return value
}

/**
 * Read an integer field that has a model default.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @param fallback - model default.
 * @returns the configured integer or the default.
 */
function defaultedInteger(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
  fallback: number,
): number {
  const value = raw[field]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ConfigError(`${fieldPath(parent, field)} must be an integer`)
  }
  return value
}

/**
 * Validate a YAML list of strings and copy it.
 * @param value - value to validate.
 * @param path - path for error messages.
 * @returns a fresh string array.
 */
function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list of strings`)
  return value.map((item, index) => expectString(item, `${path}[${index}]`))
}

/**
 * Require a list-of-strings field.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns a fresh string array.
 */
function requireStringList(raw: Record<string, unknown>, field: string, parent: string): string[] {
  const value = raw[field]
  const path = fieldPath(parent, field)
  if (value === undefined) throw new ConfigError(`${path} is required`)
  return stringList(value, path)
}

/**
 * Read an optional list-of-strings field (`null` means absent).
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the list, or undefined when absent or null.
 */
function optionalStringList(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): string[] | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  return stringList(value, fieldPath(parent, field))
}

/**
 * Read a list-of-strings field that has a model default. The default is copied
 * into a fresh array, matching `default_factory`.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @param fallback - model default.
 * @returns the configured list or a copy of the default.
 */
function defaultedStringList(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
  fallback: readonly string[],
): string[] {
  const value = raw[field]
  if (value === undefined) return [...fallback]
  return stringList(value, fieldPath(parent, field))
}

/**
 * Read an optional mapping field (`null` means absent).
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the mapping, or undefined when absent or null.
 */
function optionalMapping(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): Record<string, unknown> | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  return expectMapping(value, fieldPath(parent, field))
}

/**
 * Read an optional `dict[str, str]` field, e.g. a stdio upstream's `env`.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns a fresh string map, or undefined when absent or null.
 */
function optionalStringMap(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): Record<string, string> | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  const path = fieldPath(parent, field)
  const entries = Object.entries(expectMapping(value, path)).map(([name, item]): [string, string] => [
    name,
    expectString(item, `${path}.${name}`),
  ])
  return Object.fromEntries(entries)
}

/**
 * Read an optional `dict[str, dict[str, Any]]` field, e.g. a preset table.
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns a fresh preset map, or undefined when absent or null.
 */
function optionalPresetMap(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): Record<string, JsonObject> | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  const path = fieldPath(parent, field)
  const entries = Object.entries(expectMapping(value, path)).map(
    ([name, preset]): [string, JsonObject] => [name, expectMapping(preset, `${path}.${name}`)],
  )
  return Object.fromEntries(entries)
}

/**
 * Read an upstream's `transport` field.
 * @param raw - enclosing mapping.
 * @param parent - parent path for error messages.
 * @returns `http` (the default) or `stdio`.
 */
function readTransport(raw: Record<string, unknown>, parent: string): 'http' | 'stdio' {
  const value = raw['transport']
  if (value === undefined) return DEFAULT_TRANSPORT
  if (value !== 'http' && value !== 'stdio') {
    throw new ConfigError(`${fieldPath(parent, 'transport')} must be "http" or "stdio"`)
  }
  return value
}

/**
 * Read a parameter transform's `type` field.
 * @param raw - enclosing mapping.
 * @param parent - parent path for error messages.
 * @returns `enum`, `preset`, or undefined for a passthrough parameter.
 */
function readParamType(
  raw: Record<string, unknown>,
  parent: string,
): 'enum' | 'preset' | undefined {
  const value = raw['type']
  if (value === undefined || value === null) return undefined
  if (value !== 'enum' && value !== 'preset') {
    throw new ConfigError(`${fieldPath(parent, 'type')} must be "enum" or "preset"`)
  }
  return value
}

/**
 * Validate one `auth` block.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the auth configuration.
 */
function parseAuthConfig(value: unknown, parent: string): AuthConfig {
  const raw = expectMapping(value, parent)
  return {
    keys: requireStringList(raw, 'keys', parent),
    header: requireString(raw, 'header', parent),
    scheme: requireString(raw, 'scheme', parent),
  }
}

/**
 * Validate one upstream entry, applying model defaults.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the upstream configuration.
 */
function parseUpstreamConfig(value: unknown, parent: string): UpstreamConfig {
  const raw = expectMapping(value, parent)
  const name = requireString(raw, 'name', parent)
  const transport = readTransport(raw, parent)
  const url = optionalString(raw, 'url', parent)
  const command = optionalString(raw, 'command', parent)
  const args = optionalStringList(raw, 'args', parent)
  const env = optionalStringMap(raw, 'env', parent)
  const inheritEnv = defaultedStringList(raw, 'inherit_env', parent, DEFAULT_INHERIT_ENV)
  const rawAuth = raw['auth']
  const auth =
    rawAuth === undefined || rawAuth === null
      ? undefined
      : parseAuthConfig(rawAuth, fieldPath(parent, 'auth'))
  const connectTimeout = defaultedInteger(raw, 'connect_timeout', parent, DEFAULT_CONNECT_TIMEOUT)
  const readTimeout = defaultedInteger(raw, 'read_timeout', parent, DEFAULT_READ_TIMEOUT)
  const listTimeout = defaultedInteger(raw, 'list_timeout', parent, DEFAULT_LIST_TIMEOUT)
  return {
    name,
    transport,
    url,
    command,
    args,
    env,
    inheritEnv,
    auth,
    connectTimeout,
    readTimeout,
    listTimeout,
  }
}

/**
 * Validate one parameter transform, applying model defaults.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the parameter transform.
 */
function parseParamTransform(value: unknown, parent: string): ParamTransform {
  const raw = expectMapping(value, parent)
  const name = requireString(raw, 'name', parent)
  const mapFrom = optionalString(raw, 'map_from', parent)
  const type = readParamType(raw, parent)
  const mapping = optionalMapping(raw, 'mapping', parent)
  const preset = optionalPresetMap(raw, 'preset', parent)
  const hidden = defaultedBoolean(raw, 'hidden', parent, false)
  const defaultValue = raw['default']
  const description = optionalString(raw, 'description', parent)
  const required = optionalBoolean(raw, 'required', parent)
  return { name, mapFrom, type, mapping, preset, hidden, default: defaultValue, description, required }
}

/**
 * Validate an optional `params` list (`null` means "pass the upstream schema
 * through", which is different from an empty list).
 * @param raw - enclosing mapping.
 * @param field - field name.
 * @param parent - parent path for error messages.
 * @returns the transforms, or undefined when absent or null.
 */
function optionalParams(
  raw: Record<string, unknown>,
  field: string,
  parent: string,
): ParamTransform[] | undefined {
  const value = raw[field]
  if (value === undefined || value === null) return undefined
  const path = fieldPath(parent, field)
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list`)
  return value.map((item, index) => parseParamTransform(item, `${path}[${index}]`))
}

/**
 * Validate one expose entry, applying model defaults.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the expose entry.
 */
function parseExposeEntry(value: unknown, parent: string): ExposeEntry {
  const raw = expectMapping(value, parent)
  const upstream = requireString(raw, 'upstream', parent)
  const tool = requireString(raw, 'tool', parent)
  const as = optionalString(raw, 'as', parent)
  const toolset = optionalString(raw, 'toolset', parent)
  const hide = defaultedBoolean(raw, 'hide', parent, false)
  const description = optionalString(raw, 'description', parent)
  const params = optionalParams(raw, 'params', parent)
  return { upstream, tool, as, toolset, hide, description, params }
}

/**
 * Validate the `expose` table.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the keyed expose table.
 */
function parseExposeTable(value: unknown, parent: string): Record<string, ExposeEntry> {
  if (value === undefined) throw new ConfigError(`${parent} is required`)
  const raw = expectMapping(value, parent)
  const entries = Object.entries(raw).map(
    ([key, entry]): [string, ExposeEntry] => [key, parseExposeEntry(entry, `${parent}.${key}`)],
  )
  return Object.fromEntries(entries)
}

/**
 * Validate the gateway-level `auth` block.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns the auth settings.
 */
function parseGatewayAuth(value: unknown, parent: string): { token?: string } {
  const raw = expectMapping(value, parent)
  return { token: optionalString(raw, 'token', parent) }
}

/**
 * Validate the per-client endpoint enable map.
 * @param value - raw YAML value.
 * @param parent - path for error messages.
 * @returns client id to enabled flag.
 */
function parseClients(value: unknown, parent: string): Record<string, boolean> {
  const raw = expectMapping(value, parent)
  const entries = Object.entries(raw).map(([id, enabled]): [string, boolean] => {
    if (typeof enabled !== 'boolean') throw new ConfigError(`${parent}.${id} must be a boolean`)
    return [id, enabled]
  })
  return Object.fromEntries(entries)
}

/**
 * Reject descriptions that reference a tool missing from `expose` or hidden.
 * Only slash-bearing `` `upstream/tool` `` refs are cross-tool references; other
 * backtick-quoted tokens are literals (param names, code fragments).
 * @param config - configuration to check.
 * @throws ConfigError on the first dangling or hidden reference.
 */
function validateRefs(config: GatewayConfig): void {
  for (const [key, entry] of Object.entries(config.expose)) {
    const description = entry.description
    if (description === undefined || description === null || description === '') continue
    for (const match of description.matchAll(BACKTICK_REF)) {
      const ref = match[1]
      if (!ref.includes('/')) continue
      const target = config.expose[ref]
      if (target === undefined) {
        throw new ConfigError(
          `Tool '${key}' description references '${ref}', which does not exist in expose`,
        )
      }
      if (target.hide) {
        throw new ConfigError(
          `Tool '${key}' description references '${ref}', which is hidden (hide: true)`,
        )
      }
    }
  }
}

/**
 * Reject aggregated toolset names that shadow a client built-in.
 * @param config - configuration to check.
 * @throws ConfigError when an entry resolves to a reserved toolset name.
 */
function validateToolsets(config: GatewayConfig): void {
  for (const [key, entry] of Object.entries(config.expose)) {
    const name = entry.toolset ?? config.serverName
    if (!RESERVED_TOOLSETS.has(name)) continue
    throw new ConfigError(
      `Tool '${key}' uses toolset '${name}', which is reserved: ` +
        `clients expand it to mcp__${name}__<tool> and already ship a built-in of that name. ` +
        `Use a distinct toolset name (e.g. 'get').`,
    )
  }
}

/**
 * Render one upstream as the YAML field order of the old model, dropping
 * undefined fields (`exclude_none=True, by_alias=True`).
 * @param upstream - upstream configuration.
 * @returns the ordered plain object to serialize.
 */
function plainUpstream(upstream: UpstreamConfig): JsonObject {
  const out: JsonObject = { name: upstream.name, transport: upstream.transport }
  if (upstream.url !== undefined && upstream.url !== null) out['url'] = upstream.url
  if (upstream.command !== undefined && upstream.command !== null) out['command'] = upstream.command
  if (upstream.args !== undefined && upstream.args !== null) out['args'] = [...upstream.args]
  if (upstream.env !== undefined && upstream.env !== null) out['env'] = { ...upstream.env }
  out['inherit_env'] = [...upstream.inheritEnv]
  if (upstream.auth !== undefined && upstream.auth !== null) {
    out['auth'] = {
      keys: [...upstream.auth.keys],
      header: upstream.auth.header,
      scheme: upstream.auth.scheme,
    }
  }
  out['connect_timeout'] = upstream.connectTimeout
  out['read_timeout'] = upstream.readTimeout
  out['list_timeout'] = upstream.listTimeout
  return out
}

/**
 * Render one parameter transform in the YAML field order of the old model.
 * @param param - parameter transform.
 * @returns the ordered plain object to serialize.
 */
function plainParamTransform(param: ParamTransform): JsonObject {
  const out: JsonObject = { name: param.name }
  if (param.mapFrom !== undefined && param.mapFrom !== null) out['map_from'] = param.mapFrom
  if (param.type !== undefined && param.type !== null) out['type'] = param.type
  if (param.mapping !== undefined && param.mapping !== null) out['mapping'] = { ...param.mapping }
  if (param.preset !== undefined && param.preset !== null) out['preset'] = { ...param.preset }
  out['hidden'] = param.hidden
  if (param.default !== undefined && param.default !== null) out['default'] = param.default
  if (param.description !== undefined && param.description !== null) {
    out['description'] = param.description
  }
  if (param.required !== undefined && param.required !== null) out['required'] = param.required
  return out
}

/**
 * Render one expose entry in the YAML field order of the old model.
 * @param entry - expose entry.
 * @returns the ordered plain object to serialize.
 */
function plainExposeEntry(entry: ExposeEntry): JsonObject {
  const out: JsonObject = { upstream: entry.upstream, tool: entry.tool }
  if (entry.as !== undefined && entry.as !== null) out['as'] = entry.as
  if (entry.toolset !== undefined && entry.toolset !== null) out['toolset'] = entry.toolset
  out['hide'] = entry.hide
  if (entry.description !== undefined && entry.description !== null) {
    out['description'] = entry.description
  }
  if (entry.params !== undefined) out['params'] = entry.params.map(plainParamTransform)
  return out
}

/**
 * Render the whole configuration in the YAML field order of the old model.
 * @param config - configuration to serialize.
 * @returns the ordered plain object to serialize.
 */
function plainConfig(config: GatewayConfig): JsonObject {
  const out: JsonObject = {
    upstreams: config.upstreams.map(plainUpstream),
    expose: Object.fromEntries(
      Object.entries(config.expose).map(([key, entry]) => [key, plainExposeEntry(entry)]),
    ),
    server_name: config.serverName,
  }
  if (config.auth !== undefined && config.auth !== null) {
    const auth: JsonObject = {}
    if (config.auth.token !== undefined && config.auth.token !== null) {
      auth['token'] = config.auth.token
    }
    out['auth'] = auth
  }
  if (config.clients !== undefined && config.clients !== null) {
    out['clients'] = { ...config.clients }
  }
  return out
}

/**
 * Format an unknown thrown value for a wrapped ConfigError message.
 * @param cause - thrown value.
 * @returns its message.
 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Parse and validate a whole `config.yaml` document.
 *
 * Unknown fields are ignored (pydantic's default `extra='ignore'`).
 * @param text - YAML source.
 * @param env - accepted for call-site symmetry with {@link resolveEnvValue};
 *   parsing never resolves `${VAR}`, so dumps round-trip the literal text.
 * @returns the validated configuration with model defaults applied.
 * @throws ConfigError when the document violates the model or its cross-references.
 */
export function parseConfig(text: string, env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  void env
  let document: unknown
  try {
    document = yaml.load(text)
  } catch (cause) {
    throw new ConfigError(`invalid YAML: ${errorMessage(cause)}`)
  }
  const raw = expectMapping(document, 'configuration')
  const rawUpstreams = raw['upstreams']
  if (rawUpstreams === undefined) throw new ConfigError('upstreams is required')
  if (!Array.isArray(rawUpstreams)) throw new ConfigError('upstreams must be a list')
  const upstreams = rawUpstreams.map((item, index) => parseUpstreamConfig(item, `upstreams[${index}]`))
  const expose = parseExposeTable(raw['expose'], 'expose')
  const serverName = defaultedString(raw, 'server_name', ROOT, DEFAULT_SERVER_NAME)
  const rawAuth = raw['auth']
  const auth =
    rawAuth === undefined || rawAuth === null ? undefined : parseGatewayAuth(rawAuth, 'auth')
  const rawClients = raw['clients']
  const clients =
    rawClients === undefined || rawClients === null ? undefined : parseClients(rawClients, 'clients')
  const config: GatewayConfig = { upstreams, expose, serverName, auth, clients }
  validateRefs(config)
  validateToolsets(config)
  return config
}

/**
 * Read, parse, and validate the configuration file.
 * @param path - absolute or cwd-relative YAML path.
 * @param env - environment for call-site symmetry; see {@link parseConfig}.
 * @returns the validated configuration.
 * @throws ConfigError when the file cannot be read or does not validate.
 */
export function loadConfigFile(path: string, env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new ConfigError(`cannot read config file '${path}': ${errorMessage(cause)}`)
  }
  return parseConfig(text, env)
}

/**
 * Serialize a configuration back to YAML for the admin editor and reload path.
 *
 * Equivalent to the old `to_yaml()`: model field order, aliases (`as`,
 * `map_from`, `inherit_env`, `*_timeout`, `server_name`), undefined/null fields
 * dropped, unicode kept verbatim, no line wrapping.
 * @param config - configuration to serialize.
 * @returns YAML text.
 */
export function dumpConfig(config: GatewayConfig): string {
  return yaml.dump(plainConfig(config), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
}

/**
 * Resolve `${VAR}` references against the environment; unknown names become an
 * empty string. Values without references come back unchanged.
 * @param value - raw configured string.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the resolved string.
 */
export function resolveEnvValue(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(ENV_REF, (_match, name: string) => env[name] ?? '')
}
