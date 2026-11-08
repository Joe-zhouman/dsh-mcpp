/**
 * A fake upstream MCP server for hermetic gateway tests: Streamable HTTP with
 * the same handshake the real upstreams use, in-process, on a random loopback
 * port.
 *
 * Behavior knobs let a test drive the failure paths without a network:
 * - `failWith(status)` makes every JSON-RPC POST answer that HTTP status,
 * - `dropSessions` makes the server reject a cached session id once (404) so
 *   the session-recovery path runs,
 * - `hang` never answers `tools/call`, for read-timeout tests.
 *
 * @module
 */

import { createServer } from 'node:http'

/** One tool the fake upstream advertises. */
function tool(name, description, schema) {
  return { name, description, inputSchema: schema }
}

/** The default tool set; `search` and `fetch_doc` exercise backtick refs. */
export const DEFAULT_TOOLS = [
  tool('search', 'Search the corpus. Prefer `doc/fetch_doc` for full text.', {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      mode: { type: 'string', enum: ['fast', 'deep'] },
    },
    required: ['query'],
  }),
  tool('fetch_doc', 'Fetch one document by id.', {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  }),
  tool('hidden_tool', 'Never exposed downstream.', { type: 'object', properties: {} }),
]

/**
 * Start a fake upstream.
 * @param options - behavior overrides and listen port (0 = OS assigned).
 * @returns handle with `url`, recorded requests, and `close()`.
 */
export async function startFakeUpstream(options = {}) {
  const tools = options.tools ?? DEFAULT_TOOLS
  const requests = []
  let nextSession = 0
  let dropSessions = options.dropSessions === true
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => { chunks.push(chunk) })
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let message
      try {
        message = JSON.parse(body)
      } catch {
        res.writeHead(400).end('bad json')
        return
      }
      requests.push({ method: message.method, headers: req.headers, body: message })
      if (options.hang === true && message.method === 'tools/call') return
      if (typeof options.failWith === 'number') {
        res.writeHead(options.failWith, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'forced' }))
        return
      }
      if (dropSessions && req.headers['mcp-session-id'] !== undefined) {
        // The retired service's real failure mode: a stale session is dropped
        // without a 404, but the recovery path is also exercised by a 404.
        if (options.dropAsStatus === 'reset') {
          req.socket.destroy()
          return
        }
        dropSessions = false
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'session gone' }))
        return
      }
      const reply = (payload, headers = {}) => {
        res.writeHead(200, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(payload))
      }
      switch (message.method) {
        case 'initialize': {
          const sessionId = `session-${++nextSession}`
          reply({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-upstream', version: '1.0.0' },
            },
          }, { 'mcp-session-id': sessionId })
          break
        }
        case 'notifications/initialized':
          res.writeHead(202).end()
          break
        case 'tools/list':
          reply({ jsonrpc: '2.0', id: message.id, result: { tools } })
          break
        case 'tools/call':
          reply({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(message.params) }] },
          })
          break
        default:
          reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } })
      }
    })
  })
  await new Promise((resolve) => { server.listen(options.port ?? 0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    port: address.port,
    requests,
    /** Flip session dropping on for a later request. */
    dropNextSession() { dropSessions = true },
    async close() {
      await new Promise((resolve) => {
        server.close(() => { resolve() })
        server.closeAllConnections()
      })
    },
  }
}
