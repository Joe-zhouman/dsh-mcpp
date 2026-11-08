/**
 * End-to-end behavior of the assembled gateway: a real listener, real upstream
 * transports (one HTTP fake, one stdio child, one failing HTTP upstream), and
 * the routes a client actually calls.
 *
 * These assertions are the executable form of the retired service's contract:
 * tool names per naming mode, backtick cross-references, parameter mapping,
 * toolset filtering, per-upstream failure isolation, auth, and the admin API.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createGateway } from '../src/bootstrap.ts'
import { startFakeUpstream } from './fixtures/fake-upstream.mjs'

const TOKEN = 'integration-token'
const STDIO_SERVER = fileURLToPath(new URL('./fixtures/fake-stdio-mcp.mjs', import.meta.url))

/**
 * Build a temp config pointing at the given upstream URLs.
 * @param corpusUrl - fake HTTP upstream MCP endpoint.
 * @param brokenUrl - upstream that always fails.
 * @returns absolute config path.
 */
function writeConfig(corpusUrl, brokenUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-config-'))
  const path = join(dir, 'config.yaml')
  writeFileSync(path, `# integration fixture
server_name: mcpp
auth:
  token: ${TOKEN}
clients:
  opencode: false
upstreams:
  - name: corpus
    url: ${corpusUrl}
    read_timeout: 10
    list_timeout: 5
  - name: broken
    url: ${brokenUrl}
    read_timeout: 5
    list_timeout: 2
  - name: docs
    transport: stdio
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(STDIO_SERVER)}]
    inherit_env: []
    env: {}
    read_timeout: 10
expose:
  corpus/search:
    upstream: corpus
    tool: search
    toolset: search
    as: searxng
    description: "Search the corpus. For full text use \`corpus/fetch_doc\`."
    params:
      - name: q
        map_from: query
        required: true
      - name: kind
        map_from: mode
        type: enum
        mapping:
          fast: fast
          deep: deep
      - name: page_size
        map_from: limit
        hidden: true
        default: 10
  corpus/fetch_doc:
    upstream: corpus
    tool: fetch_doc
    toolset: get
    as: jina_markdown
  corpus/hidden_tool:
    upstream: corpus
    tool: hidden_tool
    hide: true
  docs/document_to_pdf:
    upstream: docs
    tool: document_to_pdf
    toolset: extract
    as: document_to_pdf
    params:
      - name: url
      - name: output_format
        map_from: format
        required: false
`, 'utf8')
  return path
}

/**
 * POST one JSON-RPC message to the gateway.
 * @param base - gateway origin.
 * @param path - request path.
 * @param body - JSON-RPC message.
 * @param token - bearer token, or null to omit.
 * @returns status and parsed body.
 */
async function rpc(base, path, body, token = TOKEN) {
  const headers = { 'content-type': 'application/json' }
  if (token !== null) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}

