/**
 * Hermetic behavior tests for the MCP protocol layer.
 *
 * Every dependency is an in-memory fake: the configuration is a plain object,
 * transports are closures, the call log is an array. Nothing listens on a port
 * or spawns a child. Assertions compare the serialized reply (what the HTTP
 * layer would send), so `undefined` fields disappear exactly as JSON does.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchAllTools,
  fetchTools,
  findExposeEntry,
  handleMcpRequest,
  knownToolsets,
  resolveToolset,
} from '../src/gateway.ts'
import { UpstreamHttpError } from '../src/errors.ts'
import { CapturingLogger } from '../src/logger.ts'

/** Build one http upstream definition with the old service's defaults. */
function httpUpstream(name, extra = {}) {
  return {
    name,
    transport: 'http',
    url: `https://${name}.example.com/mcp`,
    inheritEnv: ['PATH'],
    connectTimeout: 30,
    readTimeout: 120,
    listTimeout: 20,
    ...extra,
  }
}

/** The shared fixture: two upstreams feeding a `search` toolset and the default one. */
function baseConfig(overrides = {}) {
  return {
    upstreams: [httpUpstream('xiaohongshu'), httpUpstream('zhihu'), httpUpstream('github')],
    expose: {
      'xiaohongshu/note_search': {
        upstream: 'xiaohongshu', tool: 'note_search', toolset: 'search', as: 'xiaohongshu', hide: false,
      },
      'zhihu/ZhihuSearch': {
        upstream: 'zhihu', tool: 'ZhihuSearch', toolset: 'search', as: 'zhihu', hide: false,
      },
      'zhihu/Profile': { upstream: 'zhihu', tool: 'Profile', as: 'profile', hide: false },
      'github/search': { upstream: 'github', tool: 'search', as: 'github_search', hide: false },
    },
    serverName: 'mcpp',
    ...overrides,
  }
}

/** One fake transport; every call is observable on the returned object. */
function fakeTransport(name, options = {}) {
  const calls = []
  const transport = {
    name,
    listCount: 0,
    calls,
    async listTools() {
      transport.listCount += 1
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }
      if (options.listError !== undefined) throw options.listError
      return options.tools ?? []
    },
    async callTool(tool, args) {
      calls.push({ tool, args })
      if (options.callError !== undefined) throw options.callError
      return options.callResult ?? { content: [{ type: 'text', text: 'ok' }] }
    },
    async close() {},
  }
  return transport
}

/** Assemble the handler dependency object plus its observable bits. */
function makeDeps({ config = baseConfig(), transports = new Map(), logger = new CapturingLogger() } = {}) {
  const calls = []
  const statuses = []
  const deps = {
    config: () => config,
    transport: (name) => transports.get(name),
    recordCall: (entry) => calls.push(entry),
    onUpstreamStatus: (upstreamName, status) => statuses.push([upstreamName, status]),
    logger,
  }
  return { deps, calls, statuses, logger, config }
}

/** One JSON-RPC request body. */
function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }
}

/** Serialize a reply exactly as the HTTP layer would. */
function jsonBody(reply) {
  return JSON.parse(JSON.stringify(reply.body))
}

/** One request context. */
function ctx(clientId, rawToolset, body) {
  return { clientId, rawToolset, body }
}

// --- toolset resolution + expose lookup -------------------------------------------------

test('knownToolsets lists every expose toolset plus the default server', () => {
  assert.deepEqual(
    [...knownToolsets(baseConfig())].sort(),
    ['mcpp', 'search'],
  )
})

test('resolveToolset keeps known names, maps the mcpp alias, rejects the rest', () => {
  const config = baseConfig()
  assert.equal(resolveToolset(config, 'search'), 'search')
  assert.equal(resolveToolset(config, 'mcpp'), 'mcpp')
  assert.equal(resolveToolset(config, 'other'), null)
  const renamed = baseConfig({ serverName: 'hub' })
  assert.equal(resolveToolset(renamed, 'mcpp'), 'hub')
  assert.equal(resolveToolset(renamed, 'hub'), 'hub')
})

test('findExposeEntry resolves stable keys and display names', () => {
  const config = baseConfig()
  assert.equal(findExposeEntry(config, 'zhihu/ZhihuSearch', 'default', undefined)?.entry.tool, 'ZhihuSearch')
  assert.equal(findExposeEntry(config, 'zhihu/ZhihuSearch', 'default', undefined)?.upstreamName, 'zhihu')
  assert.equal(findExposeEntry(config, 'zhihu', 'default', undefined)?.entry.tool, 'ZhihuSearch')
  assert.equal(findExposeEntry(config, 'nope', 'default', undefined), null)
})

