/**
 * Per-client tool-name formats and connection presets, ported from the retired
 * service's `client-presets.yaml`.
 *
 * The presets are embedded as data rather than read from YAML: the plugin ships
 * as one bundled artifact, and the catalogue changes with the client ecosystem
 * rather than with deployment. `naming_modes[].format` is the single source of
 * truth; the endpoint path per mode is `/<toolset>/<naming>/mcp`, and
 * `/mcp` stays as the legacy alias for the default naming.
 *
 * @module
 */

import type { ClientFormat } from './types.ts'

/** One naming mode as declared in the preset catalogue. */
export interface NamingMode {
  format: string
  sample: string
}

/** One connection-preset template (for the admin UI's copy-paste panel). */
export interface ConnectMode {
  file: string
  template: string
}

/**
 * Template-driven naming strategy: `{server}`/`{tool}` are the only
 * placeholders, everything else is literal. The inverse regex makes
 * `{server}` non-greedy and `{tool}` greedy, which round-trips as long as the
 * separator characters do not appear inside tool names.
 */
export class TemplateFormat implements ClientFormat {
  readonly namingId: string
  private readonly format: string
  private readonly pattern: RegExp

  /**
   * @param namingId - catalogue id, also the endpoint path segment.
   * @param format - template such as `mcp__{server}__{tool}`.
   */
  constructor(namingId: string, format: string) {
    this.namingId = namingId
    this.format = format
    let source = '^'
    for (const part of format.split(/(\{server\}|\{tool\})/)) {
      if (part === '{server}') source += '(?<server>.+?)'
      else if (part === '{tool}') source += '(?<tool>.+)'
      else source += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    this.pattern = new RegExp(source + '$')
  }

  /** Expand the template with the server and tool-name segments. */
  formatName(server: string, displayName: string): string {
    return this.format.replace('{server}', server).replace('{tool}', displayName)
  }

  /** Recover the tool segment when the formatted name belongs to `server`. */
  parseName(server: string, formatted: string): string | null {
    const match = this.pattern.exec(formatted)
    if (match === null) return null
    if (match.groups?.['server'] !== server) return null
    const tool = match.groups?.['tool']
    return tool === undefined || tool === '' ? null : tool
  }
}

/**
 * Raw passthrough: the client-visible name is the expose display name. Kept
 * distinct from a `{tool}` template because that template would match any
 * string on parse, which is not what the default mode means.
 */
export class DefaultFormat implements ClientFormat {
  readonly namingId = 'default'

  /** The display name is already the client-visible name. */
  formatName(_server: string, displayName: string): string {
    return displayName
  }

