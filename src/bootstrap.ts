/**
 * Composition root: loads the YAML configuration, builds one transport per
 * upstream, assembles the dependency objects the HTTP layers receive, and owns
 * the reload path (validate -> persist -> rebuild -> swap).
 *
 * @module
 */

import { renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dumpConfig, loadConfigFile, parseConfig, resolveEnvValue } from './config.ts'
import { KeyPool } from './keypool.ts'
import { createLogger } from './logger.ts'
import { createHttpServer, type HttpServerHandle } from './server.ts'
import { StdioTransport } from './upstream-stdio.ts'
import { HttpTransport } from './upstream-http.ts'
import {
  CALL_LOG_MAX,
  STDIO_PREWARM_TIMEOUT,
  type AdminDeps,
  type CallLogEntry,
  type GatewayConfig,
  type GatewayRuntime,
  type KeyPoolView,
  type Logger,
  type McpHandlerDeps,
  type UpstreamConfig,
  type UpstreamTransport,
} from './types.ts'

/** Options for {@link createGateway}. */
export interface CreateGatewayOptions {
  /** Absolute path of the mcpp YAML document. */
  configPath: string
  /** Listen address. */
  host: string
  /** Listen port; 0 asks the OS for one. */
  port: number
  /** Environment used for `${VAR}` resolution. @default process.env */
  env?: NodeJS.ProcessEnv
  /** Logger; a stderr logger by default. */
  logger?: Logger
  /**
   * Called after a configuration reload swapped the live config and rebuilt the
   * transports, so consumers (the native tool surface) can re-sync.
   */
  onConfigChanged?: () => void
}

/** Live gateway handle. */
export interface GatewayHandle {
  readonly runtime: GatewayRuntime
  readonly configPath: string
  /** Handler dependencies, shared with the same-origin DSH routes. */
  readonly deps: { mcp: McpHandlerDeps; admin: AdminDeps }
  /** Bound address, or undefined before {@link start}. */
  address(): { host: string; port: number } | undefined
  /**
   * Bind the listener and warm stdio upstreams.
   * @returns the bound address.
   */
  start(): Promise<{ host: string; port: number }>
  /** Stop the listener and close every upstream. Idempotent. */
  close(): Promise<void>
}