test('findExposeEntry parses client-formatted names inside their toolset only', () => {
  const config = baseConfig()
  const hit = findExposeEntry(config, 'mcp__search__zhihu', 'claude', 'search')
  assert.equal(hit?.entry.tool, 'ZhihuSearch')
  assert.equal(hit?.upstreamName, 'zhihu')
  // The same name must not resolve on the default toolset.
  assert.equal(findExposeEntry(config, 'mcp__search__zhihu', 'claude', 'mcpp'), null)
})

test('findExposeEntry retries parsing with serverName when the toolset differs', () => {
  const config = baseConfig({ serverName: 'hub' })
  // Entry belongs to the search toolset but its client-formatted name carries
  // the default server prefix (custom server_name can produce that).
  const hit = findExposeEntry(config, 'mcp__hub__zhihu', 'claude', 'search')
  assert.equal(hit?.entry.tool, 'ZhihuSearch')
})

test('findExposeEntry hides hidden entries from every path', () => {
  const config = baseConfig()
  config.expose['zhihu/Secret'] = {
    upstream: 'zhihu', tool: 'Secret', as: 'secret', hide: true,
  }
  assert.equal(findExposeEntry(config, 'Secret', 'default', undefined), null)
  assert.equal(findExposeEntry(config, 'zhihu/Secret', 'default', undefined), null)
  assert.equal(findExposeEntry(config, 'mcp__mcpp__secret', 'claude', 'mcpp'), null)
})

test('findExposeEntry picks the first entry when display names collide', () => {
  const config = {
    upstreams: [httpUpstream('gh'), httpUpstream('gl')],
    expose: {
      'gh/search': { upstream: 'gh', tool: 'search', as: 'search', hide: false },
      'gl/search': { upstream: 'gl', tool: 'search', as: 'search', hide: false },
    },
    serverName: 'mcpp',
  }
  assert.equal(findExposeEntry(config, 'search', 'default', undefined)?.upstreamName, 'gh')
})

// --- fetch layer ------------------------------------------------------------------------

test('fetchTools returns transformed tools for one upstream', async () => {
  const config = baseConfig()
  const transport = fakeTransport('xiaohongshu', { tools: [{ name: 'note_search' }] })
  const { deps } = makeDeps({ config, transports: new Map([['xiaohongshu', transport]]) })
  const tools = await fetchTools(deps, config, 'xiaohongshu', 'claude', 'search', 20)
  assert.deepEqual(JSON.parse(JSON.stringify(tools)), [
    { name: 'mcp__search__xiaohongshu', description: '' },
  ])
})

test('fetchTools returns [] when the upstream has no transport', async () => {
  const { deps } = makeDeps()
  assert.deepEqual(await fetchTools(deps, baseConfig(), 'zhihu', 'default', undefined, 20), [])
})

test('fetchTools warns and returns [] when the upstream fails', async () => {
  const config = baseConfig()
  const transport = fakeTransport('zhihu', { listError: new Error('connection reset') })
  const { deps, logger } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  assert.deepEqual(await fetchTools(deps, config, 'zhihu', 'claude', 'search', 20), [])
  assert.match(logger.text(), /Upstream 'zhihu' failed: connection reset/)
})

test('fetchTools warns and returns [] when the upstream times out', async () => {
  const config = baseConfig({ upstreams: [httpUpstream('zhihu', { listTimeout: 0.05 })] })
  const transport = fakeTransport('zhihu', { tools: [{ name: 'ZhihuSearch' }], delayMs: 500 })
  const { deps, logger } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  const started = performance.now()
  assert.deepEqual(await fetchTools(deps, config, 'zhihu', 'default', undefined, 0.05), [])
  assert.ok(performance.now() - started < 300, 'timeout must not wait for the upstream')
  assert.match(logger.text(), /Upstream 'zhihu' tools\/list timed out after 0\.05s, skipped/)
})

test('fetchAllTools concatenates every upstream in configuration order', async () => {
  const config = baseConfig()
  const transports = new Map([
    ['xiaohongshu', fakeTransport('xiaohongshu', { tools: [{ name: 'note_search' }] })],
    ['zhihu', fakeTransport('zhihu', { tools: [{ name: 'ZhihuSearch' }, { name: 'Profile' }] })],
    ['github', fakeTransport('github', { tools: [{ name: 'search' }] })],
  ])
  const { deps } = makeDeps({ config, transports })
  const tools = JSON.parse(JSON.stringify(await fetchAllTools(deps, config)))
  assert.deepEqual(tools.map((tool) => tool.name), ['xiaohongshu', 'zhihu', 'profile', 'github_search'])
})

