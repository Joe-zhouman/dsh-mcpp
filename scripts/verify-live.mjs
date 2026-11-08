/**
 * Live smoke test for a running gateway: one initialize, the per-toolset tool
 * lists, and one real `tools/call` through each of two upstreams that are safe
 * to invoke on demand (a local stdio catalog read and the SearXNG search).
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-live.mjs --base http://127.0.0.1:9021 [--token T | --config path]
 *
 * The token defaults to the reference config's `auth.token` and is never
 * printed.
 *
 * @module
 */

import { readFileSync } from 'node:fs'

/** The reference service's YAML document, used only to read the gateway token. */
const DEFAULT_CONFIG = 'C:/Users/joe/Documents/repo/skill/mcpp/config.yaml'

/** Parse `--flag value` pairs. */
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (key === undefined || !key.startsWith('--')) continue
    args[key.slice(2)] = argv[index + 1]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const base = (args['base'] ?? 'http://127.0.0.1:9020').replace(/\/$/, '')
const token = args['token'] ?? (() => {
  const text = readFileSync(args['config'] ?? DEFAULT_CONFIG, 'utf8')
  const match = /^auth:\s*\n\s*token:\s*(\S+)/m.exec(text)
  if (match === null) throw new Error('no auth.token in reference config')
  return match[1].replace(/^['"]|['"]$/g, '')
})()

/** One authenticated JSON-RPC call. */
async function rpc(path, body) {
  const started = Date.now()
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text), ms: Date.now() - started }
}

/** One authenticated GET. */
async function get(path) {
  const started = Date.now()
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
  return { status: response.status, body: await response.json(), ms: Date.now() - started }
}

const failures = []
function check(label, condition, detail) {
  if (condition) {
    process.stdout.write(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  } else {
    failures.push(label)
    process.stdout.write(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  }
}

process.stdout.write(`verify-live against ${base}\n`)

const unauthorized = await fetch(`${base}/api/upstreams`)
check('unauthenticated admin call is rejected', unauthorized.status === 401, `status ${unauthorized.status}`)

const upstreams = await get('/api/upstreams')
check('admin /api/upstreams', upstreams.status === 200 && Array.isArray(upstreams.body), `${upstreams.body.length} upstreams, ${upstreams.ms}ms`)

const toolsets = await get('/api/toolsets')
check('admin /api/toolsets', toolsets.status === 200 && toolsets.body.length > 0, toolsets.body.map((entry) => `${entry.toolset}:${entry.tools.length}`).join(' '))

let toolTotal = 0
for (const entry of toolsets.body) {
  const list = await rpc(`/${entry.toolset}/claude/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const names = (list.body.result?.tools ?? []).map((tool) => tool.name)
  toolTotal += names.length
  check(`tools/list ${entry.toolset}`, names.length === entry.tools.length, `${names.length} tools, ${list.ms}ms`)
}
check('tool surface non-empty', toolTotal > 0, `${toolTotal} tools total`)

const catalog = await rpc('/sciverse/claude/mcp', {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'mcp__sciverse__list_catalog', arguments: {} },
})
const catalogText = catalog.body.result?.content?.[0]?.text ?? ''
check('tools/call sciverse/list_catalog (stdio upstream)', catalog.status === 200 && catalogText.length > 0, `${catalog.ms}ms, ${catalogText.length} chars`)

const search = await rpc('/search/claude/mcp', {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'mcp__search__searxng', arguments: { query: 'deepseek harness', num_results: 2 } },
})
const searchText = search.body.result?.content?.[0]?.text ?? ''
check('tools/call search/searxng (http upstream)', search.status === 200 && searchText.length > 0, `${search.ms}ms, ${searchText.length} chars`)

const calls = await get('/api/calls')
check('admin /api/calls recorded the calls', calls.status === 200 && calls.body.length >= 2, `${calls.body.length} entries`)

if (failures.length > 0) {
  process.stdout.write(`\nRESULT: ${failures.length} failure(s): ${failures.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write('\nRESULT: all live checks passed\n')
