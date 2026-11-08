/**
 * Cordis plugin entry for the mcpp gateway.
 *
 * One row in a profile's `cordis.patch.yml` starts one gateway listener. The
 * plugin owns no configuration of its own beyond where the retired service's
 * YAML lives and what it binds: every upstream, expose entry, naming mode, and
 * gateway token still comes from that document, so the two implementations are
 * interchangeable without touching a single client configuration.
 *
 * @module
 */

import z from '@deepseek-ai/schemastery'
import { createGateway } from './bootstrap.ts'
import type { Logger } from './types.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'mcpp'

/**
 * The subset of the Cordis context this plugin uses. Declaring it locally keeps
 * the bundle free of a Cordis dependency (the host provides the instance).
 */
export interface PluginContext {
  logger: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  /**
   * Register a lifecycle effect; the callback returns its disposer. An async
   * effect body is awaited by the host, so activation finishes only once the
   * listener is bound.
   */
  effect(execute: () => Promise<() => Promise<void>>, label: string): Promise<unknown>
}

/** Plugin configuration, editable from the profile's `cordis.patch.yml`. */
export const Config = z.object({
  /** Absolute path of the mcpp `config.yaml` this gateway serves. */
  configPath: z.string().required().description('Path of the mcpp YAML configuration to serve'),
  /** Listen address; keep it on loopback unless the network is trusted. */
  host: z.string().default('127.0.0.1').description('Listen address for the MCP endpoints'),
  /** Listen port shared with the retired service, so client configs keep working. */
  port: z.natural().max(65535).default(9020).description('Listen port'),
})

/** Resolved plugin configuration after Schemastery defaults. */
export interface ResolvedConfig {
  configPath: string
  host: string
  port: number
}

/**
 * Start the gateway for this profile and release it on disposal.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 * @returns activation readiness: the listener is bound when this resolves.
 */
export async function apply(ctx: PluginContext, config: ResolvedConfig): Promise<void> {
  const logger: Logger = {
    info: (message) => { ctx.logger.info(message) },
    warn: (message) => { ctx.logger.warn(message) },
    error: (message) => { ctx.logger.error(message) },
  }
  const gateway = createGateway({
    configPath: config.configPath,
    host: config.host,
    port: config.port,
    logger,
  })

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
    return async () => { await gateway.close() }
  }, 'mcpp.gateway')
}