// --- HTTP-layer guards -----------------------------------------------------------------

test('a disabled client naming mode answers 404', async () => {
  const { deps } = makeDeps({ config: baseConfig({ clients: { claude: false } }) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('initialize', {})))
  assert.equal(reply.status, 404)
  assert.deepEqual(jsonBody(reply), { error: "client 'claude' endpoint disabled" })
})

test('an unknown toolset answers 404', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'nope', rpc('tools/list', {})))
  assert.equal(reply.status, 404)
  assert.deepEqual(jsonBody(reply), { error: 'Unknown toolset: nope' })
})

test('a non-object body answers -32600', async () => {
  const { deps } = makeDeps()
  for (const body of [null, [], 'hello', 42]) {
    const reply = await handleMcpRequest(deps, ctx('default', 'mcpp', body))
    assert.equal(reply.status, 200)
    assert.deepEqual(jsonBody(reply), {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
    })
  }
})

// --- JSON-RPC methods -------------------------------------------------------------------

test('initialize advertises mcpp/<toolset>', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('initialize', {})))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'mcpp/search', version: '0.1.0' },
    },
  })
})

test('initialize on the default toolset uses the configured server name', async () => {
  const { deps } = makeDeps({ config: baseConfig({ serverName: 'hub' }) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'mcpp', rpc('initialize', {})))
  assert.equal(jsonBody(reply).result.serverInfo.name, 'mcpp/hub')
})

test('notifications/initialized answers 202 with an empty body', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('notifications/initialized', {})))
  assert.equal(reply.status, 202)
  assert.deepEqual(jsonBody(reply), {})
})

test('an unknown method answers -32601', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('resources/list', {})))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Unknown method: resources/list' },
  })
})

test('server/discover reports the resolved toolset', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('server/discover', {})))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'search', version: '0.1.0' },
      capabilities: { tools: {} },
    },
  })
})

test('tools/list returns the client-formatted surface of one toolset', async () => {
  const config = baseConfig()
  const transports = new Map([
    ['xiaohongshu', fakeTransport('xiaohongshu', { tools: [{ name: 'note_search' }] })],
    ['zhihu', fakeTransport('zhihu', { tools: [{ name: 'ZhihuSearch' }, { name: 'Profile' }] })],
    ['github', fakeTransport('github', { tools: [{ name: 'search' }] })],
  ])
  const { deps } = makeDeps({ config, transports })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/list', {})))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        { name: 'mcp__search__xiaohongshu', description: '' },
        { name: 'mcp__search__zhihu', description: '' },
      ],
    },
  })
})

test('tools/list on the default toolset returns bare display names', async () => {
  const config = baseConfig()
  const transports = new Map([
    ['zhihu', fakeTransport('zhihu', { tools: [{ name: 'Profile' }] })],
    ['github', fakeTransport('github', { tools: [{ name: 'search' }] })],
  ])
  const { deps } = makeDeps({ config, transports })
  const reply = await handleMcpRequest(deps, ctx('default', 'mcpp', rpc('tools/list', {})))
  assert.deepEqual(jsonBody(reply).result.tools.map((tool) => tool.name), ['profile', 'github_search'])
})

test('tools/list passes the upstream inputSchema through', async () => {
  const config = baseConfig()
  const inputSchema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
  const transport = fakeTransport('zhihu', {
    tools: [{ name: 'ZhihuSearch', description: 'raw desc', inputSchema }],
  })
  const { deps } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/list', {})))
  assert.deepEqual(jsonBody(reply).result.tools, [
    { name: 'mcp__search__zhihu', description: 'raw desc', inputSchema },
  ])
})

test('tools/list rebuilds the inputSchema from param transforms', async () => {
  const config = baseConfig()
  config.expose['zhihu/ZhihuSearch'] = {
    upstream: 'zhihu',
    tool: 'ZhihuSearch',
    toolset: 'search',
    as: 'zhihu',
    hide: false,
    params: [
      { name: 'q', mapFrom: 'query', hidden: false },
      { name: 'mode', type: 'enum', mapping: { fast: 'f' }, hidden: false },
    ],
  }
  const inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'queried' },
      mode: { type: 'string' },
      secret: { type: 'string' },
    },
    required: ['query', 'secret'],
  }
  const transport = fakeTransport('zhihu', { tools: [{ name: 'ZhihuSearch', inputSchema }] })
  const { deps } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/list', {})))
  assert.deepEqual(jsonBody(reply).result.tools[0].inputSchema, {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'queried' },
      mode: { type: 'string', enum: ['fast'] },
    },
    required: ['q'],
  })
})

