/**
 * Behavior of the same-origin `/plugins/mcpp/**` routes: the admin page with
 * its injected globals, the in-process admin API passthrough, and the
 * tool-selection endpoints the settings page calls.
 *
 * Hermetic: a fake `DshWebServer` records the registrations and dispatches with
 * the host's exact-then-longest-prefix order, admin/native/selection are fakes,
 * and request bodies are `node:stream` Readables.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { registerDshRoutes } from '../src/dsh-routes.ts'

const PAGE_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="UTF-8">',
  '<title>mcpp &mdash; Admin</title>',
  '</head>',
  '<body><div id="auth-bar" class="muted"></div><p>marker</p></body>',
  '</html>',
  '',
].join('\n')

const REAL_PAGE_PATH = fileURLToPath(new URL('../static/index.html', import.meta.url))

const TMP = mkdtempSync(join(tmpdir(), 'mcpp-routes-'))
const PAGE_PATH = join(TMP, 'index.html')
writeFileSync(PAGE_PATH, PAGE_HTML)
test.after(() => { rmSync(TMP, { recursive: true, force: true }) })

/**
 * One request body stream plus the fields the routes read.
 * @param {object} [options] - method, url, body text, headers.
 * @returns {import('node:stream').Readable} a fake IncomingMessage.
 */
function makeRequest({ method = 'GET', url = '/', body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body, 'utf8')])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

/**
 * A recording ServerResponse: the handlers own writeHead/end, so this captures
 * exactly what they wrote.
 * @returns {object} fake response.
 */
function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    headersSent: false,
    body: '',
    destroyed: false,
    writeHead(status, headers = {}) {
      this.statusCode = status
      this.headers = headers
      this.headersSent = true
      return this
    },
    end(chunk) {
      if (typeof chunk === 'string') this.body += chunk
      else if (chunk !== undefined && chunk !== null) this.body += Buffer.from(chunk).toString('utf8')
      this.headersSent = true
      return this
    },
    destroy() {
      this.destroyed = true
      this.headersSent = true
    },
  }
}

/**
 * A fake `DshWebServer` matching the host's dispatch order: exact path first,
 * then the longest matching prefix.
 * @returns {object} registration records plus a dispatch helper.
 */
