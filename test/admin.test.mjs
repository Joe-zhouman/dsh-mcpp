/**
 * Hermetic behavior tests for the admin API layer.
 *
 * The dependencies are in-memory fakes: the configuration is a plain object,
 * `persistConfig` mirrors the real composition root (serialize -> re-parse ->
 * swap), transports are closures, and key pools are plain objects. Assertions
 * compare the serialized reply bodies exactly, so field names such as
 * `_upstream_name` and `healthy_count` are pinned to the retired service's
 * payloads.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { dumpConfig, parseConfig } from '../src/config.ts'
import { handleAdminRequest } from '../src/admin.ts'
import { CapturingLogger } from '../src/logger.ts'
import { presets } from '../src/presets.ts'

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

/** Build one stdio upstream definition with the old service's defaults. */
function stdioUpstream(name, extra = {}) {
  return {
    name,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-filesystem'],
    env: { API_TOKEN: '${MY_API_TOKEN}' },
    inheritEnv: ['PATH'],
    connectTimeout: 30,
    readTimeout: 120,
    listTimeout: 20,
    ...extra,
  }
}

/** Raw tool list the fake `gh` upstream advertises. */
const RAW_TOOLS = [
  {
    name: 'search',
    description: 'raw search desc',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'the query' },
        limit: { type: 'integer', description: 'page size' },
      },
      required: ['query'],
    },
  },
  { name: 'code_search', description: 'raw code desc' },
]

/** Shared fixture configuration. */
function baseConfig(overrides = {}) {
  return {
    upstreams: [
      httpUpstream('gh', { auth: { keys: ['${GH_KEY}'], header: 'Authorization', scheme: 'Bearer ' } }),
      stdioUpstream('fs'),
    ],
    expose: {
      'gh/search': {
        upstream: 'gh',
        tool: 'search',
        toolset: 'search',
        as: 'github',
        hide: false,
        description: 'Search repos. See `gh/code`.',
        params: [
          { name: 'q', mapFrom: 'query', hidden: false },
          { name: 'limit', hidden: false, default: 10 },
        ],
      },
      'gh/code': {
        upstream: 'gh', tool: 'code_search', toolset: 'search', as: 'code', hide: false,
      },
      'fs/list': { upstream: 'fs', tool: 'list', hide: false },
    },
    serverName: 'mcpp',
    ...overrides,
  }
}

/** One fake transport; `options.listError` / `tools` drive its behavior. */
function fakeTransport(name, options = {}) {
  const calls = []
  return {
    name,
    calls,
    async listTools() {
      if (options.listError !== undefined) throw options.listError
      return options.tools ?? []
    },
    async callTool(tool, args) {
      calls.push({ tool, args })
      return {}
    },
    async close() {},
  }
}

/** One fake key pool with observable resume calls. */
function fakeKeyPool(keys = ['sk-abcdef', 'sk-ghijkl']) {
  const resumed = []
  return {
    resumed,
    healthyCount: keys.length,
    current: keys[0],
    next: () => keys[0],
    markBad() {},
    resume(key) { resumed.push(key) },
    keyAt(index) { return keys[index] },
    statuses() {
      return keys.map((key, index) => ({ index, key: `${key.slice(0, 4)}...`, paused: false }))
    },
  }
}

/** Fake `createProbeTransport` factory with observable close calls. */
function makeProbe(toolsByServer = {}, failures = new Set()) {
  const probed = []
  const closed = []
  return {
    probed,
    closed,
    factory(upstream) {
      probed.push(upstream.name)
      return {
        name: upstream.name,
        async listTools() {
          if (failures.has(upstream.name)) throw new Error('probe failed')
          return (toolsByServer[upstream.name] ?? []).map((name) => ({ name }))
        },
        async callTool() { return {} },
        async close() { closed.push(upstream.name) },
      }
    },
  }
}

/**
 * Assemble admin dependencies. `persistConfig` mirrors the real composition
 * root: serialize, re-parse, then swap the live object.
 */