test('tools/list isolates a failing upstream and skips hidden tools', async () => {
  const config = baseConfig()
  config.expose['zhihu/Secret'] = { upstream: 'zhihu', tool: 'Secret', hide: true }
  const transports = new Map([
    ['xiaohongshu', fakeTransport('xiaohongshu', { listError: new Error('upstream down') })],
    ['zhihu', fakeTransport('zhihu', {
      tools: [{ name: 'ZhihuSearch' }, { name: 'Secret' }, { name: 'Profile' }],
    })],
  ])
  const { deps, logger } = makeDeps({ config, transports })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/list', {})))
  assert.deepEqual(jsonBody(reply).result.tools.map((tool) => tool.name), ['mcp__search__zhihu'])
  assert.match(logger.text(), /Upstream 'xiaohongshu' failed: upstream down/)
})

test('tools/list isolates a timed-out upstream from a healthy one', async () => {
  const config = baseConfig({
    upstreams: [httpUpstream('xiaohongshu', { listTimeout: 0.05 }), httpUpstream('zhihu')],
  })
  const transports = new Map([
    ['xiaohongshu', fakeTransport('xiaohongshu', { tools: [{ name: 'note_search' }], delayMs: 500 })],
    ['zhihu', fakeTransport('zhihu', { tools: [{ name: 'ZhihuSearch' }] })],
  ])
  const { deps, logger } = makeDeps({ config, transports })
  const started = performance.now()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/list', {})))
  assert.ok(performance.now() - started < 300, 'a slow upstream must not block tools/list')
  assert.deepEqual(jsonBody(reply).result.tools.map((tool) => tool.name), ['mcp__search__zhihu'])
  assert.match(logger.text(), /timed out/)
})

test('tools/list fetches upstreams concurrently', async () => {
  const config = baseConfig({
    upstreams: [httpUpstream('a'), httpUpstream('b')],
    expose: {
      'a/t': { upstream: 'a', tool: 't', hide: false },
      'b/t': { upstream: 'b', tool: 't', hide: false },
    },
  })
  const transports = new Map([
    ['a', fakeTransport('a', { tools: [{ name: 't' }], delayMs: 120 })],
    ['b', fakeTransport('b', { tools: [{ name: 't' }], delayMs: 120 })],
  ])
  const { deps } = makeDeps({ config, transports })
  const started = performance.now()
  const reply = await handleMcpRequest(deps, ctx('default', 'mcpp', rpc('tools/list', {})))
  const elapsed = performance.now() - started
  assert.deepEqual(jsonBody(reply).result.tools.map((tool) => tool.name), ['t', 't'])
  assert.ok(elapsed < 230, `fetching took ${elapsed}ms; expected concurrent fetches`)
})

// --- tools/call -------------------------------------------------------------------------

test('tools/call reaches the upstream tool with mapped arguments', async () => {
  const config = baseConfig()
  config.expose['zhihu/ZhihuSearch'] = {
    upstream: 'zhihu',
    tool: 'ZhihuSearch',
    toolset: 'search',
    as: 'zhihu',
    hide: false,
    params: [{ name: 'q', mapFrom: 'query', hidden: false }],
  }
  const transport = fakeTransport('zhihu', { callResult: { content: [{ type: 'text', text: 'ok' }] } })
  const { deps, calls, logger } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu', arguments: { q: 'hello' },
  })))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: 'ok' }] },
  })
  assert.deepEqual(transport.calls, [{ tool: 'ZhihuSearch', args: { query: 'hello' } }])
  assert.equal(calls.length, 1)
  const recorded = calls[0]
  assert.equal(recorded.tool, 'mcp__search__zhihu')
  assert.equal(recorded.upstream, 'zhihu')
  assert.equal(recorded.ok, true)
  assert.equal(typeof recorded.latencyMs, 'number')
  assert.ok(recorded.latencyMs >= 0)
  assert.ok(recorded.ts > 1_000_000_000, 'ts is unix seconds, the unit the admin UI multiplies by 1000')
  assert.ok(!('error' in recorded))
  assert.match(logger.text(), /tools\/call mcp__search__zhihu -> upstream zhihu\/ZhihuSearch/)
})

