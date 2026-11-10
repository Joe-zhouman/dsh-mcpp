/**
 * Cordis plugin entry for the mcpp gateway.
 *
 * One row in a profile's `cordis.patch.yml` starts one gateway listener and one
 * native tool surface. The plugin owns no configuration of its own beyond where
 * the retired service's YAML lives, what it binds, and where the tool-selection
 * document is kept: every upstream, expose entry, naming mode, and gateway token
 * still comes from that document, so the two implementations stay
 * interchangeable without touching a single external client configuration.
 *
 * Three surfaces are published from here:
 * - the HTTP gateway on its own port (external MCP clients),
 * - the native DSH tools (`mcp__<toolset>__<tool>`, no second MCP hop),
 * - the same-origin `/plugins/mcpp/**` routes plus the `ctx.mcpp` service.
 *
 * @module
 */

import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { createGateway } from './bootstrap.ts'
import { registerDshRoutes } from './dsh-routes.ts'
import {
  collectNativeToolSpecs,
  createNativeToolSet,
  selectSpecs,
  type NativeToolError,
  type NativeToolSet,
} from './native-tools.ts'
import { createSelectionStore, selectionPathFromEnv } from './selection.ts'
import { createMcppService, gatewayToken } from './service.ts'
import type {
  DshConnectionService,
  DshPluginContext,
  DshToolsService,
  DshWebServer,
} from './dsh.ts'
import type { Logger, Tool } from './types.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'mcpp'

/** Plugin configuration, editable from the profile's `cordis.patch.yml`. */
export const Config = z.object({
  /** Absolute path of the mcpp `config.yaml` this gateway serves. */
  configPath: z.string().required().description('Path of the mcpp YAML configuration to serve'),
  /** Listen address; keep it on loopback unless the network is trusted. */
  host: z.string().default('127.0.0.1').description('Listen address for the MCP endpoints'),
  /** Listen port shared with the retired service, so client configs keep working. */
  port: z.natural().max(65535).default(9020).description('Listen port'),
  /** Register aggregated tools into the DSH tool registry (native surface). */
  nativeTools: z.boolean().default(true).description('Register selected tools into DSH natively'),
  /** Selection document path; empty means `<DSH_HOME>/storages/mcpp/selection.json`. */
  selectionPath: z.string().default('').description('Tool-selection document path override'),
})

/** Resolved plugin configuration after Schemastery defaults. */
export interface ResolvedConfig {
  configPath: string
  host: string
  port: number
  nativeTools: boolean
  selectionPath: string
}

/** Guard one promise with a deadline. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(message)) }, Math.max(1, timeoutMs))
    timer.unref?.()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Result of one native re-sync. */
interface SyncResult {
  registered: string[]
  errors: NativeToolError[]
}

/**
 * Start the gateway for this profile and release it on disposal.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 * @returns activation readiness: the listener is bound when this resolves.
 */
