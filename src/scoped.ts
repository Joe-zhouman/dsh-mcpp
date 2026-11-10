/**
 * Preset-scoped native tool registration: the entry a DSH agent preset uses to
 * compose its own `mcp__*` surface.
 *
 * A profile row registers aggregated tools globally for the main agent; this
 * row instead registers a declared subset into the calling scope, so two presets
 * can see different tools and the main agent sees none of them. Calls reuse the
 * host gateway's upstream transports through `ctx.mcpp.invoke` — there is no
 * second MCP hop, no gateway listener, and no selection document involved.
 *
 * The row depends on the host `mcpp` row: `inject` holds activation until both
 * the gateway service and this scope's tool registry are mounted.
 *
 * @module
 */

import z from '@deepseek-ai/schemastery'
import { createNativeToolSet } from './native-tools.ts'
import type { DshLogger, DshToolsService } from './dsh.ts'
import type { McppService } from './service.ts'
import type { Logger } from './types.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'mcpp-scoped'

/** Plugin configuration, editable from a preset row in `cordis.patch.yml`. */
export const Config = z.object({
  /** Tool names to register, in any spelling the gateway resolves. */
  tools: z.array(z.string()).default([]).description(
    'Tools to register: public name (mcp__search__searxng), display name (searxng), or stable key (search/searxng_search)',
  ),
  /** Aggregated servers whose whole tool set is registered. */
  toolsets: z.array(z.string()).default([]).description('Aggregated toolset names whose tools are all registered'),
  /** Names dropped after the include filters matched. */
  exclude: z.array(z.string()).default([]).description(
    'Tools to leave out, in the same spellings as tools',
  ),
})

/** Resolved plugin configuration after Schemastery defaults. */
export interface ScopedConfig {
  tools: string[]
  toolsets: string[]
  exclude: string[]
}

/** The context a preset row receives: injected services are direct properties. */
export interface ScopedPluginContext {
  logger: DshLogger
  /** Host gateway service (`inject: ['mcpp']`). */
  mcpp: McppService
  /** This scope's tool registry (`inject: ['tools']`). */
  tools: DshToolsService
  /**
   * Register a lifecycle effect; the callback returns its release function.
   * @param execute - effect body returning the disposer.
   * @param label - diagnostic label.
   */
  effect(execute: () => () => void, label: string): unknown
}

/** Hold activation until the gateway service and a tool registry are mounted. */
export const inject = ['mcpp', 'tools']

/**
 * Register the filter's tools into the current (preset) scope.
 * @param ctx - scope context carrying the `mcpp` and `tools` services.
 * @param config - validated row configuration.
 * @returns registration readiness; the tools are live when this resolves.
 * @throws when the filter matches no tool, so a typo fails the preset load.
 */
export async function apply(ctx: ScopedPluginContext, config: ScopedConfig): Promise<void> {
  const entries = await ctx.mcpp.specs(config)
  if (entries.length === 0) {
    throw new Error(`[mcpp-scoped] the tool filter matched no tools: ${JSON.stringify(config)}`)
  }

  const logger: Logger = {
    info: (message) => { ctx.logger.info(message) },
    warn: (message) => { ctx.logger.warn(message) },
    error: (message) => { ctx.logger.error(message) },
  }
  const timeoutByName = new Map(entries.map((entry) => [entry.spec.publicName, entry.timeoutMs]))

  const set = createNativeToolSet({
    tools: ctx.tools,
    logger,
    call: (upstreamName, tool, args, signal) => ctx.mcpp.invoke(upstreamName, tool, args, signal),
    timeoutFor: (spec) => timeoutByName.get(spec.publicName),
  })
  set.sync(entries.map((entry) => entry.spec))

  // The scope owns the registrations: leaving the preset (or the agent ending)
  // disposes the effect, which unregisters every tool this row added.
  ctx.effect(() => () => { set.dispose() }, 'mcpp-scoped.tools')
  logger.info(`mcpp-scoped: ${entries.length} tools registered in this preset scope`)
}
