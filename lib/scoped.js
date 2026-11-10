import { n as createNativeToolSet } from "./native-tools-52yulkhF.js";
import z from "@deepseek-ai/schemastery";
//#region src/scoped.ts
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
/** Plugin name used by loader diagnostics. */
const name = "mcpp-scoped";
/** Plugin configuration, editable from a preset row in `cordis.patch.yml`. */
const Config = z.object({
	/** Tool names to register, in any spelling the gateway resolves. */
	tools: z.array(z.string()).default([]).description("Tools to register: public name (mcp__search__searxng), display name (searxng), or stable key (search/searxng_search)"),
	/** Aggregated servers whose whole tool set is registered. */
	toolsets: z.array(z.string()).default([]).description("Aggregated toolset names whose tools are all registered"),
	/** Names dropped after the include filters matched. */
	exclude: z.array(z.string()).default([]).description("Tools to leave out, in the same spellings as tools")
});
/** Hold activation until the gateway service and a tool registry are mounted. */
const inject = ["mcpp", "tools"];
/**
* Register the filter's tools into the current (preset) scope.
* @param ctx - scope context carrying the `mcpp` and `tools` services.
* @param config - validated row configuration.
* @returns registration readiness; the tools are live when this resolves.
* @throws when the filter matches no tool, so a typo fails the preset load.
*/
async function apply(ctx, config) {
	const entries = await ctx.mcpp.specs(config);
	if (entries.length === 0) throw new Error(`[mcpp-scoped] the tool filter matched no tools: ${JSON.stringify(config)}`);
	const logger = {
		info: (message) => {
			ctx.logger.info(message);
		},
		warn: (message) => {
			ctx.logger.warn(message);
		},
		error: (message) => {
			ctx.logger.error(message);
		}
	};
	const timeoutByName = new Map(entries.map((entry) => [entry.spec.publicName, entry.timeoutMs]));
	const set = createNativeToolSet({
		tools: ctx.tools,
		logger,
		call: (upstreamName, tool, args, signal) => ctx.mcpp.invoke(upstreamName, tool, args, signal),
		timeoutFor: (spec) => timeoutByName.get(spec.publicName)
	});
	set.sync(entries.map((entry) => entry.spec));
	ctx.effect(() => () => {
		set.dispose();
	}, "mcpp-scoped.tools");
	logger.info(`mcpp-scoped: ${entries.length} tools registered in this preset scope`);
}
//#endregion
export { Config, apply, inject, name };