function makeDeps(options = {}) {
  let config = options.config ?? baseConfig()
  const persisted = []
  const logger = options.logger ?? new CapturingLogger()
  const transports = options.transports ?? new Map()
  const keypools = options.keypools ?? new Map()
  const callLog = options.callLog ?? []
  const deps = {
    configPath: 'C:/tmp/mcpp/config.yaml',
    config: () => config,
    transport: (name) => transports.get(name),
    recordCall: () => {},
    logger,
    keypool: (name) => keypools.get(name),
    keypools: () => keypools,
    callLogSnapshot: () => [...callLog],
    createProbeTransport: options.probe ?? (() => { throw new Error('unexpected probe') }),
    persistConfig: async (next) => {
      const reparsed = parseConfig(dumpConfig(next))
      persisted.push(reparsed)
      config = reparsed
    },
  }
  return { deps, persisted, logger, transports, keypools, callLog, config: () => config }
}

/** Build one admin request; `json`/`text` are the raw body. */
function request(method, segments, options = {}) {
  const text = options.text !== undefined
    ? options.text
    : options.json !== undefined
      ? JSON.stringify(options.json)
      : ''
  return {
    method,
    segments,
    query: new URLSearchParams(options.query ?? {}),
    bodyText: async () => text,
    bodyJson: async () => JSON.parse(text),
  }
}

const get = (segments, options) => request('GET', segments, options)
const post = (segments, options) => request('POST', segments, options)
const put = (segments, options) => request('PUT', segments, options)
const del = (segments, options) => request('DELETE', segments, options)

/** Serialize a reply exactly as the HTTP layer would. */
function jsonBody(reply) {
  return JSON.parse(JSON.stringify(reply.body))
}

// --- /api/config -----------------------------------------------------------------------

test('GET /api/config returns the YAML dump of the live config', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, get(['config']))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { yaml: dumpConfig(deps.config()) })
})

test('POST /api/config validates, persists, and reports reloaded', async () => {
  const { deps, persisted } = makeDeps()
  const text = 'server_name: hub\nupstreams:\n  - name: gh\n    url: https://gh.example.com/mcp\nexpose:\n  gh/search:\n    upstream: gh\n    tool: search\n'
  const reply = await handleAdminRequest(deps, post(['config'], { text }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'reloaded' })
  assert.equal(persisted.length, 1)
  assert.equal(deps.config().serverName, 'hub')
  assert.deepEqual(Object.keys(deps.config().expose), ['gh/search'])
})

test('POST /api/config rejects invalid YAML without persisting', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, post(['config'], { text: 'upstreams: 5\nexpose: {}' }))
  assert.equal(reply.status, 400)
  assert.match(jsonBody(reply).error, /upstreams/)
  assert.equal(persisted.length, 0)
})

// --- /api/tools -----------------------------------------------------------------------

test('GET /api/tools previews the transformed default-client surface', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { tools: RAW_TOOLS })]])
  const { deps } = makeDeps({ transports })
  const reply = await handleAdminRequest(deps, get(['tools']))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), [
    {
      name: 'github',
      description: 'Search repos. See `code`.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'the query' },
          limit: { type: 'integer', description: 'page size' },
        },
        required: ['q'],
      },
    },
    { name: 'code', description: 'raw code desc' },
  ])
})

test('GET /api/tools formats names per client and resolves the mcpp alias', async () => {
  const transports = new Map([
    ['gh', fakeTransport('gh', { tools: RAW_TOOLS })],
    ['fs', fakeTransport('fs', { tools: [{ name: 'list' }] })],
  ])
  const { deps } = makeDeps({ transports })
  const claudeReply = await handleAdminRequest(deps, get(['tools'], { query: { client: 'claude' } }))
  assert.deepEqual(jsonBody(claudeReply).map((tool) => tool.name), [
    'mcp__search__github',
    'mcp__search__code',
    'mcp__mcpp__list',
  ])
  const defaultReply = await handleAdminRequest(deps, get(['tools'], { query: { toolset: 'mcpp' } }))
  assert.deepEqual(jsonBody(defaultReply), [{ name: 'list', description: '' }])
})

// --- /api/upstreams -------------------------------------------------------------------

test('GET /api/upstreams lists configured names in order', async () => {
  const { deps } = makeDeps()
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['upstreams']))), ['gh', 'fs'])
})

test('GET /api/upstreams/{name} reports identity plus editable env', async () => {
  const { deps } = makeDeps()
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['upstreams', 'gh']))), {
    name: 'gh',
    transport: 'http',
    env: null,
    inherit_env: null,
  })
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['upstreams', 'fs']))), {
    name: 'fs',
    transport: 'stdio',
    env: { API_TOKEN: '${MY_API_TOKEN}' },
    inherit_env: ['PATH'],
  })
})