test('tools/call without a name answers -32602', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', { arguments: {} })))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32602, message: 'Missing required parameter: name' },
  })
})

test('tools/call of an unknown tool answers -32601', async () => {
  const { deps } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', { name: 'nope' })))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Tool not found: nope' },
  })
})

test('tools/call without a transport answers -32000 and records nothing', async () => {
  const { deps, calls } = makeDeps()
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu',
  })))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: '[gateway] upstream=zhihu: no transport' },
  })
  assert.deepEqual(calls, [])
})

test('tools/call maps auth/rate-limit HTTP failures to -32000 and flags the key', async () => {
  for (const status of [401, 403, 429]) {
    const transport = fakeTransport('zhihu', { callError: new UpstreamHttpError('rejected', status) })
    const { deps, calls, statuses } = makeDeps({ transports: new Map([['zhihu', transport]]) })
    const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
      name: 'mcp__search__zhihu',
    })))
    assert.deepEqual(jsonBody(reply), {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: `[gateway] upstream=zhihu: HTTP ${status}` },
    })
    assert.deepEqual(statuses, [['zhihu', status]])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].ok, false)
    assert.equal(calls[0].error, `HTTP ${status}`)
  }
})

test('tools/call does not flag the key on a non-auth HTTP failure', async () => {
  const transport = fakeTransport('zhihu', { callError: new UpstreamHttpError('server error', 500) })
  const { deps, statuses } = makeDeps({ transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu',
  })))
  assert.equal(jsonBody(reply).error.message, '[gateway] upstream=zhihu: HTTP 500')
  assert.deepEqual(statuses, [])
})

test('tools/call maps other failures to -32000 with the message and truncates the log error', async () => {
  const message = 'x'.repeat(300)
  const transport = fakeTransport('zhihu', { callError: new Error(message) })
  const { deps, calls, logger } = makeDeps({ transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu',
  })))
  assert.deepEqual(jsonBody(reply), {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: `[gateway] upstream=zhihu: ${message}` },
  })
  assert.equal(calls[0].ok, false)
  assert.equal(calls[0].error, 'x'.repeat(200))
  assert.match(logger.text(), /Upstream 'zhihu' call_tool error: x+/)
})

test('a param transform rejection answers -32602 without calling the upstream', async () => {
  const config = baseConfig()
  config.expose['zhihu/ZhihuSearch'] = {
    upstream: 'zhihu',
    tool: 'ZhihuSearch',
    toolset: 'search',
    as: 'zhihu',
    hide: false,
    params: [{
      name: 'style', type: 'enum', mapping: { precise: 'p', balanced: 'b' }, hidden: false,
    }],
  }
  const transport = fakeTransport('zhihu')
  const { deps, calls } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  const reply = await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu', arguments: { style: 'unknown' },
  })))
  const body = jsonBody(reply)
  assert.equal(body.error.code, -32602)
  assert.match(body.error.message, /Invalid value 'unknown' for enum param 'style'/)
  assert.match(body.error.message, /precise.*balanced/)
  assert.deepEqual(transport.calls, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ok, false)
})

test('tools/call injects a hidden default upstream parameter', async () => {
  const config = baseConfig()
  config.expose['zhihu/ZhihuSearch'] = {
    upstream: 'zhihu',
    tool: 'ZhihuSearch',
    toolset: 'search',
    as: 'zhihu',
    hide: false,
    params: [{ name: 'model', mapFrom: 'model_name', hidden: true, default: 'haiku' }],
  }
  const transport = fakeTransport('zhihu')
  const { deps } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  await handleMcpRequest(deps, ctx('claude', 'search', rpc('tools/call', {
    name: 'mcp__search__zhihu', arguments: {},
  })))
  assert.deepEqual(transport.calls, [{ tool: 'ZhihuSearch', args: { model_name: 'haiku' } }])
})

test('tools/call on the default endpoint resolves display names', async () => {
  const config = baseConfig()
  const transport = fakeTransport('zhihu')
  const { deps } = makeDeps({ config, transports: new Map([['zhihu', transport]]) })
  await handleMcpRequest(deps, ctx('default', 'mcpp', rpc('tools/call', { name: 'profile' })))
  assert.deepEqual(transport.calls, [{ tool: 'Profile', args: {} }])
})