  /** Always defer to the caller's key/display-name fallback. */
  parseName(_server: string, _formatted: string): string | null {
    return null
  }
}

/** Naming-mode catalogue; `default` is handled by {@link DefaultFormat}. */
export const NAMING_MODES: Record<string, NamingMode> = {
  claude: { format: 'mcp__{server}__{tool}', sample: 'mcp__search__papers' },
  cursor: { format: 'mcp_{server}_{tool}', sample: 'mcp_search_papers' },
  opencode: { format: '{server}_{tool}', sample: 'search_papers' },
  coder: { format: '{server}__{tool}', sample: 'search__papers' },
  codex: { format: '{server}::{tool}', sample: 'search::papers' },
  default: { format: '{tool}', sample: 'papers' },
}

/** Connection-preset templates the admin UI renders for each client. */
export const CONNECT_MODES: Record<string, ConnectMode> = {
  claude: {
    file: '~/.claude.json 或 claude_desktop_config.json',
    template: `{
  "mcpServers": {
    "{toolset}": {
      "type": "http",
      "url": "{endpoint}"{token_header}
    }
  }
}
`,
  },
  cursor: {
    file: '~/.cursor/mcp.json',
    template: `{
  "mcpServers": {
    "{toolset}": {
      "url": "{endpoint}",
      "transport": { "type": "streamableHttp" }{token_header}
    }
  }
}
`,
  },
  opencode: {
    file: 'opencode.json 或 ~/.config/opencode/opencode.json',
    template: `{
  "mcp": {
    "{toolset}": {
      "type": "remote",
      "url": "{endpoint}"{token_header}
    }
  }
}
`,
  },
  codex: {
    file: '~/.codex/config.toml',
    template: `[mcp_servers.{toolset}]
url = "{endpoint}"
# put the token in an env var, then reference it:
bearer_token_env_var = "MCP_TOKEN"
`,
  },
  hermes: {
    file: '~/.hermes/config.yaml',
    template: `mcp_servers:
  {toolset}:
    url: "{endpoint}"
    headers:
      Authorization: "Bearer {token}"
`,
  },
  openclaw: {
    file: '~/.openclaw/openclaw.json',
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
`,
  },
}

/**
 * Client catalogue: each client picks one naming mode and one connect mode.
 * Comments from the YAML carry over as `note` so the admin payload stays
 * self-describing.
 */
export const CLIENT_PRESETS: Record<string, { naming: string; connect: string; note?: string }> = {
  'claude-code': { naming: 'claude', connect: 'claude' },
  'claude-desktop': { naming: 'claude', connect: 'claude' },
  cursor: { naming: 'cursor', connect: 'cursor' },
  opencode: { naming: 'opencode', connect: 'opencode' },
  reasonix: { naming: 'claude', connect: 'codex', note: 'claude-like naming, TOML connect' },
  coder: { naming: 'coder', connect: 'claude', note: 'serverName__toolName' },
  trae: { naming: 'cursor', connect: 'claude', note: 'naming unverified; cursor-like assumed' },
  codex: { naming: 'codex', connect: 'codex', note: 'namespace+name pair; :: stand-in' },
  hermes: { naming: 'cursor', connect: 'hermes' },
  pi: { naming: 'opencode', connect: 'claude' },
  workbuddy: { naming: 'claude', connect: 'claude' },
  openclaw: { naming: 'coder', connect: 'openclaw' },
}

/** Format registry: `default` plus one template strategy per other mode. */
export const FORMAT_REGISTRY: Record<string, ClientFormat> = (() => {
  const registry: Record<string, ClientFormat> = { default: new DefaultFormat() }
  for (const [id, mode] of Object.entries(NAMING_MODES)) {
    if (id === 'default') continue
    registry[id] = new TemplateFormat(id, mode.format)
  }
  return registry
})()

/** Endpoint path per naming mode; the `{toolset}` placeholder is resolved by the router. */
export const CLIENT_ROUTES: Record<string, string> = Object.fromEntries(
  Object.keys(FORMAT_REGISTRY).map((id) => [id, `/{toolset}/${id}/mcp`]),
)

/** Bare paths mapping to (naming mode, default toolset). */
export const LEGACY_ALIASES: Record<string, string> = { '/mcp': 'default' }

/**
 * Resolve a naming mode, falling back to the default strategy.
 * @param namingId - path segment from the request.
 * @returns the strategy (never undefined).
 */
export function getFormat(namingId: string): ClientFormat {
  return FORMAT_REGISTRY[namingId] ?? FORMAT_REGISTRY['default']!
}

/**
 * The raw preset catalogue in the shape `/api/client-presets` returns.
 *
 * Notes are code comments, not payload: the retired service's clients section
 * carried only `naming` and `connect`, so the response must too.
 * @returns naming modes (with endpoint paths), connect modes, and clients.
 */
export function presets(): {
  naming_modes: Record<string, { format: string; sample: string; endpoint_path: string | undefined }>
  connect_modes: Record<string, ConnectMode>
  clients: Record<string, { naming: string; connect: string }>
} {
  const namingModes: Record<string, { format: string; sample: string; endpoint_path: string | undefined }> = {}
  for (const [id, mode] of Object.entries(NAMING_MODES)) {
    namingModes[id] = { format: mode.format, sample: mode.sample, endpoint_path: CLIENT_ROUTES[id] }
  }
  const clients: Record<string, { naming: string; connect: string }> = {}
  for (const [id, entry] of Object.entries(CLIENT_PRESETS)) {
    clients[id] = { naming: entry.naming, connect: entry.connect }
  }
  return { naming_modes: namingModes, connect_modes: CONNECT_MODES, clients }
}

/** Naming modes served at `/{toolset}/{naming}/mcp`, in catalogue order. */
export const NAMING_IDS = Object.keys(FORMAT_REGISTRY)