test('GET /api/upstreams/{name} answers 404 for an unknown upstream', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, get(['upstreams', 'nope']))
  assert.equal(reply.status, 404)
  assert.deepEqual(jsonBody(reply), { error: 'Unknown upstream: nope' })
})

test('PUT /api/upstreams/{name} updates env and inherit_env', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['upstreams', 'fs'], {
    json: { env: { FOO: 'bar', BAZ: '${QUX}' }, inherit_env: ['PATH', 'HOME'] },
  }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'saved', name: 'fs' })
  assert.equal(persisted.length, 1)
  const fs = deps.config().upstreams.find((upstream) => upstream.name === 'fs')
  assert.deepEqual(fs.env, { FOO: 'bar', BAZ: '${QUX}' })
  assert.deepEqual(fs.inheritEnv, ['PATH', 'HOME'])
})

test('PUT /api/upstreams/{name} forces identity fields back to the existing values', async () => {
  const { deps } = makeDeps()
  await handleAdminRequest(deps, put(['upstreams', 'fs'], {
    json: { command: 'evil', args: ['pwn'], transport: 'http', env: { A: 'B' } },
  }))
  const fs = deps.config().upstreams.find((upstream) => upstream.name === 'fs')
  assert.equal(fs.transport, 'stdio')
  assert.equal(fs.command, 'npx')
  assert.deepEqual(fs.args, ['-y', 'mcp-filesystem'])
  assert.deepEqual(fs.env, { A: 'B' })
})

test('PUT /api/upstreams/{name} rejects non-string env values', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['upstreams', 'fs'], { json: { env: { K: 123 } } }))
  assert.equal(reply.status, 400)
  assert.deepEqual(jsonBody(reply), { error: 'env keys and values must be strings' })
  assert.equal(persisted.length, 0)
})

test('PUT /api/upstreams/{name} rejects a non-list inherit_env', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['upstreams', 'fs'], { json: { inherit_env: 'PATH' } }))
  assert.equal(reply.status, 400)
  assert.deepEqual(jsonBody(reply), { error: 'inherit_env must be a list of strings' })
})

test('PUT /api/upstreams/{name} rejects a non-object body and unknown names', async () => {
  const { deps } = makeDeps()
  const bodyReply = await handleAdminRequest(deps, put(['upstreams', 'fs'], { json: [] }))
  assert.equal(bodyReply.status, 400)
  assert.deepEqual(jsonBody(bodyReply), { error: 'body must be a JSON object' })
  const unknownReply = await handleAdminRequest(deps, put(['upstreams', 'nope'], { json: {} }))
  assert.equal(unknownReply.status, 404)
})

// --- /api/upstreams/{name}/tools + /test -----------------------------------------------

test('GET /api/upstreams/{name}/tools returns raw tools with null placeholders', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { tools: RAW_TOOLS })]])
  const { deps } = makeDeps({ transports })
  const reply = await handleAdminRequest(deps, get(['upstreams', 'gh', 'tools']))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    upstream: 'gh',
    tools: [
      { name: 'search', description: 'raw search desc', inputSchema: RAW_TOOLS[0].inputSchema },
      { name: 'code_search', description: 'raw code desc', inputSchema: null },
    ],
  })
})

test('GET /api/upstreams/{name}/tools answers 502 when the upstream fails', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { listError: new Error('boom') })]])
  const { deps } = makeDeps({ transports })
  const reply = await handleAdminRequest(deps, get(['upstreams', 'gh', 'tools']))
  assert.equal(reply.status, 502)
  assert.deepEqual(jsonBody(reply), { error: 'boom' })
  const unknownReply = await handleAdminRequest(deps, get(['upstreams', 'nope', 'tools']))
  assert.equal(unknownReply.status, 404)
})

test('POST /api/upstreams/{name}/test reports latency, count, and tool names', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { tools: RAW_TOOLS })]])
  const { deps } = makeDeps({ transports })
  const body = jsonBody(await handleAdminRequest(deps, post(['upstreams', 'gh', 'test'])))
  assert.equal(body.ok, true)
  assert.equal(typeof body.latency_ms, 'number')
  assert.equal(body.tool_count, 2)
  assert.deepEqual(body.tools, [
    { name: 'search', description: 'raw search desc' },
    { name: 'code_search', description: 'raw code desc' },
  ])
  assert.equal(body.error, null)
})

