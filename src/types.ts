/**
 * Shared vocabulary of the mcpp gateway: the YAML configuration model, the
 * upstream transport seam, and the dependency objects the HTTP layers receive.
 *
 * Field names mirror the Python implementation's model (pydantic aliases) so a
 * config.yaml written by either side round-trips: `as`, `map_from`, `hide`,
 * `inherit_env`, `connect_timeout`, `read_timeout`, `list_timeout`.
 *
 * @module
 */

/** MCP protocol revision this gateway advertises, matching the retired service. */
export const PROTOCOL_VERSION = '2025-11-25'

/** Version string reported in `serverInfo` and the admin API. */
export const SERVER_VERSION = '0.1.0'

/** Most recent tool-call outcomes kept in memory (ring buffer). */
export const CALL_LOG_MAX = 200

/** Bridge auth cookie name and lifetime (seconds). */
export const AUTH_COOKIE_NAME = 'mcpp_token'
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 3600

/** Seconds the startup stdio warmup may take before the listener starts serving. */
export const STDIO_PREWARM_TIMEOUT = 20

/** Per-upstream cap (seconds) for one probe's `tools/list` when listed with no explicit timeout. */
export const DEFAULT_LIST_TIMEOUT = 20

/** A JSON object crossing the wire or the config file. */
export type JsonObject = Record<string, unknown>

/** An MCP tool as an upstream advertises it. */
export interface Tool {
  name: string
  description?: string
  inputSchema?: JsonObject
  annotations?: JsonObject
  title?: string
}

/** Upstream authentication: a rotation pool rendered into one header. */
export interface AuthConfig {
  /** Raw key values; each may hold `${VAR}` resolved against the host env at build time. */
  keys: string[]
  /** Header name the key is sent under, e.g. `Authorization`. */
  header: string
  /** Value prefix: `"Bearer "` or `""` for a bare key. */
  scheme: string
}

/** One upstream MCP server in `config.yaml`. */
export interface UpstreamConfig {
  name: string
  /** `http` (Streamable HTTP) or `stdio` (spawned child). */
  transport: 'http' | 'stdio'
  /** HTTP endpoint; `/mcp` is appended when absent. */
  url?: string
  /** stdio executable. */
  command?: string
  /** stdio arguments, passed without shell interpolation. */
  args?: string[]
  /** Extra child env; values may hold `${VAR}`. */
  env?: Record<string, string>
  /** Host env vars the child keeps (default `['PATH']`). */
  inheritEnv: string[]
  auth?: AuthConfig
  connectTimeout: number
  readTimeout: number
  /** Per-upstream cap for a client-facing `tools/list`. */
  listTimeout: number
}

/** One downstream parameter mapping in an expose entry. */
export interface ParamTransform {
  /** Name the client sees. */
  name: string
  /** Upstream parameter name; defaults to {@link name}. */
  mapFrom?: string
  /** `enum` maps allowed values, `preset` injects a whole argument object. */
  type?: 'enum' | 'preset'
  /** For `enum`: downstream value -> upstream value. */
  mapping?: Record<string, unknown>
  /** For `preset`: downstream value -> upstream parameter object. */
  preset?: Record<string, JsonObject>
  /** Hide from the downstream schema; `default` is injected on every call. */
  hidden: boolean
  /** Injected upstream value for a hidden parameter. */
  default?: unknown
  /** Downstream description override. */
  description?: string
  /** Force downstream requiredness; omitted inherits the upstream schema. */
  required?: boolean
}

/** One exposed tool: a stable `upstream/tool` key plus its downstream presentation. */
export interface ExposeEntry {
  upstream: string
  tool: string
  /** Downstream display name; defaults to the key's last segment. */
  as?: string
  /** Aggregated MCP server (toolset) this tool belongs to; defaults to `serverName`. */
  toolset?: string
  hide: boolean
  description?: string
  params?: ParamTransform[]
}

/** The whole `config.yaml` document. */
export interface GatewayConfig {
  upstreams: UpstreamConfig[]
  /** Stable key `upstream/tool` -> entry. */
  expose: Record<string, ExposeEntry>
  /** Name of the default aggregated MCP server. */
  serverName: string
  /** Optional gateway-level bearer token; unset means fully open. */
  auth?: { token?: string }
  /** Per-client endpoint enable map; a `false` entry 404s that naming mode. */
  clients?: Record<string, boolean>
}

/**
 * Bidirectional tool-name mapping for one naming mode.
 *
 * `formatName` produces the client-visible name; `parseName` recovers the
 * display name from an incoming call, returning `null` when the name does not
 * match (the caller then falls back to key/display matching).
 */
export interface ClientFormat {
  namingId: string
  formatName(server: string, displayName: string): string
  parseName(server: string, formatted: string): string | null
}

/** One upstream connection. Implementations own their connection lifecycle. */
export interface UpstreamTransport {
  readonly name: string
  /** Fetch the upstream tool list (raw, untransformed). */
  listTools(): Promise<Tool[]>
  /** Invoke one upstream tool; returns the JSON-RPC `result` object. */
  callTool(name: string, args: JsonObject): Promise<JsonObject>
  /** Release the connection / child process. Safe to call twice. */
  close(): Promise<void>
}

/** Key-pool status as the admin API reports it (keys are masked). */
export interface KeyStatus {
  index: number
  key: string
  paused: boolean
}

/** Round-robin health-aware key pool, structurally typed for the admin layer. */
export interface KeyPoolView {
  next(): string
  markBad(key: string): void
  resume(key: string): void
  readonly healthyCount: number
  statuses(): KeyStatus[]
  keyAt(index: number): string
  readonly current: string
}

/** One recorded tool call (no arguments or results — those may carry secrets). */
export interface CallLogEntry {
  ts: number
  tool: string
  upstream: string
  ok: boolean
  latencyMs: number
  error?: string
}

/** Minimal leveled logger the gateway writes through. */
export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** A ready-to-serialize HTTP answer from an inner handler. */
export interface HttpReply {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/** Dependencies the MCP protocol layer needs from the composition root. */
export interface McpHandlerDeps {
  /** Current configuration (replaced object identity on reload). */
  config(): GatewayConfig
  /** Live transport by upstream name, if configured. */
  transport(name: string): UpstreamTransport | undefined
  /** Append one call outcome to the bounded in-memory log. */
  recordCall(entry: CallLogEntry): void
  /** Mark the key behind the last request unhealthy; absent when the upstream has no pool. */
  onUpstreamStatus?(upstreamName: string, status: number): void
  logger: Logger
}

/** Dependencies the admin API additionally needs. */
export interface AdminDeps extends McpHandlerDeps {
  /** Absolute path of the YAML document reads and writes go to. */
  readonly configPath: string
  keypool(name: string): KeyPoolView | undefined
  keypools(): Map<string, KeyPoolView>
  /** Validate, write to {@link configPath}, rebuild transports, then swap the live config. */
  persistConfig(next: GatewayConfig): Promise<void>
  /** Throwaway transport for `add-server` probing; caller closes it. */
  createProbeTransport(upstream: UpstreamConfig): UpstreamTransport
  /** Newest-last copy of the bounded call log; the admin API reverses it. */
  callLogSnapshot(): CallLogEntry[]
}

/** Composition-root object the HTTP server serves from. */
export interface GatewayRuntime {
  readonly configPath: string
  config: GatewayConfig
  readonly upstreams: Map<string, UpstreamTransport>
  readonly keypools: Map<string, KeyPoolView>
  readonly callLog: CallLogEntry[]
  logger: Logger
}