/** Atomic whole-file replace: the admin editor must never truncate a config on crash. */
function writeFileAtomic(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

/**
 * Build the transport for one upstream config.
 * @param upstream - upstream definition.
 * @param keypools - live pools; a pool with the upstream's name drives its auth.
 * @param logger - sink for credential exhaustion.
 * @param env - environment for `${VAR}` resolution.
 * @returns the transport (connections open lazily).
 */
function createTransport(
  upstream: UpstreamConfig,
  keypools: Map<string, KeyPoolView>,
  logger: Logger,
  env: NodeJS.ProcessEnv,
): UpstreamTransport {
  if (upstream.transport === 'stdio') {
    const resolvedEnv = Object.fromEntries(
      Object.entries(upstream.env ?? {}).map(([key, value]) => [key, resolveEnvValue(value, env)]),
    )
    return new StdioTransport({
      name: upstream.name,
      command: upstream.command ?? '',
      args: upstream.args ?? [],
      env: resolvedEnv,
      inheritEnv: upstream.inheritEnv,
      readTimeout: upstream.readTimeout,
    })
  }
  const auth = upstream.auth
  const pool = keypools.get(upstream.name)
  const getAuth = auth === undefined || pool === undefined
    ? undefined
    : (): Record<string, string> | undefined => {
        try {
          return { [auth.header]: `${auth.scheme}${pool.next()}` }
        } catch {
          logger.error(`Upstream '${upstream.name}': all keys exhausted`)
          return undefined
        }
      }
  return new HttpTransport({
    name: upstream.name,
    url: upstream.url ?? '',
    getAuth,
    connectTimeout: upstream.connectTimeout,
    readTimeout: upstream.readTimeout,
  })
}

/**
 * Create the gateway from a configuration file. Nothing binds until {@link GatewayHandle.start}.
 * @param options - config path, bind address, environment, logger.
 * @returns the live handle.
 * @throws ConfigError when the configuration cannot be read or validated.
 */
export function createGateway(options: CreateGatewayOptions): GatewayHandle {
  const env = options.env ?? process.env
  const logger = options.logger ?? createLogger()
  const config = loadConfigFile(options.configPath, env)

  const runtime: GatewayRuntime = {
    configPath: options.configPath,
    config,
    upstreams: new Map(),
    keypools: new Map(),
    callLog: [],
    logger,
  }

  /** (Re)build every transport and key pool into the live maps, in place. */
  const buildUpstreams = (): void => {
    runtime.upstreams.clear()
    runtime.keypools.clear()
    for (const upstream of runtime.config.upstreams) {
      if (upstream.auth !== undefined && upstream.auth.keys.length > 0) {
        const keys = upstream.auth.keys.map((key) => resolveEnvValue(key, env))
        runtime.keypools.set(upstream.name, new KeyPool(keys))
        logger.info(`Upstream '${upstream.name}': keypool with ${keys.length} keys`)
      } else {
        logger.info(`Upstream '${upstream.name}': no auth`)
      }
      runtime.upstreams.set(upstream.name, createTransport(upstream, runtime.keypools, logger, env))
    }
  }
  buildUpstreams()

  const recordCall = (entry: CallLogEntry): void => {
    runtime.callLog.push(entry)
    if (runtime.callLog.length > CALL_LOG_MAX) runtime.callLog.shift()
  }

  const mcpDeps: McpHandlerDeps = {
    config: () => runtime.config,
    transport: (name) => runtime.upstreams.get(name),
    recordCall,
    onUpstreamStatus: (upstreamName, status) => {
      if (status !== 401 && status !== 403 && status !== 429) return
      const pool = runtime.keypools.get(upstreamName)
      if (pool === undefined) return
      pool.markBad(pool.current)
      logger.warn(`Upstream '${upstreamName}': key marked bad after ${status}, ${pool.healthyCount} healthy remaining`)
    },
    logger,
  }

  const adminDeps: AdminDeps = {
    ...mcpDeps,
    configPath: options.configPath,
    keypool: (name) => runtime.keypools.get(name),
    keypools: () => runtime.keypools,
    callLogSnapshot: () => [...runtime.callLog],
    createProbeTransport: (upstream) => {
      const pools = new Map<string, KeyPoolView>()
      if (upstream.auth !== undefined && upstream.auth.keys.length > 0) {
        pools.set(upstream.name, new KeyPool(upstream.auth.keys.map((key) => resolveEnvValue(key, env))))
      }
      return createTransport(upstream, pools, logger, env)
    },
    persistConfig: async (next) => {
      // Serialize, persist, then re-parse what is on disk: what runs is exactly
      // what a restart would read.
      const text = dumpConfig(next)
      writeFileAtomic(options.configPath, text)
      logger.info(`Config written to ${options.configPath}, reloading`)
      const reparsed = parseConfig(text, env)
      const stale = [...runtime.upstreams.values()]
      runtime.config = reparsed
      buildUpstreams()
      await Promise.allSettled(stale.map(async (transport) => transport.close()))
      options.onConfigChanged?.()
    },
  }

  const server: HttpServerHandle = createHttpServer({
    host: options.host,
    port: options.port,
    runtime,
    mcp: mcpDeps,
    admin: adminDeps,
    logger,
    env,
    adminHtmlPath: fileURLToPath(new URL('../static/index.html', import.meta.url)),
  })

  /** Spawn + handshake stdio upstreams so the first client probe does not pay cold start. */
  const prewarmStdio = async (): Promise<void> => {
    const stdio = [...runtime.upstreams.values()].filter(
      (transport): transport is StdioTransport => transport instanceof StdioTransport,
    )
    if (stdio.length === 0) return
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(stdio.map(async (transport) => transport.ensureProcess())),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STDIO_PREWARM_TIMEOUT * 1000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    // Whether the cap expired or a handshake failed, an unready transport may
    // still hold a spawned child; drop it so the next call spawns clean.
    await Promise.allSettled(stdio.map(async (transport) => transport.closeIfUnready()))
  }

  let closed = false
  return {
    runtime,
    configPath: options.configPath,
    deps: { mcp: mcpDeps, admin: adminDeps },

    address() {
      return server.address
    },

    async start() {
      const address = await server.start()
      await prewarmStdio()
      logger.info(
        `mcpp gateway listening at http://${address.host}:${address.port} `
        + `(config: ${options.configPath}, ${runtime.config.upstreams.length} upstreams)`,
      )
      return address
    },

    async close() {
      if (closed) return
      closed = true
      await server.close()
      await Promise.allSettled([...runtime.upstreams.values()].map(async (transport) => transport.close()))
      for (const transport of runtime.upstreams.values()) {
        if (transport instanceof StdioTransport) transport.killNowait()
      }
      runtime.upstreams.clear()
      runtime.keypools.clear()
    },
  }
}