test('POST /api/upstreams/{name}/test reports failures as ok:false', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { listError: new Error('boom') })]])
  const { deps, logger } = makeDeps({ transports })
  const body = jsonBody(await handleAdminRequest(deps, post(['upstreams', 'gh', 'test'])))
  assert.equal(body.ok, false)
  assert.equal(body.tool_count, 0)
  assert.deepEqual(body.tools, [])
  assert.equal(body.error, 'boom')
  assert.match(logger.text(), /Test upstream 'gh' failed: boom/)
  const unknown = await handleAdminRequest(deps, post(['upstreams', 'nope', 'test']))
  assert.equal(unknown.status, 404)
})

// --- /api/toolsets + /api/client-presets -----------------------------------------------

test('GET /api/toolsets groups visible entries and marks the default', async () => {
  const config = baseConfig()
  config.expose['gh/hidden'] = { upstream: 'gh', tool: 'hidden', hide: true }
  const { deps } = makeDeps({ config })
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['toolsets']))), [
    { toolset: 'mcpp', tools: ['fs/list'], default: true },
    { toolset: 'search', tools: ['gh/search', 'gh/code'], default: false },
  ])
})

test('GET /api/client-presets forwards the preset catalogue', async () => {
  const { deps } = makeDeps()
  const body = jsonBody(await handleAdminRequest(deps, get(['client-presets'])))
  assert.deepEqual(body, JSON.parse(JSON.stringify(presets())))
  assert.equal(body.naming_modes.claude.endpoint_path, '/{toolset}/claude/mcp')
  assert.equal(body.clients['claude-code'].naming, 'claude')
  assert.ok(body.connect_modes.claude.file.length > 0)
})

// --- /api/expose ----------------------------------------------------------------------

test('GET /api/expose merges upstream descriptions and schemas into entries', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { tools: RAW_TOOLS })]])
  const { deps } = makeDeps({ transports })
  const body = jsonBody(await handleAdminRequest(deps, get(['expose'])))
  assert.deepEqual(body, [
    {
      key: 'gh/search',
      upstream: 'gh',
      tool: 'search',
      as: 'github',
      toolset: 'search',
      hide: false,
      description: 'Search repos. See `gh/code`.',
      raw_description: 'raw search desc',
      params: [
        {
          name: 'q',
          map_from: 'query',
          hidden: false,
          default: null,
          type: null,
          mapping: null,
          preset: null,
          description: null,
          required: null,
          _upstream_name: 'query',
          _upstream_type: 'string',
          _upstream_description: 'the query',
          _required: true,
        },
        {
          name: 'limit',
          map_from: null,
          hidden: false,
          default: 10,
          type: null,
          mapping: null,
          preset: null,
          description: null,
          required: null,
          _upstream_name: 'limit',
          _upstream_type: 'integer',
          _upstream_description: 'page size',
          _required: false,
        },
      ],
    },
    {
      key: 'gh/code',
      upstream: 'gh',
      tool: 'code_search',
      as: 'code',
      toolset: 'search',
      hide: false,
      description: null,
      raw_description: 'raw code desc',
      params: [],
    },
    {
      key: 'fs/list',
      upstream: 'fs',
      tool: 'list',
      as: null,
      toolset: 'mcpp',
      hide: false,
      description: null,
      raw_description: null,
      params: [],
    },
  ])
})

test('GET /api/expose keeps orphaned transforms and binds new upstream params', async () => {
  const config = baseConfig()
  config.expose['gh/search'] = {
    upstream: 'gh',
    tool: 'search',
    toolset: 'search',
    hide: false,
    params: [
      { name: 'sort', mapFrom: 'sort_by', type: 'enum', mapping: { newest: 'desc' }, hidden: false },
      { name: 'ghost', hidden: true, default: 'x' },
    ],
  }
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string' },
      sort_by: { type: 'string' },
    },
    required: ['query'],
  }
  const transports = new Map([
    ['gh', fakeTransport('gh', { tools: [{ name: 'search', description: 'd', inputSchema: schema }] })],
  ])
  const { deps } = makeDeps({ config, transports })
  const body = jsonBody(await handleAdminRequest(deps, get(['expose'])))
  const rows = body[0].params
  assert.deepEqual(rows.map((row) => row._upstream_name), ['query', 'sort_by', 'ghost'])
  const byUpstream = Object.fromEntries(rows.map((row) => [row._upstream_name, row]))
  assert.equal(byUpstream['query'].map_from, 'query')
  assert.equal(byUpstream['query']._required, true)
  assert.equal(byUpstream['sort_by'].name, 'sort')
  assert.deepEqual(byUpstream['sort_by'].mapping, { newest: 'desc' })
  assert.equal(byUpstream['sort_by']._upstream_type, 'string')
  assert.equal(byUpstream['ghost'].name, 'ghost')
  assert.equal(byUpstream['ghost'].hidden, true)
  assert.equal(byUpstream['ghost'].default, 'x')
  assert.equal(byUpstream['ghost']._upstream_type, null)
  assert.equal(byUpstream['ghost']._upstream_description, '')
  assert.equal(byUpstream['ghost']._required, false)
})

