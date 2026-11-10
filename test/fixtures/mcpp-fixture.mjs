/**
 * In-memory mcpp fixtures for the service and preset-scoped tests: a gateway
 * configuration over two upstreams plus one orphan upstream entry, the raw tool
 * lists those upstreams advertise, fake transports, and an `ctx.mcpp` service
 * built from all of them. Nothing listens on a port or spawns a child.
 */
import { CapturingLogger } from '../../src/logger.ts'
import { createMcppService } from '../../src/service.ts'

/**
 * Two configured upstreams with distinct read timeouts, a hidden entry, an
 * exposed entry whose upstream tool is not listed, and an entry whose upstream
 * is absent from the configuration.
 */
export const CONFIG = {
  serverName: 'mcpp',
  upstreams: [
    {
      name: 'search',
      transport: 'http',
      url: 'http://127.0.0.1:9/mcp',
      inheritEnv: [],
      connectTimeout: 30,
      readTimeout: 45,
      listTimeout: 20,
    },
    {
      name: 'academic',
      transport: 'http',
      url: 'http://127.0.0.1:10/mcp',
      inheritEnv: [],
      connectTimeout: 30,
      readTimeout: 60,
      listTimeout: 20,
    },
  ],
  expose: {
    'search/searxng_search': { upstream: 'search', tool: 'searxng', toolset: 'search', as: 'searxng' },
    'search/get_doc': { upstream: 'search', tool: 'get_doc', toolset: 'get', as: 'jina_markdown' },
    'academic/search_papers': { upstream: 'academic', tool: 'search_papers', toolset: 'academic' },
    'academic/hidden_tool': { upstream: 'academic', tool: 'hidden_tool', toolset: 'academic', hide: true },
    'search/unlisted': { upstream: 'search', tool: 'not_listed', toolset: 'search' },
    'ghost/thing': { upstream: 'ghost', tool: 'thing', toolset: 'mcpp' },
  },
}

/** Raw tool lists as the upstreams advertise them. */
export const RAW_TOOLS = new Map([
  ['search', [
    { name: 'searxng', description: 'Search the web' },
    {
      name: 'get_doc',
      description: 'Fetch a document',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ]],
  ['academic', [
    { name: 'search_papers', description: 'Search papers' },
    { name: 'hidden_tool', description: 'Internal' },
  ]],
  ['ghost', [{ name: 'thing', description: 'Orphan tool' }]],
])

/**
 * Fake upstream transport recording every call.
 * @param {string} name - upstream name.
 * @returns the transport with its recorded calls.
 */
export function createTransport(name) {
  const calls = []
  return {
    name,
    calls,
    async listTools() {
      return []
    },
    async callTool(tool, args) {
      calls.push({ tool, args })
      return { content: [{ type: 'text', text: `${name}:${tool}` }] }
    },
    async close() {},
  }
}

/**
 * Build a service over fake runtime state.
 * @returns the service, its transports, its runtime, and a raw-tools call counter.
 */
export function createFixture() {
  const transports = {
    search: createTransport('search'),
    academic: createTransport('academic'),
  }
  const rawToolCalls = { count: 0 }
  const runtime = {
    configPath: '<memory>',
    config: CONFIG,
    upstreams: new Map(Object.entries(transports)),
    keypools: new Map(),
    callLog: [],
    logger: new CapturingLogger(),
  }
  const service = createMcppService({
    runtime,
    enabledKeys: async () => [],
    registeredNames: () => [],
    rawTools: async () => {
      rawToolCalls.count += 1
      return RAW_TOOLS
    },
  })
  return { service, transports, runtime, rawToolCalls }
}