function createFakeWebServer() {
  const exact = new Map()
  const prefixes = new Map()
  const routes = []
  return {
    routes,
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
      routes.push(route)
      return () => {
        table.delete(route.path)
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
    resolve(pathname) {
      const matchedExact = exact.get(pathname)
      if (matchedExact !== undefined) return matchedExact
      let best
      for (const [prefix, candidate] of prefixes) {
        if (pathname !== prefix && !pathname.startsWith(prefix + '/')) continue
        if (best === undefined || prefix.length > best.path.length) best = candidate
      }
      return best
    },
    async handle(options) {
      const req = makeRequest(options)
      const res = makeResponse()
      const matched = this.resolve(new URL(req.url, 'http://placeholder').pathname)
      assert.ok(matched, `no route matched ${req.url}`)
      await matched.handler(req, res)
      return res
    },
  }
}

/** Exposed tools used by the catalog and selection assertions. */
function makeConfig() {
  return {
    serverName: 'mcpp',
    auth: { token: 'gateway-secret' },
    upstreams: [
      { name: 'search', transport: 'http', url: 'http://upstream.test/mcp', inheritEnv: [], connectTimeout: 10, readTimeout: 10, listTimeout: 10 },
      { name: 'docs', transport: 'stdio', command: process.execPath, args: [], inheritEnv: [], connectTimeout: 10, readTimeout: 10, listTimeout: 10 },
    ],
    expose: {
      'search/searxng_search': {
        upstream: 'search',
        tool: 'searxng_search',
        toolset: 'search',
        as: 'searxng',
        hide: false,
        description: 'Search the web.',
      },
      'search/hidden_tool': { upstream: 'search', tool: 'hidden_tool', hide: true },
      'docs/fetch_doc': { upstream: 'docs', tool: 'fetch_doc', hide: false, description: 'Fetch a document.' },
    },
  }
}

/**
 * In-memory selection store.
 * @param {string[]} [initial] - stable keys already enabled.
 * @returns {object} the store plus what it saw.
 */
function createSelection(initial = []) {
  let enabled = [...initial]
  const store = {
    saves: [],
    path: () => join(TMP, 'selection.json'),
    load: async () => ({ version: 1, enabled: [...enabled] }),
    save: async (next) => {
      store.saves.push([...next])
      enabled = [...next]
    },
    current: () => [...enabled],
  }
  return store
}

/**
 * In-memory native tool surface.
 * @param {object} [options] - initial registrations and sync failures.
 * @returns {object} the view plus what it saw.
 */
function createNative({ registered = [], errors = [] } = {}) {
  let names = [...registered]
  const view = {
    resyncs: 0,
    registeredNames: () => [...names],
    errors: () => [...errors],
    resync: async () => {
      view.resyncs += 1
      return { registered: [...names], errors: [...errors] }
    },
    setRegistered: (next) => { names = [...next] },
  }
  return view
}

/** A logger recording leveled messages. */
function createLogger() {
  const entries = []
  return {
    entries,
    info: (message) => entries.push(['info', message]),
    warn: (message) => entries.push(['warn', message]),
    error: (message) => entries.push(['error', message]),
  }
}

/** Upstream transports the admin `/api/tools` preview probes. */
function makeTransports() {
  const tools = {
    searxng_search: {
      name: 'searxng_search',
      description: 'Upstream search.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    },
  }
  return new Map([
    ['search', {
      name: 'search',
      listTools: async () => [tools.searxng_search],
      callTool: async () => ({}),
      close: async () => {},
    }],
  ])
}

/**
 * The admin dependencies the in-process handler expects; only the fields the
 * exercised routes touch are meaningful.
 * @param {object} runtime - live gateway runtime fake.
 * @param {Map} transports - upstream transports by name.
 * @returns {object} fake AdminDeps plus persisted configurations.
 */
function createAdminDeps(runtime, transports) {
  const persisted = []
  return {
    persisted,
    config: () => runtime.config,
    transport: (name) => transports.get(name),
    recordCall: () => {},
    configPath: join(TMP, 'config.yaml'),
    keypool: () => undefined,
    keypools: () => new Map(),
    persistConfig: async (next) => { persisted.push(next); runtime.config = next },
    createProbeTransport: () => { throw new Error('probe transports are not available in this test') },
    callLogSnapshot: () => [],
    logger: createLogger(),
  }
}

/**
 * Register the routes against a fake host server.
 * @param {object} [overrides] - dependency overrides.
 * @returns {Promise<object>} the harness: server, deps, fakes, and request helper.
 */
async function createHarness(overrides = {}) {
  const webServer = createFakeWebServer()
  const runtime = { config: makeConfig() }
  const selection = createSelection(['search/searxng_search'])
  const native = createNative({ registered: ['mcp__search__searxng'] })
  const deps = {
    runtime,
    admin: createAdminDeps(runtime, makeTransports()),
    native,
    selection,
    logger: createLogger(),
    adminHtmlPath: PAGE_PATH,
    publicOrigin: () => 'http://127.0.0.1:9020',
    token: () => 'gateway-secret',
    ...overrides,
  }
  const dispose = registerDshRoutes(webServer, deps)
  return {
    webServer,
    deps,
    runtime,
    selection,
    native,
    dispose,
    request: (options) => webServer.handle(options),
  }
}

/**
 * Parse the JSON body of a fake response.
 * @param {object} res - fake response.
 * @returns {unknown} parsed body.
 */
function jsonBody(res) {
  return JSON.parse(res.body)
}

/**
 * Read the three globals out of the page's injection script.
 * @param {string} html - served admin page.
 * @returns {{base: string, origin: string, token: string}} the injected values.
 */
function parseInjection(html) {
  const match = /<script>window\.__MCPP_API_BASE__=(.*?);window\.__MCPP_PUBLIC_ORIGIN__=(.*?);window\.__MCPP_TOKEN__=(.*?);<\/script>/.exec(html)
  assert.ok(match, 'injection script present')
  return { base: JSON.parse(match[1]), origin: JSON.parse(match[2]), token: JSON.parse(match[3]) }
}

test('registry: registers the documented routes and disposes every one', async () => {
  const { webServer, dispose } = await createHarness()
  assert.deepEqual(
    webServer.routes.map((route) => `${route.kind} ${route.path}`),
    [
      'exact /plugins/mcpp/admin',
      'prefix /plugins/mcpp/api',
      'exact /plugins/mcpp/ui/catalog',
      'exact /plugins/mcpp/ui/selection',
      'exact /plugins/mcpp/ui/sync',
      'prefix /plugins/mcpp',
    ],
  )
  dispose()
  assert.equal(webServer.routes.length, 0)
  assert.equal(webServer.resolve('/plugins/mcpp/admin'), undefined)
  dispose() // idempotent
})

test('admin page: injects the three globals into the head and serves HTML', async () => {
  const { request } = await createHarness()
  const res = await request({ url: '/plugins/mcpp/admin' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
  const injected = parseInjection(res.body)
  assert.deepEqual(injected, {
    base: '/plugins/mcpp/api',
    origin: 'http://127.0.0.1:9020',
    token: 'gateway-secret',
  })
  const scriptAt = res.body.indexOf('<script>window.__MCPP_API_BASE__=')
  assert.ok(scriptAt !== -1 && scriptAt < res.body.indexOf('</head>'), 'script sits before </head>')
  assert.ok(res.body.includes('<title>mcpp &mdash; Admin</title>'), 'page markup is preserved')
  assert.ok(res.body.includes('<p>marker</p>'))
})

test('admin page: reads the artifact once and caches it', async () => {
  const path = join(TMP, 'cached.html')
  writeFileSync(path, '<html><head></head><body>v1</body></html>')
  const { request } = await createHarness({ adminHtmlPath: path })
  const first = await request({ url: '/plugins/mcpp/admin' })
  assert.ok(first.body.includes('v1'))
  writeFileSync(path, '<html><head></head><body>v2</body></html>')
  const second = await request({ url: '/plugins/mcpp/admin' })
  assert.ok(second.body.includes('v1'), 'cached page is served')
  assert.ok(!second.body.includes('v2'))
})

test('admin page: an injected value cannot close the script element', async () => {
  const token = 'tok</script><script>alert(1)</script>'
  const { request } = await createHarness({ token: () => token })
  const res = await request({ url: '/plugins/mcpp/admin' })
  assert.equal(res.statusCode, 200)
  assert.equal(parseInjection(res.body).token, token, 'value round-trips through JSON')
  assert.ok(!res.body.includes(token), 'raw token text never reaches the markup')
  assert.ok(!res.body.includes('</script><script>alert(1)'), 'no second script element')
})

test('admin page: serves the shipped static page with the globals injected', async () => {
  const { request } = await createHarness({ adminHtmlPath: REAL_PAGE_PATH })
  const res = await request({ url: '/plugins/mcpp/admin' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(parseInjection(res.body), {
    base: '/plugins/mcpp/api',
    origin: 'http://127.0.0.1:9020',
    token: 'gateway-secret',
  })
  assert.ok(res.body.indexOf('<script>window.__MCPP_API_BASE__=') < res.body.indexOf('</head>'))
  assert.ok(res.body.includes('function getToken()'), 'page body still ships')
})

test('static page: reads all three injected globals with location fallbacks', () => {
  const page = readFileSync(REAL_PAGE_PATH, 'utf8')
  assert.ok(page.includes('window.__MCPP_TOKEN__ !== undefined'))
  assert.ok(page.includes('window.__MCPP_API_BASE__ ||'))
  assert.ok(page.includes('window.__MCPP_PUBLIC_ORIGIN__ || location.origin'))
})

test('catalog: groups exposed tools by toolset with selection and live state', async () => {
  const { request, native } = await createHarness()
  native.setRegistered(['mcp__search__searxng'])
  const res = await request({ url: '/plugins/mcpp/ui/catalog' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(jsonBody(res), {
    serverName: 'mcpp',
    publicOrigin: 'http://127.0.0.1:9020',
    toolsets: [
      {
        name: 'search',
        default: false,
        tools: [{
          key: 'search/searxng_search',
          name: 'mcp__search__searxng',
          description: 'Search the web.',
          enabled: true,
        }],
      },
      {
        name: 'mcpp',
        default: true,
        tools: [{
          key: 'docs/fetch_doc',
          name: 'mcp__mcpp__fetch_doc',
          description: 'Fetch a document.',
          enabled: false,
        }],
      },
    ],
    registered: ['mcp__search__searxng'],
    errors: [],
    upstreams: [
      { name: 'search', transport: 'http' },
      { name: 'docs', transport: 'stdio' },
    ],
  })
})

test('catalog: reports registration failures and the live enabled set', async () => {
  const selection = createSelection(['docs/fetch_doc'])
  const native = createNative({
    registered: ['mcp__mcpp__fetch_doc'],
    errors: [{ name: 'mcp__search__searxng', message: 'name already registered' }],
  })
  const { request } = await createHarness({ selection, native })
  const body = jsonBody(await request({ url: '/plugins/mcpp/ui/catalog' }))
  assert.deepEqual(body.errors, [{ name: 'mcp__search__searxng', message: 'name already registered' }])
  const tools = body.toolsets.flatMap((toolset) => toolset.tools)
  assert.deepEqual(tools.map((tool) => [tool.key, tool.enabled]), [
    ['search/searxng_search', false],
    ['docs/fetch_doc', true],
  ])
})

test('catalog: keeps every exposed toolset even when all tools are hidden', async () => {
  const runtime = { config: makeConfig() }
  runtime.config.expose = {
    'search/hidden_tool': { upstream: 'search', tool: 'hidden_tool', hide: true },
  }
  const { request } = await createHarness({ runtime })
  const body = jsonBody(await request({ url: '/plugins/mcpp/ui/catalog' }))
  assert.deepEqual(body.toolsets, [])
})

test('selection: saves the string entries then re-syncs the native surface', async () => {
  const { request, selection, native } = await createHarness()
  native.setRegistered(['mcp__search__searxng', 'mcp__mcpp__fetch_doc'])
  const res = await request({
    method: 'POST',
    url: '/plugins/mcpp/ui/selection',
    body: JSON.stringify({ enabled: ['search/searxng_search', 7, 'docs/fetch_doc', null] }),
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(selection.saves, [['search/searxng_search', 'docs/fetch_doc']])
  assert.deepEqual(selection.current(), ['search/searxng_search', 'docs/fetch_doc'])
  assert.equal(native.resyncs, 1)
  assert.deepEqual(jsonBody(res), {
    ok: true,
    registered: ['mcp__search__searxng', 'mcp__mcpp__fetch_doc'],
    errors: [],
  })
})

test('selection: an empty array clears the selection', async () => {
  const { request, selection } = await createHarness()
  const res = await request({ method: 'POST', url: '/plugins/mcpp/ui/selection', body: '{"enabled":[]}' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(selection.saves, [[]])
  assert.deepEqual(jsonBody(res), { ok: true, registered: ['mcp__search__searxng'], errors: [] })
})

test('selection: rejects bodies that are not an object with the enabled array', async () => {
  const { request, selection } = await createHarness()
  const cases = [
    { body: '[]', error: 'body must be a JSON object' },
    { body: '"search"', error: 'body must be a JSON object' },
    { body: 'null', error: 'body must be a JSON object' },
    { body: '{}', error: "'enabled' must be an array of stable tool keys" },
    { body: '{"enabled":"search/searxng_search"}', error: "'enabled' must be an array of stable tool keys" },
    { body: 'not json', error: /^invalid JSON body: / },
  ]
  for (const { body, error } of cases) {
    const res = await request({ method: 'POST', url: '/plugins/mcpp/ui/selection', body })
    assert.equal(res.statusCode, 400, body)
    const parsed = jsonBody(res)
    assert.equal(parsed.ok, false, body)
    if (typeof error === 'string') assert.equal(parsed.error, error, body)
    else assert.match(parsed.error, error, body)
  }
  assert.deepEqual(selection.saves, [], 'nothing saved')
})

test('sync: re-syncs and reports the registered names and failures', async () => {
  const native = createNative({
    registered: ['mcp__search__searxng'],
    errors: [{ name: 'mcp__mcpp__fetch_doc', message: 'upstream failed' }],
  })
  const { request } = await createHarness({ native })
  const res = await request({ method: 'POST', url: '/plugins/mcpp/ui/sync' })
  assert.equal(res.statusCode, 200)
  assert.equal(native.resyncs, 1)
  assert.deepEqual(jsonBody(res), {
    ok: true,
    registered: ['mcp__search__searxng'],
    errors: [{ name: 'mcp__mcpp__fetch_doc', message: 'upstream failed' }],
  })
})

test('admin api: answers with the in-process handler status and JSON body', async () => {
  const { request } = await createHarness()
  const res = await request({ url: '/plugins/mcpp/api/client-presets' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json')
  const body = jsonBody(res)
  assert.equal(body.clients['claude-code'].naming, 'claude')
  assert.equal(body.naming_modes.claude.format, 'mcp__{server}__{tool}')
})

test('admin api: maps segments, query, and body onto the admin request', async () => {
  const harness = await createHarness()

  const identity = await harness.request({ url: '/plugins/mcpp/api/upstreams/docs' })
  assert.equal(identity.statusCode, 200)
  assert.deepEqual(jsonBody(identity), {
    name: 'docs',
    transport: 'stdio',
    env: null,
    inherit_env: [],
  })

  const claudeNames = jsonBody(await harness.request({ url: '/plugins/mcpp/api/tools?client=claude&toolset=search' }))
  assert.deepEqual(claudeNames.map((tool) => tool.name), ['mcp__search__searxng'])
  assert.deepEqual(claudeNames, [{
    name: 'mcp__search__searxng',
    description: 'Search the web.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  }])

  const defaultNames = jsonBody(await harness.request({ url: '/plugins/mcpp/api/tools?client=default&toolset=search' }))
  assert.deepEqual(defaultNames.map((tool) => tool.name), ['searxng'], 'query changes the naming mode')

  const put = await harness.request({
    method: 'PUT',
    url: '/plugins/mcpp/api/upstreams/docs',
    body: JSON.stringify({ inherit_env: ['PATH'] }),
  })
  assert.equal(put.statusCode, 200)
  assert.deepEqual(jsonBody(put), { status: 'saved', name: 'docs' })
  assert.deepEqual(harness.deps.admin.persisted.at(-1).upstreams[1].inheritEnv, ['PATH'])

  const reload = await harness.request({
    method: 'POST',
    url: '/plugins/mcpp/api/config',
    body: 'upstreams:\n  - name: search\n    url: http://upstream.test/mcp\nexpose:\n  search/searxng_search:\n    upstream: search\n    tool: searxng_search\n',
  })
  assert.equal(reload.statusCode, 200)
  assert.deepEqual(jsonBody(reload), { status: 'reloaded' })
  assert.equal(harness.deps.admin.persisted.length, 2)
  assert.equal(harness.deps.admin.persisted.at(-1).serverName, 'mcpp')

  const missing = await harness.request({ url: '/plugins/mcpp/api/upstreams/nope' })
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(jsonBody(missing), { error: 'Unknown upstream: nope' })
})

test('admin api: rejects a malformed path encoding', async () => {
  const { request } = await createHarness()
  const res = await request({ url: '/plugins/mcpp/api/upstreams/%E0%A4%A' })
  assert.equal(res.statusCode, 400)
  assert.deepEqual(jsonBody(res), { error: 'Invalid path encoding' })
})

test('fence: answers 403 with the rejection reason before any other check', async () => {
  const requests = [
    { url: '/plugins/mcpp/admin' },
    { url: '/plugins/mcpp/api/client-presets' },
    { url: '/plugins/mcpp/ui/catalog' },
    { method: 'POST', url: '/plugins/mcpp/ui/selection', body: '{"enabled":[]}' },
    { method: 'POST', url: '/plugins/mcpp/ui/sync' },
    { url: '/plugins/mcpp/unknown' },
    { method: 'POST', url: '/plugins/mcpp/ui/catalog' },
  ]
  const deps = {
    rejectRequest: (req) => (req.headers['x-fence'] === 'deny' ? 'browser request rejected' : undefined),
  }
  const { request, selection, native } = await createHarness(deps)
  for (const options of requests) {
    const res = await request({ ...options, headers: { 'x-fence': 'deny' } })
    assert.equal(res.statusCode, 403, options.url)
    assert.deepEqual(jsonBody(res), { error: 'browser request rejected' }, options.url)
  }
  assert.deepEqual(selection.saves, [])
  assert.equal(native.resyncs, 0)
  const allowed = await request({ url: '/plugins/mcpp/ui/catalog' })
  assert.equal(allowed.statusCode, 200, 'fence accepts a non-rejected request')
})

test('fence: a status-code rejection still answers a string error', async () => {
  // The DSH connection service reports 401/403 rather than reason text.
  const { request } = await createHarness({ rejectRequest: () => 403 })
  const res = await request({ url: '/plugins/mcpp/ui/catalog' })
  assert.equal(res.statusCode, 403)
  assert.deepEqual(jsonBody(res), { error: '403' })
})

test('methods: answers 405 for endpoints called with another method', async () => {
  const cases = [
    { method: 'POST', url: '/plugins/mcpp/admin' },
    { method: 'PATCH', url: '/plugins/mcpp/api/client-presets' },
    { method: 'GET', url: '/plugins/mcpp/ui/selection' },
    { method: 'GET', url: '/plugins/mcpp/ui/sync' },
    { method: 'DELETE', url: '/plugins/mcpp/ui/catalog' },
  ]
  const { request } = await createHarness()
  for (const options of cases) {
    const res = await request(options)
    assert.equal(res.statusCode, 405, `${options.method} ${options.url}`)
    assert.deepEqual(jsonBody(res), { error: 'Method Not Allowed' })
  }
})

test('unknown paths under /plugins/mcpp answer 404', async () => {
  const { request } = await createHarness()
  for (const options of [
    { url: '/plugins/mcpp' },
    { url: '/plugins/mcpp/' },
    { url: '/plugins/mcpp/unknown' },
    { url: '/plugins/mcpp/ui' },
    { method: 'POST', url: '/plugins/mcpp/unknown' },
  ]) {
    const res = await request(options)
    assert.equal(res.statusCode, 404, `${options.method ?? 'GET'} ${options.url}`)
    assert.deepEqual(jsonBody(res), { error: 'Not Found' })
  }
})

test('failures: a throwing route answers 500 and logs instead of escaping', async () => {
  const logger = createLogger()
  const { request } = await createHarness({
    logger,
    publicOrigin: () => { throw new Error('origin exploded') },
  })
  const res = await request({ url: '/plugins/mcpp/admin' })
  assert.equal(res.statusCode, 500)
  assert.deepEqual(jsonBody(res), { error: 'Internal Server Error' })
  assert.ok(logger.entries.some(([level, message]) => level === 'error' && message.includes('origin exploded')))
})