test('GET /api/expose skips a failed raw fetch with a warning', async () => {
  const transports = new Map([['gh', fakeTransport('gh', { listError: new Error('boom') })]])
  const { deps, logger } = makeDeps({ transports })
  const body = jsonBody(await handleAdminRequest(deps, get(['expose'])))
  assert.equal(body[0].raw_description, null)
  // Without the upstream schema, every configured transform becomes an orphan
  // row (read-only upstream context is empty).
  assert.deepEqual(body[0].params.map((row) => row._upstream_name), ['query', 'limit'])
  assert.deepEqual(body[0].params.map((row) => row._upstream_type), [null, null])
  assert.match(logger.text(), /raw fetch upstream 'gh' failed: boom/)
})

test('PUT /api/expose/{key} updates the editable fields and persists', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['expose', 'gh', 'code'], {
    json: { as: 'code_search_v2', toolset: 'search', hide: false, description: 'new desc', params: [] },
  }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'saved', key: 'gh/code' })
  assert.equal(persisted.length, 1)
  const entry = deps.config().expose['gh/code']
  assert.equal(entry.as, 'code_search_v2')
  assert.equal(entry.description, 'new desc')
})

test('PUT /api/expose/{key} forces identity and drops read-only fields', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['expose', 'gh', 'code'], {
    json: {
      upstream: 'evil',
      tool: 'pwned',
      description: 'x',
      params: [],
      _upstream_name: 'hack',
      _required: true,
    },
  }))
  assert.equal(reply.status, 200)
  const entry = deps.config().expose['gh/code']
  assert.equal(entry.upstream, 'gh')
  assert.equal(entry.tool, 'code_search')
  assert.equal(entry.description, 'x')
  assert.ok(!Object.keys(entry).some((field) => field.startsWith('_')))
})

test('PUT /api/expose/{key} round-trips an enum parameter transform', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['expose', 'gh', 'search'], {
    json: {
      as: 'github',
      toolset: 'search',
      description: 'd',
      params: [{
        name: 'sort',
        map_from: 'query',
        type: 'enum',
        mapping: { stars: 'desc', updated: 'asc' },
        hidden: false,
        description: 'sort order',
        required: false,
      }],
    },
  }))
  assert.equal(reply.status, 200)
  // Compare the serialized entry: the runtime object may carry absent fields as
  // explicit `undefined`, which JSON (the persisted form) drops.
  const params = JSON.parse(JSON.stringify(deps.config().expose['gh/search'].params))
  assert.deepEqual(params, [{
    name: 'sort',
    mapFrom: 'query',
    type: 'enum',
    mapping: { stars: 'desc', updated: 'asc' },
    hidden: false,
    description: 'sort order',
    required: false,
  }])
})

test('PUT /api/expose/{key} rejects a dangling backtick reference without mutating', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, put(['expose', 'gh', 'code'], {
    json: { description: 'see `gh/nope`', params: [] },
  }))
  assert.equal(reply.status, 400)
  assert.match(jsonBody(reply).error, /gh\/nope/)
  assert.equal(deps.config().expose['gh/code'].description, undefined)
  assert.equal(persisted.length, 0)
})