export async function apply(ctx: DshPluginContext, config: ResolvedConfig): Promise<void> {
  const logger: Logger = {
    info: (message) => { ctx.logger.info(message) },
    warn: (message) => { ctx.logger.warn(message) },
    error: (message) => { ctx.logger.error(message) },
  }

  const selectionPath = config.selectionPath === '' ? selectionPathFromEnv(process.env) : config.selectionPath
  const selection = createSelectionStore(selectionPath)

  let nativeSet: NativeToolSet | undefined
  let disposeRoutes: (() => void) | undefined
  let syncChain: Promise<SyncResult> = Promise.resolve({ registered: [], errors: [] })
  // Latest upstream tool snapshot from a successful sync, shared with the
  // `ctx.mcpp` service so a preset mount does not re-list every upstream.
  let rawToolSnapshot: Map<string, Tool[]> | undefined

  const gateway = createGateway({
    configPath: config.configPath,
    host: config.host,
    port: config.port,
    logger,
    // A configuration reload swaps upstreams; the native surface must follow.
    onConfigChanged: () => { void resync('config reload') },
  })

  /** Fetch every upstream's raw tool list, tolerating slow or broken upstreams. */
  const fetchRawTools = async (): Promise<Map<string, Tool[]>> => {
    const runtime = gateway.runtime
    const pairs = await Promise.all(runtime.config.upstreams.map(async (upstream) => {
      const transport = runtime.upstreams.get(upstream.name)
      if (transport === undefined) return [upstream.name, [] as Tool[]] as const
      try {
        const tools = await withTimeout(
          transport.listTools(),
          upstream.listTimeout * 1000,
          `Upstream '${upstream.name}' tools/list timed out after ${upstream.listTimeout}s`,
        )
        return [upstream.name, tools] as const
      } catch (error) {
        logger.warn(`mcpp native sync: upstream '${upstream.name}' failed: ${error instanceof Error ? error.message : String(error)}`)
        return [upstream.name, [] as Tool[]] as const
      }
    }))
    return new Map(pairs)
  }

  /** Rebuild the enabled native tool generation from disk + upstreams. */
  const resync = (reason: string): Promise<SyncResult> => {
    const run = async (): Promise<SyncResult> => {
      if (nativeSet === undefined) return { registered: [], errors: [] }
      const rawTools = await fetchRawTools()
      rawToolSnapshot = rawTools
      const specs = collectNativeToolSpecs(gateway.runtime.config, rawTools)
      const enabled = new Set((await selection.load()).enabled)
      const result = nativeSet.sync(selectSpecs(specs, enabled))
      logger.info(
        `mcpp native tools: ${result.registered.length} registered`
        + (result.errors.length === 0 ? '' : `, ${result.errors.length} failed`)
        + ` (${reason})`,
      )
      return result
    }
    const next = syncChain.then(run, run)
    syncChain = next.catch((): SyncResult => ({ registered: [], errors: [] }))
    return next
  }

  // The native surface only exists where a DSH tool registry is mounted. Like
  // the web server, that service belongs to a bundle row that may activate
  // after this one, so wait for it instead of reading it once.

  const nativeView = {
    registeredNames: () => nativeSet?.registeredNames() ?? [],
    errors: () => nativeSet?.errors() ?? [],
    resync: async () => {
      const result = await resync('ui')
      return { registered: result.registered, errors: result.errors }
    },
  }

  const adminHtmlPath = fileURLToPath(new URL('../static/index.html', import.meta.url))
  /** Resolved by the effect below once the listener is bound. */
  const gatewayStarted = Promise.withResolvers<void>()
  let disposed = false

  // A failed bind (port already taken by the retired service, or by a second
  // DSH instance) fails this activation with the actionable original error
  // instead of leaving a half-initialized gateway behind. Awaited so activation
  // reports only after the listener is actually bound.
  await ctx.effect(async () => {
    try {
      await gateway.start()
    } catch (error) {
      await gateway.close()
      throw error
    }
    gatewayStarted.resolve()
    return async () => {
      disposed = true
      disposeRoutes?.()
      disposeRoutes = undefined
      nativeSet?.dispose()
      nativeSet = undefined
      await gateway.close()
    }
  }, 'mcpp.gateway')

  // The host web server belongs to a bundle row that may activate after this
  // one, so wait for the service instead of reading it once at activation.

  if (config.nativeTools) {
    ctx.inject(['tools'], (scope) => {
      const toolsService = scope.get<DshToolsService>('tools')
      if (toolsService === undefined) return
      nativeSet = createNativeToolSet({
        tools: toolsService,
        logger,
        call: async (upstreamName, tool, args, signal) => {
          if (signal.aborted) throw new Error('[mcpp] the call was canceled before dispatch')
          const transport = gateway.runtime.upstreams.get(upstreamName)
          if (transport === undefined) throw new Error(`[mcpp] upstream '${upstreamName}' is not configured`)
          return await transport.callTool(tool, args)
        },
        timeoutFor: (spec) => {
          const upstream = gateway.runtime.config.upstreams.find((candidate) => candidate.name === spec.upstreamName)
          return upstream === undefined ? undefined : (upstream.readTimeout + 15) * 1000
        },
      })
      void gatewayStarted.promise.then(() => {
        if (disposed) return
        void resync('startup').catch((error: unknown) => {
          logger.warn(`mcpp native sync failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }).catch(() => undefined)
    })
  }

  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.get<DshWebServer>('webServer')
    if (webServer === undefined) return
    void gatewayStarted.promise.then(() => {
      if (disposed) return
      try {
        disposeRoutes = registerDshRoutes(webServer, {
          runtime: gateway.runtime,
          admin: gateway.deps.admin,
          native: nativeView,
          selection,
          logger,
          adminHtmlPath,
          publicOrigin: () => {
            const address = gateway.address()
            return address === undefined ? '' : `http://${address.host}:${address.port}`
          },
          token: () => gatewayToken(gateway.runtime, process.env),
          // Resolved per request: the connection service may also activate
          // later than this plugin.
          rejectRequest: (req) => ctx.get<DshConnectionService>('connection')?.requestRejection(req),
        })
        logger.info('mcpp: same-origin routes registered at /plugins/mcpp/*')
      } catch (error) {
        logger.error(`mcpp: same-origin routes failed to register: ${error instanceof Error ? error.message : String(error)}`)
      }
    }).catch((error: unknown) => {
      logger.warn(`mcpp: same-origin routes not registered: ${error instanceof Error ? error.message : String(error)}`)
    })
  })

  // Published only after activation, so a consumer never observes a service
  // whose gateway failed to bind.
  ctx.provide('mcpp', createMcppService({
    runtime: gateway.runtime,
    enabledKeys: async () => (await selection.load()).enabled,
    registeredNames: () => nativeSet?.registeredNames() ?? [],
    // Serve the sync snapshot when one exists; a preset that mounts before the
    // first sync pays for one live listing instead.
    rawTools: async () => rawToolSnapshot ?? await fetchRawTools(),
  }))
}
