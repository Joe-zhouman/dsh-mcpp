/**
 * End-to-end wiring of the v0.2 increment: the Cordis plugin entry, the native
 * DSH tool surface, the selection document, the same-origin routes, and the
 * `ctx.mcpp` service — driven through a fake DSH host context and a real fake
 * upstream MCP server on loopback.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../src/plugin.ts'
import { startFakeUpstream } from './fixtures/fake-upstream.mjs'

/** Poll until `predicate` holds or the deadline expires. */
async function waitFor(predicate, timeoutMs = 8000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => { setTimeout(resolve, 25) })
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Fake DSH tool registry that reports conflicts like the real one. */
function createFakeTools() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      if (definitions.has(definition.name)) {
        throw new Error(`tool "${definition.name}" is already registered`)
      }
      definitions.set(definition.name, definition)
      return () => { definitions.delete(definition.name) }
    },
  }
}

/** Fake host web server that records routes and can dispatch one request. */
function createFakeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index !== -1) routes.splice(index, 1)
      }
    },
    /** Invoke the registered handler for a path, returning the captured response. */
    async call(method, path, body) {
      const match = routes.find((route) => (route.kind === 'exact' ? route.path === path : path === route.path || path.startsWith(`${route.path}/`)))
      assert.ok(match, `no route for ${path}`)
      const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
      const request = Readable.from(chunks)
      request.method = method
      request.url = path
      request.headers = { host: '127.0.0.1:44817' }
      const response = { status: undefined, headers: undefined, body: undefined }
      const res = {
        headersSent: false,
        writeHead(status, headers) {
          this.headersSent = true
          response.status = status
          response.headers = headers
          return this
        },
        end(payload) {
          response.body = payload === undefined ? '' : payload
          response.headersSent = true
        },
      }
      await match.handler(request, res)
      let json
      try {
        json = response.body === undefined || response.body === '' ? undefined : JSON.parse(response.body)
      } catch {
        json = undefined
      }
      return {
        status: response.status,
        headers: response.headers,
        json,
        text: response.body,
      }
    },
  }
}

/** Build the fake Cordis plugin context and its capture boxes. */
function createFakeCtx() {
  const disposers = []
  const captured = { services: new Map(), tools: createFakeTools(), webServer: createFakeWebServer(), logs: [] }
  const logger = {
    info: (...args) => { captured.logs.push(`INFO ${args.join(' ')}`) },
    warn: (...args) => { captured.logs.push(`WARN ${args.join(' ')}`) },
    error: (...args) => { captured.logs.push(`ERROR ${args.join(' ')}`) },
  }
  const ctx = {
    logger,
    async effect(execute, label) {
      void label
      disposers.push(await execute())
    },
    get(name) {
      if (name === 'tools') return captured.tools
      if (name === 'webServer') return captured.webServer
      return undefined
    },
    inject(services, callback) {
      void services
      callback(ctx)
    },
    provide(name, value) {
      captured.services.set(name, value)
      return () => { captured.services.delete(name) }
    },
  }
  return { ctx, disposers, captured }
}

/**
 * Write a temp gateway configuration that exposes the fake upstream.
 * @param upstreamUrl - fake upstream MCP endpoint.
 * @param selectionPath - selection document path.
 * @returns config path and selection path.
 */
function writeFixtures(upstreamUrl, selectionPath) {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-native-'))
  const configPath = join(dir, 'config.yaml')
  writeFileSync(configPath, `# native surface fixture
server_name: mcpp
upstreams:
  - name: corpus
    url: ${upstreamUrl}
    read_timeout: 10
    list_timeout: 5
expose:
  corpus/search:
    upstream: corpus
    tool: search
    toolset: search
    as: searxng
  corpus/fetch_doc:
    upstream: corpus
    tool: fetch_doc
    toolset: get
    as: jina_markdown
  corpus/hidden_tool:
    upstream: corpus
    tool: hidden_tool
    hide: true
`, 'utf8')
  writeFileSync(selectionPath, JSON.stringify({ version: 1, enabled: ['corpus/search'] }), 'utf8')
  return { dir, configPath }
}