test('PUT /api/expose/{key} rejects unknown keys and invalid field types', async () => {
  const { deps } = makeDeps()
  const unknown = await handleAdminRequest(deps, put(['expose', 'gh', 'missing'], { json: { params: [] } }))
  assert.equal(unknown.status, 404)
  assert.deepEqual(jsonBody(unknown), { error: 'Unknown expose key: gh/missing' })

  const badHide = await handleAdminRequest(deps, put(['expose', 'gh', 'code'], { json: { hide: 'yes' } }))
  assert.equal(badHide.status, 400)
  assert.match(jsonBody(badHide).error, /hide/)

  const badParams = await handleAdminRequest(deps, put(['expose', 'gh', 'code'], { json: { params: {} } }))
  assert.equal(badParams.status, 400)
  assert.match(jsonBody(badParams).error, /params must be a list/)
})

test('DELETE /api/expose/{key} deletes unreferenced entries', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, del(['expose', 'gh', 'search']))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'deleted', key: 'gh/search' })
  assert.equal(persisted.length, 1)
  assert.equal(deps.config().expose['gh/search'], undefined)
})

test('DELETE /api/expose/{key} refuses with 409 when another description references it', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, del(['expose', 'gh', 'code']))
  assert.equal(reply.status, 409)
  assert.deepEqual(jsonBody(reply), {
    error: "Cannot delete 'gh/code': referenced by ['gh/search']. Remove those backtick refs first.",
  })
  assert.ok(deps.config().expose['gh/code'])
  assert.equal(persisted.length, 0)
})

test('DELETE /api/expose/{key} answers 404 for an unknown key', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, del(['expose', 'gh', 'missing']))
  assert.equal(reply.status, 404)
})

// --- /api/keys ------------------------------------------------------------------------

test('GET /api/keys reports pool health and masked keys', async () => {
  const keypools = new Map([['gh', fakeKeyPool(['sk-abcdef', 'sk-ghijkl'])]])
  const { deps } = makeDeps({ keypools })
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['keys']))), {
    gh: {
      healthy_count: 2,
      keys: [
        { index: 0, key: 'sk-a...', paused: false },
        { index: 1, key: 'sk-g...', paused: false },
      ],
    },
  })
})

test('POST /api/keys/{upstream}/resume resumes the selected key', async () => {
  const pool = fakeKeyPool()
  const keypools = new Map([['gh', pool]])
  const { deps } = makeDeps({ keypools })
  const reply = await handleAdminRequest(deps, post(['keys', 'gh', 'resume'], { json: { key_index: 1 } }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'resumed', key: 'sk-g...' })
  assert.deepEqual(pool.resumed, ['sk-ghijkl'])
})

test('POST /api/keys/{upstream}/resume answers 404 without a key pool', async () => {
  const { deps } = makeDeps()
  const reply = await handleAdminRequest(deps, post(['keys', 'gh', 'resume'], { json: {} }))
  assert.equal(reply.status, 404)
  assert.deepEqual(jsonBody(reply), { error: 'No keypool for this upstream' })
})

test('POST /api/keys/{upstream} appends a trimmed key', async () => {
  const { deps, persisted } = makeDeps()
  const reply = await handleAdminRequest(deps, post(['keys', 'gh'], { json: { key: ' sk-new ' } }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'added', count: 2 })
  assert.equal(persisted.length, 1)
  const gh = deps.config().upstreams.find((upstream) => upstream.name === 'gh')
  assert.deepEqual(gh.auth.keys, ['${GH_KEY}', 'sk-new'])
})

test('POST /api/keys/{upstream} rejects empty keys and auth-less upstreams', async () => {
  const { deps, persisted } = makeDeps()
  const empty = await handleAdminRequest(deps, post(['keys', 'gh'], { json: { key: '   ' } }))
  assert.equal(empty.status, 400)
  assert.deepEqual(jsonBody(empty), { error: 'body must be {"key": "..."}' })
  const noAuth = await handleAdminRequest(deps, post(['keys', 'fs'], { json: { key: 'x' } }))
  assert.equal(noAuth.status, 400)
  assert.match(jsonBody(noAuth).error, /no auth block/)
  const unknown = await handleAdminRequest(deps, post(['keys', 'nope'], { json: { key: 'x' } }))
  assert.equal(unknown.status, 404)
  assert.equal(persisted.length, 0)
})

test('DELETE /api/keys/{upstream}/{index} removes a key by index', async () => {
  const config = baseConfig()
  config.upstreams[0].auth = { keys: ['a', 'b'], header: 'Authorization', scheme: 'Bearer ' }
  const { deps, persisted } = makeDeps({ config })
  const reply = await handleAdminRequest(deps, del(['keys', 'gh', '0']))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), { status: 'deleted', count: 1 })
  assert.equal(persisted.length, 1)
  const gh = deps.config().upstreams.find((upstream) => upstream.name === 'gh')
  assert.deepEqual(gh.auth.keys, ['b'])
})

