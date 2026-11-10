//#region src/errors.ts
/**
* Typed failures of the gateway. Each one carries the layer that owns the
* handling decision, so callers never string-match a message.
*/
/** A configuration document that violates the model or its cross-references. */
var ConfigError = class extends Error {
	name = "ConfigError";
};
/**
* An HTTP-level upstream failure. `status` is the upstream's status code so the
* MCP layer can rotate the key pool on 401/403/429 while still reporting the
* failure to the client.
*/
var UpstreamHttpError = class extends Error {
	name = "UpstreamHttpError";
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
	}
};
/** A JSON-RPC error answered by the upstream server itself. */
var UpstreamRpcError = class extends Error {
	name = "UpstreamRpcError";
};
/** A downstream argument that no configured transform accepts. */
var ParamError = class extends Error {
	name = "ParamError";
};
/** A transport-level failure that is not an HTTP status (reset, EOF, timeout). */
var UpstreamTransportError = class extends Error {
	name = "UpstreamTransportError";
};
//#endregion
//#region src/presets.ts
/**
* Template-driven naming strategy: `{server}`/`{tool}` are the only
* placeholders, everything else is literal. The inverse regex makes
* `{server}` non-greedy and `{tool}` greedy, which round-trips as long as the
* separator characters do not appear inside tool names.
*/
var TemplateFormat = class {
	namingId;
	format;
	pattern;
	/**
	* @param namingId - catalogue id, also the endpoint path segment.
	* @param format - template such as `mcp__{server}__{tool}`.
	*/
	constructor(namingId, format) {
		this.namingId = namingId;
		this.format = format;
		let source = "^";
		for (const part of format.split(/(\{server\}|\{tool\})/)) if (part === "{server}") source += "(?<server>.+?)";
		else if (part === "{tool}") source += "(?<tool>.+)";
		else source += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		this.pattern = new RegExp(source + "$");
	}
	/** Expand the template with the server and tool-name segments. */
	formatName(server, displayName) {
		return this.format.replace("{server}", server).replace("{tool}", displayName);
	}
	/** Recover the tool segment when the formatted name belongs to `server`. */
	parseName(server, formatted) {
		const match = this.pattern.exec(formatted);
		if (match === null) return null;
		if (match.groups?.["server"] !== server) return null;
		const tool = match.groups?.["tool"];
		return tool === void 0 || tool === "" ? null : tool;
	}
};
/**
* Raw passthrough: the client-visible name is the expose display name. Kept
* distinct from a `{tool}` template because that template would match any
* string on parse, which is not what the default mode means.
*/
var DefaultFormat = class {
	namingId = "default";
	/** The display name is already the client-visible name. */
	formatName(_server, displayName) {
		return displayName;
	}
	/** Always defer to the caller's key/display-name fallback. */
	parseName(_server, _formatted) {
		return null;
	}
};
/** Naming-mode catalogue; `default` is handled by {@link DefaultFormat}. */
const NAMING_MODES = {
	claude: {
		format: "mcp__{server}__{tool}",
		sample: "mcp__search__papers"
	},
	cursor: {
		format: "mcp_{server}_{tool}",
		sample: "mcp_search_papers"
	},
	opencode: {
		format: "{server}_{tool}",
		sample: "search_papers"
	},
	coder: {
		format: "{server}__{tool}",
		sample: "search__papers"
	},
	codex: {
		format: "{server}::{tool}",
		sample: "search::papers"
	},
	default: {
		format: "{tool}",
		sample: "papers"
	}
};
/** Connection-preset templates the admin UI renders for each client. */
const CONNECT_MODES = {
	claude: {
		file: "~/.claude.json 或 claude_desktop_config.json",
		template: `{
  "mcpServers": {
    "{toolset}": {
      "type": "http",
      "url": "{endpoint}"{token_header}
    }
  }
}
`
	},
	cursor: {
		file: "~/.cursor/mcp.json",
		template: `{
  "mcpServers": {
    "{toolset}": {
      "url": "{endpoint}",
      "transport": { "type": "streamableHttp" }{token_header}
    }
  }
}
`
	},
	opencode: {
		file: "opencode.json 或 ~/.config/opencode/opencode.json",
		template: `{
  "mcp": {
    "{toolset}": {
      "type": "remote",
      "url": "{endpoint}"{token_header}
    }
  }
}
`
	},
	codex: {
		file: "~/.codex/config.toml",
		template: `[mcp_servers.{toolset}]
url = "{endpoint}"
# put the token in an env var, then reference it:
bearer_token_env_var = "MCP_TOKEN"
`
	},
	hermes: {
		file: "~/.hermes/config.yaml",
		template: `mcp_servers:
  {toolset}:
    url: "{endpoint}"
    headers:
      Authorization: "Bearer {token}"
`
	},
	openclaw: {
		file: "~/.openclaw/openclaw.json",
		template: `{
  "mcp": {
    "servers": {
      "{toolset}": {
        "url": "{endpoint}",
        "transport": "streamable-http"{token_header}
      }
    }
  }
}
`
	}
};
/**
* Client catalogue: each client picks one naming mode and one connect mode.
* Comments from the YAML carry over as `note` so the admin payload stays
* self-describing.
*/
const CLIENT_PRESETS = {
	"claude-code": {
		naming: "claude",
		connect: "claude"
	},
	"claude-desktop": {
		naming: "claude",
		connect: "claude"
	},
	cursor: {
		naming: "cursor",
		connect: "cursor"
	},
	opencode: {
		naming: "opencode",
		connect: "opencode"
	},
	reasonix: {
		naming: "claude",
		connect: "codex",
		note: "claude-like naming, TOML connect"
	},
	coder: {
		naming: "coder",
		connect: "claude",
		note: "serverName__toolName"
	},
	trae: {
		naming: "cursor",
		connect: "claude",
		note: "naming unverified; cursor-like assumed"
	},
	codex: {
		naming: "codex",
		connect: "codex",
		note: "namespace+name pair; :: stand-in"
	},
	hermes: {
		naming: "cursor",
		connect: "hermes"
	},
	pi: {
		naming: "opencode",
		connect: "claude"
	},
	workbuddy: {
		naming: "claude",
		connect: "claude"
	},
	openclaw: {
		naming: "coder",
		connect: "openclaw"
	}
};
/** Format registry: `default` plus one template strategy per other mode. */
const FORMAT_REGISTRY = (() => {
	const registry = { default: new DefaultFormat() };
	for (const [id, mode] of Object.entries(NAMING_MODES)) {
		if (id === "default") continue;
		registry[id] = new TemplateFormat(id, mode.format);
	}
	return registry;
})();
/** Endpoint path per naming mode; the `{toolset}` placeholder is resolved by the router. */
const CLIENT_ROUTES = Object.fromEntries(Object.keys(FORMAT_REGISTRY).map((id) => [id, `/{toolset}/${id}/mcp`]));
/**
* Resolve a naming mode, falling back to the default strategy.
* @param namingId - path segment from the request.
* @returns the strategy (never undefined).
*/
function getFormat(namingId) {
	return FORMAT_REGISTRY[namingId] ?? FORMAT_REGISTRY["default"];
}
/**
* The raw preset catalogue in the shape `/api/client-presets` returns.
*
* Notes are code comments, not payload: the retired service's clients section
* carried only `naming` and `connect`, so the response must too.
* @returns naming modes (with endpoint paths), connect modes, and clients.
*/
function presets() {
	const namingModes = {};
	for (const [id, mode] of Object.entries(NAMING_MODES)) namingModes[id] = {
		format: mode.format,
		sample: mode.sample,
		endpoint_path: CLIENT_ROUTES[id]
	};
	const clients = {};
	for (const [id, entry] of Object.entries(CLIENT_PRESETS)) clients[id] = {
		naming: entry.naming,
		connect: entry.connect
	};
	return {
		naming_modes: namingModes,
		connect_modes: CONNECT_MODES,
		clients
	};
}
/** Naming modes served at `/{toolset}/{naming}/mcp`, in catalogue order. */
const NAMING_IDS = Object.keys(FORMAT_REGISTRY);
//#endregion
//#region src/transform.ts
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
/** One backtick-quoted token from a description (`BACKTICK_REF` in the old model). */
const BACKTICK_REF = /`(\S+)`/g;
/**
* Narrow a JSON value to an object.
* @param value - value to check.
* @returns whether it is a non-array object.
*/
function isMapping(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Whether a map has at least one key (a truthiness check on the old models).
* @param map - map to inspect; absent maps are falsy.
* @returns whether the map is present and non-empty.
*/
function hasKeys(map) {
	return map !== void 0 && map !== null && Object.keys(map).length > 0;
}
/**
* Format a rejected downstream value the way the old service's f-string did.
* @param value - value the client sent.
* @returns a bare rendering of the value.
*/
function renderValue(value) {
	return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}
/**
* Format an allowed-value list the way Python's `list(dict)` repr did.
* @param values - allowed keys, in configured order.
* @returns the bracketed, quoted list.
*/
function renderAllowed(values) {
	return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}
/**
* Display name of one expose entry: `as` when set, else the key's last segment.
* @param entry - expose entry.
* @param key - stable `upstream/tool` key.
* @returns the downstream display name.
*/
function displayName(entry, key) {
	return entry.as ?? key.slice(key.lastIndexOf("/") + 1);
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
function buildDownstreamSchema(entry, upstreamSchema) {
	if (entry.params === void 0) return upstreamSchema;
	const upstream = upstreamSchema ?? {};
	const upstreamProps = isMapping(upstream["properties"]) ? upstream["properties"] : {};
	const upstreamRequiredRaw = upstream["required"];
	const upstreamRequired = Array.isArray(upstreamRequiredRaw) ? upstreamRequiredRaw.filter((name) => typeof name === "string") : [];
	const properties = {};
	const required = [];
	for (const param of entry.params) {
		if (param.hidden) continue;
		const upstreamName = param.mapFrom ?? param.name;
		const candidate = upstreamProps[upstreamName];
		const upstreamParam = isMapping(candidate) ? candidate : {};
		const prop = Object.keys(upstreamParam).length === 0 ? { type: "string" } : { ...upstreamParam };
		const description = param.description || readDescription(upstreamParam);
		if (description) prop["description"] = description;
		const enumKeys = param.mapping === void 0 || param.mapping === null ? [] : Object.keys(param.mapping);
		const presetKeys = param.preset === void 0 || param.preset === null ? [] : Object.keys(param.preset);
		if (param.type === "enum" && enumKeys.length > 0) {
			prop["type"] = "string";
			prop["enum"] = enumKeys;
		} else if (param.type === "preset" && presetKeys.length > 0) {
			prop["type"] = "string";
			prop["enum"] = presetKeys;
		}
		properties[param.name] = prop;
		if (param.required ?? upstreamRequired.includes(upstreamName)) required.push(param.name);
	}
	const schema = {
		type: "object",
		properties
	};
	if (required.length > 0) schema["required"] = required;
	return schema;
}
/**
* Read an upstream property's description when it is a string.
* @param upstreamParam - upstream property schema.
* @returns the description, or an empty string.
*/
function readDescription(upstreamParam) {
	const description = upstreamParam["description"];
	return typeof description === "string" ? description : "";
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
function paramTransformValue(rawArgs, entry) {
	if (entry.params === void 0) return rawArgs;
	const upstream = {};
	for (const param of entry.params) {
		const upstreamName = param.mapFrom ?? param.name;
		if (param.hidden) {
			if (param.default !== void 0 && param.default !== null) upstream[upstreamName] = param.default;
			continue;
		}
		const value = rawArgs[param.name];
		if (value === void 0 || value === null) continue;
		const mapping = param.mapping;
		const preset = param.preset;
		if (param.type === "enum" && hasKeys(mapping)) if (typeof value === "string" && Object.hasOwn(mapping, value)) upstream[upstreamName] = mapping[value];
		else throw new ParamError(`Invalid value '${renderValue(value)}' for enum param '${param.name}'. Valid: ${renderAllowed(Object.keys(mapping))}`);
		else if (param.type === "preset" && hasKeys(preset)) if (typeof value === "string" && Object.hasOwn(preset, value)) Object.assign(upstream, preset[value]);
		else throw new ParamError(`Invalid value '${renderValue(value)}' for preset param '${param.name}'. Valid: ${renderAllowed(Object.keys(preset))}`);
		else upstream[upstreamName] = value;
	}
	return upstream;
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
function resolveBackticks(description, refs, format) {
	return description.replace(BACKTICK_REF, (match, ref) => {
		const hit = refs.get(ref);
		if (hit === void 0) return match;
		return `\`${format.formatName(hit[0], hit[1])}\``;
	});
}
/**
* Composite map key for one `(upstream, tool)` pair.
* @param upstreamName - upstream name.
* @param toolName - upstream tool name.
* @returns the composite key.
*/
function upstreamToolKey(upstreamName, toolName) {
	return `${upstreamName}\u0000${toolName}`;
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
function transformTools(upstreamName, tools, config, client = "default", toolset) {
	const byUpstreamTool = /* @__PURE__ */ new Map();
	const displayNames = /* @__PURE__ */ new Map();
	const refs = /* @__PURE__ */ new Map();
	for (const [key, entry] of Object.entries(config.expose)) {
		const name = displayName(entry, key);
		byUpstreamTool.set(upstreamToolKey(entry.upstream, entry.tool), [key, entry]);
		displayNames.set(key, name);
		refs.set(key, [entry.toolset ?? config.serverName, name]);
	}
	const format = getFormat(client);
	const result = [];
	for (const tool of tools) {
		const lookup = byUpstreamTool.get(upstreamToolKey(upstreamName, tool.name));
		if (lookup === void 0) continue;
		const [key, entry] = lookup;
		if (entry.hide) continue;
		const resolvedToolset = entry.toolset ?? config.serverName;
		if (toolset !== void 0 && resolvedToolset !== toolset) continue;
		const name = displayNames.get(key) ?? tool.name;
		const description = resolveBackticks(entry.description ?? tool.description ?? "", refs, format);
		const inputSchema = buildDownstreamSchema(entry, tool.inputSchema);
		result.push({
			name: format.formatName(resolvedToolset, name),
			description,
			inputSchema
		});
	}
	return result;
}
//#endregion
//#region src/native-tools.ts
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
/** Placeholder for a result that legitimately carried no model-visible content. */
const EMPTY_CONTENT = "(tool returned no model-visible content)";
/**
* Narrow an unknown JSON value to a string-keyed object.
* @param value - value to check.
* @returns whether it is a non-null, non-array object.
*/
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Read one field of a JSON object when it is a string.
* @param record - object to read.
* @param field - field name.
* @returns the string value, or undefined for an absent/non-string field.
*/
function stringField(record, field) {
	const value = record[field];
	return typeof value === "string" ? value : void 0;
}
/**
* Compact placeholder for a non-text media block. The mime type is shortened to
* its subtype so `image/png` reads as `[image png]`, matching the diagnostic
* the mcp-client bridge produces for blocks it cannot admit.
* @param family - block family used as the placeholder label.
* @param mimeType - declared media type, when the upstream sent one.
* @returns the bracketed placeholder.
*/
function mediaPlaceholder(family, mimeType) {
	const slash = mimeType?.indexOf("/") ?? -1;
	return `[${family} ${(mimeType === void 0 ? void 0 : slash >= 0 ? mimeType.slice(slash + 1) : mimeType) ?? "unknown"}]`;
}
/**
* Project one MCP content block to its model-visible text line.
* @param block - raw block from the upstream result.
* @returns the line, always defined.
*/
function blockText(block) {
	if (!isRecord(block)) return "[unsupported MCP content block: expected an object]";
	const type = block["type"];
	if (type === "text") return stringField(block, "text") ?? "";
	if (type === "image" || type === "audio") return mediaPlaceholder(type, stringField(block, "mimeType"));
	if (type === "resource") return "[embedded resource]";
	if (type === "resource_link") {
		const name = stringField(block, "name");
		const uri = stringField(block, "uri");
		return name !== void 0 && uri !== void 0 ? `Resource link: ${name} (${uri})` : "[resource link unavailable: the MCP block is missing its name or URI]";
	}
	return `[unsupported MCP content type: ${typeof type === "string" ? type : "unknown"}]`;
}
/**
* Project a canonical MCP result value to one model-visible string: text blocks
* join by line, other block families become placeholders, and an empty result
* becomes an explicit no-content marker.
* @param value - canonical `{content, structuredContent?}` value.
* @returns the projected text.
*/
function projectContentText(value) {
	const content = isRecord(value) && Array.isArray(value["content"]) ? value["content"] : [];
	const lines = [];
	for (const block of content) {
		const text = blockText(block);
		if (text !== "") lines.push(text);
	}
	return lines.length === 0 ? EMPTY_CONTENT : lines.join("\n");
}
/**
* The canonical output schema every native tool declares.
* @returns a fresh JSON Schema value for `{content, structuredContent?}`.
*/
function outputSchema() {
	return {
		type: "object",
		properties: {
			content: {
				type: "array",
				items: {}
			},
			structuredContent: {}
		},
		required: ["content"],
		additionalProperties: false
	};
}
/**
* Argument schema for a tool whose upstream advertised no `inputSchema`.
* @returns an empty JSON object schema.
*/
function emptyParameters() {
	return {
		type: "object",
		properties: {}
	};
}
/**
* Pure output projection: raw supported JSON value -> one model-visible text block.
* @param _args - validated arguments (unused; projection depends on the value only).
* @param value - validated canonical value.
* @returns the single text content block.
*/
function renderOutput(_args, value) {
	return [{
		type: "text",
		text: projectContentText(value)
	}];
}
/**
* Render one thrown value as a registration error message.
* @param error - thrown value.
* @returns the error message, or the stringified value.
*/
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Serialize a JSON-ish value with object keys in sorted order, so equal content
* yields an equal string regardless of construction order.
* @param value - value to serialize.
* @returns the canonical serialization.
*/
function stableSerialize(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
	return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
}
/**
* Content identity of one desired registration. A changed identity means the old
* definition must be disposed and the new one registered.
* @param spec - desired tool spec.
* @param timeoutMs - deadline the definition would carry.
* @returns the stable identity string.
*/
function specHash(spec, timeoutMs) {
	return stableSerialize({
		name: spec.publicName,
		description: spec.description,
		schema: spec.inputSchema ?? null,
		key: spec.key,
		upstream: spec.upstreamName,
		tool: spec.entry.tool,
		timeoutMs: timeoutMs ?? null
	});
}
/**
* Collect every exposed tool of a configuration as a native spec.
* @param config - gateway configuration.
* @param upstreamTools - raw tool lists keyed by upstream name.
* @returns one spec per non-hidden expose entry whose upstream tool is live.
*/
function collectNativeToolSpecs(config, upstreamTools) {
	const format = getFormat("claude");
	const transformedByUpstream = /* @__PURE__ */ new Map();
	const specs = [];
	for (const [key, entry] of Object.entries(config.expose)) {
		if (entry.hide) continue;
		let transformed = transformedByUpstream.get(entry.upstream);
		if (transformed === void 0) {
			const rawTools = upstreamTools.get(entry.upstream) ?? [];
			transformed = new Map(transformTools(entry.upstream, rawTools, config, "claude").map((tool) => [tool.name, tool]));
			transformedByUpstream.set(entry.upstream, transformed);
		}
		const toolset = entry.toolset ?? config.serverName;
		const publicName = format.formatName(toolset, displayName(entry, key));
		const source = transformed.get(publicName);
		if (source === void 0) continue;
		const spec = {
			publicName,
			key,
			toolset,
			description: source.description ?? "",
			upstreamName: entry.upstream,
			entry
		};
		if (source.inputSchema !== void 0) spec.inputSchema = source.inputSchema;
		specs.push(spec);
	}
	return specs;
}
/**
* Filter specs by their stable expose keys, the selection document's unit.
* @param specs - candidate specs.
* @param enabledKeys - stable `upstream/tool` keys that stay enabled.
* @returns the specs whose key is enabled, in their original order.
*/
function selectSpecs(specs, enabledKeys) {
	const enabled = new Set(enabledKeys);
	return specs.filter((spec) => enabled.has(spec.key));
}
/**
* Build one DSH tool definition from a spec. Exported so a preset-scoped
* surface can reuse the exact same adapter the global surface registers.
* @param deps - call path and registry dependencies.
* @param spec - desired tool.
* @param timeoutMs - precomputed deadline; undefined omits the field.
* @returns the definition to register.
*/
function buildNativeDefinition(deps, spec, timeoutMs) {
	const execute = async (args, exec) => {
		const upstreamArgs = paramTransformValue(isRecord(args) ? args : {}, spec.entry);
		const result = await deps.call(spec.upstreamName, spec.entry.tool, upstreamArgs, exec.signal);
		if (result["isError"] === true) throw new Error(projectContentText(result));
		const content = result["content"];
		const structuredContent = result["structuredContent"];
		return {
			content: content === void 0 ? [] : content,
			...structuredContent !== void 0 ? { structuredContent } : {}
		};
	};
	return {
		name: spec.publicName,
		description: spec.description,
		parameters: spec.inputSchema ?? emptyParameters(),
		output: {
			schema: outputSchema(),
			render: renderOutput
		},
		execute,
		...timeoutMs !== void 0 ? { timeoutMs } : {}
	};
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
function createNativeToolSet(deps) {
	const live = /* @__PURE__ */ new Map();
	let lastErrors = [];
	const retire = (name) => {
		const registration = live.get(name);
		if (registration === void 0) return;
		live.delete(name);
		try {
			registration.dispose();
		} catch (error) {
			deps.logger.warn(`native-tools: disposing "${name}" failed: ${messageOf(error)}`);
		}
	};
	return {
		sync(specs) {
			const desired = /* @__PURE__ */ new Map();
			for (const spec of specs) {
				const timeoutMs = deps.timeoutFor?.(spec);
				desired.set(spec.publicName, {
					spec,
					hash: specHash(spec, timeoutMs),
					timeoutMs
				});
			}
			for (const name of [...live.keys()]) if (!desired.has(name)) retire(name);
			const errors = [];
			for (const [name, { spec, hash, timeoutMs }] of desired) {
				const registration = live.get(name);
				if (registration !== void 0 && registration.hash === hash) continue;
				if (registration !== void 0) retire(name);
				try {
					live.set(name, {
						hash,
						dispose: deps.tools.register(buildNativeDefinition(deps, spec, timeoutMs))
					});
				} catch (error) {
					const message = messageOf(error);
					errors.push({
						name,
						message
					});
					deps.logger.warn(`native-tools: cannot register "${name}": ${message}`);
				}
			}
			lastErrors = errors;
			return {
				registered: [...live.keys()],
				errors: [...errors]
			};
		},
		dispose() {
			for (const name of [...live.keys()]) retire(name);
			lastErrors = [];
		},
		registeredNames() {
			return [...live.keys()];
		},
		errors() {
			return [...lastErrors];
		}
	};
}
//#endregion
export { paramTransformValue as a, getFormat as c, ParamError as d, UpstreamHttpError as f, displayName as i, presets as l, UpstreamTransportError as m, createNativeToolSet as n, transformTools as o, UpstreamRpcError as p, selectSpecs as r, NAMING_IDS as s, collectNativeToolSpecs as t, ConfigError as u };