test('gateway serves every naming mode, toolset, and call path', async (t) => {
  const upstream = await startFakeUpstream()
  const broken = await startFakeUpstream({ failWith: 500 })
  const gateway = createGateway({ configPath: writeConfig(upstream.url, broken.url), host: '127.0.0.1', port: 0 })
  const address = await gateway.start()
  const base = `http://${address.host}:${address.port}`
  t.after(async () => {
    await gateway.close()
    await upstream.close()
    await broken.close()
  })

  await t.test('initialize answers the protocol version and toolset name', async () => {
    const { status, body } = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert.equal(status, 200)
    assert.equal(body.result.protocolVersion, '2025-11-25')
    assert.deepEqual(body.result.capabilities, { tools: {} })
    assert.equal(body.result.serverInfo.name, 'mcpp/search')
  })

  await t.test('claude naming formats names, filters toolsets, and resolves backtick refs', async () => {
    const { body } = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    assert.equal(body.result.tools.length, 1)
    const [tool] = body.result.tools
    assert.equal(tool.name, 'mcp__search__searxng')
    assert.equal(tool.description, 'Search the corpus. For full text use `mcp__get__jina_markdown`.')
    assert.deepEqual(Object.keys(tool.inputSchema.properties), ['q', 'kind'])
    assert.deepEqual(tool.inputSchema.required, ['q'])
    assert.equal(tool.inputSchema.properties.kind.enum.length, 2)
  })

  await t.test('default naming leaves names bare', async () => {
    const { body } = await rpc(base, '/search/default/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' })
    assert.deepEqual(body.result.tools.map((tool) => tool.name), ['searxng'])
  })

  await t.test('a toolset with no members answers an empty list', async () => {
    const { status, body } = await rpc(base, '/mcpp/default/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/list' })
    assert.equal(status, 200)
    assert.deepEqual(body.result.tools, [])
    const legacy = await rpc(base, '/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/list' })
    assert.deepEqual(legacy.body.result.tools, [])
  })

  await t.test('stdio upstream tools are exposed like any other upstream', async () => {
    const { body } = await rpc(base, '/extract/claude/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/list' })
    assert.deepEqual(body.result.tools.map((tool) => tool.name), ['mcp__extract__document_to_pdf'])
  })

  await t.test('a failing upstream is skipped without failing the surface', async () => {
    const response = await fetch(`${base}/api/tools?client=claude`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(response.status, 200)
    const tools = await response.json()
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['mcp__extract__document_to_pdf', 'mcp__get__jina_markdown', 'mcp__search__searxng'])
  })

  await t.test('tools/call maps arguments back to upstream names', async () => {
    const { status, body } = await rpc(base, '/search/claude/mcp', {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'mcp__search__searxng', arguments: { q: 'deep learning', kind: 'deep' } },
    })
    assert.equal(status, 200)
    const called = upstream.requests.filter((request) => request.method === 'tools/call').at(-1)
    assert.deepEqual(called.body.params.arguments, { query: 'deep learning', mode: 'deep', limit: 10 })
    assert.match(body.result.content[0].text, /deep learning/)
  })

  await t.test('an invalid enum value answers -32602', async () => {
    const { body } = await rpc(base, '/search/claude/mcp', {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'mcp__search__searxng', arguments: { q: 'x', kind: 'nope' } },
    })
    assert.equal(body.error.code, -32602)
  })

  await t.test('unknown tool and unknown method are JSON-RPC errors', async () => {
    const missing = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } })
    assert.equal(missing.body.error.code, -32601)
    const unknown = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', id: 10, method: 'does/not-exist' })
    assert.equal(unknown.body.error.code, -32601)
  })

  await t.test('notifications/initialized answers 202', async () => {
    const { status } = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(status, 202)
  })

  await t.test('unknown toolset and disabled client answer 404', async () => {
    const unknownToolset = await rpc(base, '/nope/claude/mcp', { jsonrpc: '2.0', id: 11, method: 'tools/list' })
    assert.equal(unknownToolset.status, 404)
    assert.equal(unknownToolset.body.error, 'Unknown toolset: nope')
    const disabled = await rpc(base, '/search/opencode/mcp', { jsonrpc: '2.0', id: 12, method: 'tools/list' })
    assert.equal(disabled.status, 404)
  })

  await t.test('auth guards MCP and admin routes but not framework 404s', async () => {
    const missing = await rpc(base, '/search/claude/mcp', { jsonrpc: '2.0', id: 13, method: 'tools/list' }, null)
    assert.equal(missing.status, 401)
    assert.deepEqual(missing.body, { detail: 'Invalid or missing token' })
    const queryToken = await fetch(`${base}/api/upstreams?token=${TOKEN}`)
    assert.equal(queryToken.status, 200)
    assert.deepEqual(await queryToken.json(), ['corpus', 'broken', 'docs'])
    const unknown = await fetch(`${base}/does/not/exist`)
    assert.equal(unknown.status, 404)
    assert.deepEqual(await unknown.json(), { detail: 'Not Found' })
  })

  await t.test('?token= upgrades to a session cookie', async () => {
    const response = await fetch(`${base}/admin?token=${TOKEN}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)
    const cookie = response.headers.get('set-cookie') ?? ''
    assert.match(cookie, /mcpp_token=integration-token/)
    assert.match(cookie, /HttpOnly/)
    assert.match(await response.text(), /mcpp/i)
  })

  await t.test('admin API reports toolsets, tools, keys, and calls', async () => {
    const toolsets = await (await fetch(`${base}/api/toolsets`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    const names = toolsets.map((entry) => entry.toolset).sort()
    assert.deepEqual(names, ['extract', 'get', 'mcpp', 'search'])
    const tools = await (await fetch(`${base}/api/tools?toolset=search&client=claude`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    assert.deepEqual(tools.map((tool) => tool.name), ['mcp__search__searxng'])
    const keys = await (await fetch(`${base}/api/keys`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    assert.deepEqual(keys, {})
    const calls = await (await fetch(`${base}/api/calls`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    assert.ok(calls.some((call) => call.ok === true && call.tool === 'mcp__search__searxng'))
    const presets = await (await fetch(`${base}/api/client-presets`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    assert.ok(presets.naming_modes.claude.format === 'mcp__{server}__{tool}')
  })
})