test('DELETE /api/keys/{upstream}/{index} rejects bad indexes and missing pools', async () => {
  const config = baseConfig()
  config.upstreams[0].auth = { keys: ['a'], header: 'Authorization', scheme: 'Bearer ' }
  const noKeys = baseConfig()
  noKeys.upstreams[0].auth = { keys: [], header: 'Authorization', scheme: 'Bearer ' }
  const { deps } = makeDeps({ config })
  const outOfRange = await handleAdminRequest(deps, del(['keys', 'gh', '5']))
  assert.equal(outOfRange.status, 400)
  assert.deepEqual(jsonBody(outOfRange), { error: 'key_index 5 out of range' })
  const missing = await handleAdminRequest(deps, del(['keys', 'gh', 'abc']))
  assert.equal(missing.status, 400)
  const unknown = await handleAdminRequest(deps, del(['keys', 'nope', '0']))
  assert.equal(unknown.status, 404)

  const { deps: emptyDeps } = makeDeps({ config: noKeys })
  const none = await handleAdminRequest(emptyDeps, del(['keys', 'gh', '0']))
  assert.equal(none.status, 404)
  assert.deepEqual(jsonBody(none), { error: 'No keys to delete' })
})

// --- /api/add-server -------------------------------------------------------------------

test('POST /api/add-server unwraps the Claude-Desktop shape and generates passthrough entries', async () => {
  const probe = makeProbe({ corpus: ['search'], docs: ['read'] })
  const { deps, persisted } = makeDeps({ probe: probe.factory })
  const jsonText = JSON.stringify({
    mcpServers: {
      corpus: {
        url: 'https://corpus.example.com/mcp',
        headers: { Authorization: 'Bearer sk-abc', 'Content-Type': 'application/json' },
      },
      docs: { command: 'node', args: ['server.mjs'], env: { FOO: 'bar' } },
    },
  })
  const reply = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: jsonText, toolset: 'ext' },
  }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    added: [
      { server: 'corpus', toolset: 'ext', tools: ['search'] },
      { server: 'docs', toolset: 'ext', tools: ['read'] },
    ],
    errors: [],
  })
  assert.equal(persisted.length, 1)
  assert.deepEqual(probe.closed, ['corpus', 'docs'])

  const config = deps.config()
  const corpus = config.upstreams.find((upstream) => upstream.name === 'corpus')
  assert.equal(corpus.transport, 'http')
  assert.equal(corpus.url, 'https://corpus.example.com/mcp')
  assert.deepEqual(corpus.auth, { keys: ['sk-abc'], header: 'Authorization', scheme: 'Bearer ' })
  const docs = config.upstreams.find((upstream) => upstream.name === 'docs')
  assert.equal(docs.transport, 'stdio')
  assert.equal(docs.command, 'node')
  assert.deepEqual(docs.args, ['server.mjs'])
  assert.deepEqual(docs.env, { FOO: 'bar' })
  assert.deepEqual(docs.inheritEnv, ['PATH'])

  // Round-tripped entries may carry absent fields as explicit undefined.
  assert.deepEqual(JSON.parse(JSON.stringify(config.expose['corpus/search'])), {
    upstream: 'corpus', tool: 'search', toolset: 'ext', hide: false,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(config.expose['docs/read'])), {
    upstream: 'docs', tool: 'read', toolset: 'ext', hide: false,
  })
})

test('POST /api/add-server accepts a bare server map and defaults the toolset', async () => {
  const probe = makeProbe({ corpus: ['search'] })
  const { deps } = makeDeps({ probe: probe.factory })
  const reply = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify({ corpus: { url: 'https://corpus.example.com/mcp' } }) },
  }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    added: [{ server: 'corpus', toolset: null, tools: ['search'] }],
    errors: [],
  })
  const entry = deps.config().expose['corpus/search']
  assert.equal(entry.toolset, undefined)
  assert.equal(entry.hide, false)
})