test('native surface registers selected tools and serves the admin routes', async (t) => {
  const upstream = await startFakeUpstream()
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-native-sel-'))
  const selectionPath = join(dir, 'selection.json')
  const { configPath } = writeFixtures(upstream.url, selectionPath)
  const { ctx, disposers, captured } = createFakeCtx()
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose()
    await upstream.close()
  })

  await apply(ctx, {
    configPath,
    host: '127.0.0.1',
    port: 0,
    nativeTools: true,
    selectionPath,
  })
  await waitFor(() => captured.webServer.routes.length > 0, 4000, 'the same-origin routes')

  await waitFor(() => captured.tools.definitions.has('mcp__search__searxng'), 8000, 'the selected native tool')
  assert.deepEqual([...captured.tools.definitions.keys()], ['mcp__search__searxng'])

  const tool = captured.tools.definitions.get('mcp__search__searxng')
  assert.equal(tool.description, 'Search the corpus. Prefer `doc/fetch_doc` for full text.')
  assert.equal(tool.parameters.type, 'object')
  assert.ok(tool.output !== undefined, 'the definition declares a canonical output')

  const value = await tool.execute({ query: 'deep learning' }, { signal: AbortSignal.timeout(5000) })
  assert.ok(Array.isArray(value.content))
  const called = upstream.requests.filter((request) => request.method === 'tools/call').at(-1)
  assert.deepEqual(called.body.params.arguments, { query: 'deep learning' })

  const catalog = await captured.webServer.call('GET', '/plugins/mcpp/ui/catalog')
  assert.equal(catalog.status, 200)
  assert.equal(catalog.json.serverName, 'mcpp')
  assert.deepEqual(catalog.json.upstreams, [{ name: 'corpus', transport: 'http' }])
  assert.deepEqual(catalog.json.registered, ['mcp__search__searxng'])
  const groups = Object.fromEntries(catalog.json.toolsets.map((group) => [group.name, group]))
  assert.deepEqual(groups['search'].tools.map((tool) => tool.name), ['mcp__search__searxng'])
  assert.equal(groups['search'].tools[0].enabled, true)
  assert.deepEqual(groups['get'].tools.map((tool) => tool.name), ['mcp__get__jina_markdown'])
  assert.equal(groups['get'].tools[0].enabled, false)
  assert.ok(!catalog.json.toolsets.some((group) => group.tools.some((tool) => tool.key === 'corpus/hidden_tool')), 'hidden tools stay out of the catalog')

  const listed = await captured.webServer.call('GET', '/plugins/mcpp/api/toolsets')
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.json.map((entry) => entry.toolset).sort(), ['get', 'mcpp', 'search'])

  const admin = await captured.webServer.call('GET', '/plugins/mcpp/admin')
  assert.equal(admin.status, 200)
  assert.match(admin.text, /__MCPP_API_BASE__/)
  assert.match(admin.headers['content-type'], /text\/html/)

  // The selection endpoint replaces the generation live.
  const saved = await captured.webServer.call('POST', '/plugins/mcpp/ui/selection', { enabled: ['corpus/fetch_doc'] })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.registered, ['mcp__get__jina_markdown'])
  await waitFor(() => !captured.tools.definitions.has('mcp__search__searxng'), 8000, 'the deselected tool to disappear')
  assert.deepEqual([...captured.tools.definitions.keys()], ['mcp__get__jina_markdown'])
})

test('a name already owned by another plugin is reported, not fatal', async (t) => {
  const upstream = await startFakeUpstream()
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-native-conflict-'))
  const selectionPath = join(dir, 'selection.json')
  const { configPath } = writeFixtures(upstream.url, selectionPath)
  writeFileSync(selectionPath, JSON.stringify({ version: 1, enabled: ['corpus/search', 'corpus/fetch_doc'] }), 'utf8')
  const { ctx, disposers, captured } = createFakeCtx()
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose()
    await upstream.close()
  })

  // Another plugin already owns one of the names.
  captured.tools.register({ name: 'mcp__get__jina_markdown', description: 'squatter', parameters: {}, output: { schema: {}, render: () => [] }, execute: async () => ({}) })

  await apply(ctx, { configPath, host: '127.0.0.1', port: 0, nativeTools: true, selectionPath })
  await waitFor(() => captured.webServer.routes.length > 0, 4000, 'the same-origin routes')

  await waitFor(() => captured.tools.definitions.has('mcp__search__searxng'), 8000, 'the free tool')
  const catalog = await captured.webServer.call('GET', '/plugins/mcpp/ui/catalog')
  assert.deepEqual(catalog.json.registered, ['mcp__search__searxng'])
  assert.equal(catalog.json.errors.length, 1)
  assert.equal(catalog.json.errors[0].name, 'mcp__get__jina_markdown')
  assert.match(catalog.json.errors[0].message, /already registered/)
})

test('the ctx.mcpp service answers catalog and call independently of the selection', async (t) => {
  const upstream = await startFakeUpstream()
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-native-service-'))
  const selectionPath = join(dir, 'selection.json')
  const { configPath } = writeFixtures(upstream.url, selectionPath)
  writeFileSync(selectionPath, JSON.stringify({ version: 1, enabled: [] }), 'utf8')
  const { ctx, disposers, captured } = createFakeCtx()
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose()
    await upstream.close()
  })

  await apply(ctx, { configPath, host: '127.0.0.1', port: 0, nativeTools: true, selectionPath })
  await waitFor(() => captured.webServer.routes.length > 0, 4000, 'the same-origin routes')

  const service = captured.services.get('mcpp')
  assert.ok(service !== undefined, 'the mcpp service is published')
  assert.deepEqual(service.upstreams(), ['corpus'])
  assert.deepEqual(service.toolsets().sort(), ['get', 'mcpp', 'search'])

  const catalog = await service.catalog()
  assert.ok(catalog.toolsets.some((group) => group.tools.some((tool) => tool.enabled === false)))
  assert.ok(catalog.toolsets.every((group) => group.tools.every((tool) => tool.registered === false)))

  // Selection is empty, yet the service can call any exposed tool.
  const result = await service.call('mcp__get__jina_markdown', { id: 'doc-1' })
  assert.ok(Array.isArray(result.content))
  const called = upstream.requests.filter((request) => request.method === 'tools/call').at(-1)
  assert.equal(called.body.params.name, 'fetch_doc')
  assert.deepEqual(called.body.params.arguments, { id: 'doc-1' })

  // The preset-facing seam picks registrable specs from the host's upstream
  // view and invokes the upstream directly, without the parameter transforms.
  const [spec] = await service.specs({ toolsets: ['search'] })
  assert.equal(spec.spec.publicName, 'mcp__search__searxng')
  assert.equal(spec.timeoutMs, 25000)
  const invoked = await service.invoke('corpus', 'search', { query: 'unmapped' })
  assert.ok(Array.isArray(invoked.content))
  const rawCall = upstream.requests.filter((request) => request.method === 'tools/call').at(-1)
  assert.equal(rawCall.body.params.name, 'search')
  assert.deepEqual(rawCall.body.params.arguments, { query: 'unmapped' })
})