test('POST /api/add-server keeps per-server errors and at least one success', async () => {
  const probe = makeProbe({ docs: ['read'] }, new Set(['broken']))
  const { deps } = makeDeps({ probe: probe.factory })
  const reply = await handleAdminRequest(deps, post(['add-server'], {
    json: {
      json_text: JSON.stringify({
        broken: { url: 'https://broken.example.com/mcp' },
        docs: { command: 'node' },
      }),
    },
  }))
  assert.equal(reply.status, 200)
  assert.deepEqual(jsonBody(reply), {
    added: [{ server: 'docs', toolset: null, tools: ['read'] }],
    errors: [{ server: 'broken', error: 'failed to fetch tools: probe failed' }],
  })
})

test('POST /api/add-server answers 400 when no server succeeds', async () => {
  const probe = makeProbe({}, new Set(['broken']))
  const { deps, persisted } = makeDeps({ probe: probe.factory })
  const reply = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify({ broken: { url: 'https://broken.example.com/mcp' } }) },
  }))
  assert.equal(reply.status, 400)
  assert.deepEqual(jsonBody(reply), {
    added: [],
    errors: [{ server: 'broken', error: 'failed to fetch tools: probe failed' }],
  })
  assert.equal(persisted.length, 0)
})

test('POST /api/add-server rejects malformed input', async () => {
  const { deps } = makeDeps()
  const invalidJson = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: '{not json' },
  }))
  assert.equal(invalidJson.status, 400)
  assert.match(jsonBody(invalidJson).error, /^Invalid JSON: /)

  const topLevel = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify([1, 2]) },
  }))
  assert.equal(topLevel.status, 400)
  assert.deepEqual(jsonBody(topLevel), { error: 'Top-level JSON must be an object' })

  const empty = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify({}) },
  }))
  assert.equal(empty.status, 400)
  assert.deepEqual(jsonBody(empty), {
    added: [],
    errors: [{ server: '*', error: 'no servers added' }],
  })

  const noEndpoint = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify({ x: {} }) },
  }))
  assert.equal(noEndpoint.status, 400)
  assert.deepEqual(jsonBody(noEndpoint), {
    added: [],
    errors: [{ server: 'x', error: "server 'x': spec must have 'command' or 'url'" }],
  })
})

test('POST /api/add-server dedupes existing upstreams and expose keys', async () => {
  const probe = makeProbe({ gh: ['code_search', 'new_tool'] })
  const { deps } = makeDeps({ probe: probe.factory })
  const reply = await handleAdminRequest(deps, post(['add-server'], {
    json: { json_text: JSON.stringify({ gh: { url: 'https://other.example.com/mcp' } }) },
  }))
  assert.equal(reply.status, 200)
  // `gh/code` already exposes code_search under a custom key, so the generated
  // `gh/code_search` key is new — same as the retired service.
  assert.deepEqual(jsonBody(reply), {
    added: [{ server: 'gh', toolset: null, tools: ['code_search', 'new_tool'] }],
    errors: [],
  })
  const config = deps.config()
  assert.equal(config.upstreams.filter((upstream) => upstream.name === 'gh').length, 1)
  assert.equal(config.upstreams.find((upstream) => upstream.name === 'gh').url, 'https://gh.example.com/mcp')
  assert.ok(config.expose['gh/new_tool'])
  assert.ok(config.expose['gh/code_search'])
  assert.equal(config.expose['gh/code_search'].tool, 'code_search')
})

// --- /api/calls + routing -------------------------------------------------------------

test('GET /api/calls returns recorded calls newest first', async () => {
  const callLog = [
    { ts: 1, tool: 'old', upstream: 'gh', ok: true, latencyMs: 1 },
    { ts: 2, tool: 'new', upstream: 'gh', ok: false, latencyMs: 2, error: 'HTTP 500' },
  ]
  const { deps } = makeDeps({ callLog })
  assert.deepEqual(jsonBody(await handleAdminRequest(deps, get(['calls']))), [callLog[1], callLog[0]])
})

test('unknown admin routes and method mismatches answer 404 with an error body', async () => {
  const { deps } = makeDeps()
  const unknown = await handleAdminRequest(deps, get(['nope']))
  assert.equal(unknown.status, 404)
  assert.deepEqual(jsonBody(unknown), { error: 'Not Found' })
  const mismatch = await handleAdminRequest(deps, get(['keys', 'gh', 'resume']))
  assert.equal(mismatch.status, 404)
  const root = await handleAdminRequest(deps, get([]))
  assert.equal(root.status, 404)
})
