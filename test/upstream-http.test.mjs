/**
 * Hermetic tests for the Streamable-HTTP upstream transport. Every test talks
 * to a throwaway `node:http` server on 127.0.0.1, so no external network or
 * real MCP endpoint is involved.
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'

import { UpstreamHttpError, UpstreamRpcError, UpstreamTransportError } from '../src/errors.ts'
import { HttpTransport, parseSseJson } from '../src/upstream-http.ts'

/**
 * Start a throwaway HTTP server that records every request.
 * @param {(ctx: { req: http.IncomingMessage, res: http.ServerResponse, body: any, index: number }) => unknown} handler
 *   called once per request, after its body was read.
 * @returns {Promise<{ url: string, requests: any[], close: () => Promise<void> }>}
 */
async function startServer(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      const record = { method: req.method, url: req.url, headers: req.headers, body }
      requests.push(record)
      try {
        const returned = handler({ req, res, body, index: requests.length - 1 })
        if (returned instanceof Promise) {
          returned.catch((error) => {
            if (!res.headersSent) {
              res.writeHead(500)
              res.end('handler error')
            } else {
              res.destroy()
            }
          })
        }
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('handler error')
        } else {
          res.destroy()
        }
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

/**
 * Write one JSON body response.
 * @param {http.ServerResponse} res - server response.
 * @param {unknown} body - JSON-serializable body.
 * @param {Record<string, string>} [headers] - extra response headers.
 */
function respondJson(res, body, headers = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

/**
 * Build a handler that speaks the stateless/sessionful Streamable-HTTP handshake.
 * @param {{ sessionId?: string | null, tools?: unknown[],
 *   onList?: (ctx: any) => unknown }} [options]
 * @returns {(ctx: any) => unknown} request handler.
 */
function mcpHandler({ sessionId = null, tools = [{ name: 'search' }], onList } = {}) {
  return ({ req, res, body }) => {
    if (body.method === 'initialize') {
      respondJson(
        res,
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25' } },
        sessionId === null ? {} : { 'Mcp-Session-Id': sessionId },
      )
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    if (body.method === 'tools/list') {
      if (onList !== undefined) {
        onList({ req, res, body })
        return
      }
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: { tools } })
      return
    }
    if (body.method === 'tools/call') {
      respondJson(res, {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: 'ok' }] },
      })
      return
    }
    res.writeHead(500)
    res.end('unexpected method')
  }
}

test('initialize handshake carries the session id on later requests', async (t) => {
  const server = await startServer(
    mcpHandler({ sessionId: 'sess-1', tools: [{ name: 'search', description: 'Search repos' }] }),
  )
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'test', url: server.url })
  t.after(() => transport.close())

  const tools = await transport.listTools()

  assert.deepEqual(tools, [{ name: 'search', description: 'Search repos' }])
  assert.equal(server.requests.length, 3)

  const [initialize, initialized, list] = server.requests
  assert.equal(initialize.url, '/mcp')
  assert.equal(initialize.method, 'POST')
  assert.equal(initialize.body.method, 'initialize')
  assert.deepEqual(initialize.body.params, {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'mcpp', version: '0.1.0' },
  })
  // The handshake request itself must not claim a session it does not have yet.
  assert.equal(initialize.headers['mcp-session-id'], undefined)
  assert.equal(initialize.headers['content-type'], 'application/json')
  assert.equal(initialize.headers.accept, 'application/json, text/event-stream')

  assert.equal(initialized.body.method, 'notifications/initialized')
  assert.equal(initialized.headers['mcp-session-id'], 'sess-1')
  // A notification has no id.
  assert.equal(initialized.body.id, undefined)

  assert.equal(list.body.method, 'tools/list')
  assert.equal(list.headers['mcp-session-id'], 'sess-1')
})

test('stateless upstream works without a session id', async (t) => {
  const server = await startServer(mcpHandler({ sessionId: null }))
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'stateless', url: server.url })
  t.after(() => transport.close())

  assert.deepEqual(await transport.listTools(), [{ name: 'search' }])
  assert.equal(server.requests.length, 2)
  assert.equal(server.requests[1].body.method, 'tools/list')
  assert.equal(server.requests[1].headers['mcp-session-id'], undefined)
})

test('auth headers are fetched fresh for every request', async (t) => {
  const server = await startServer(mcpHandler({ sessionId: null }))
  t.after(() => server.close())
  let calls = 0
  const transport = new HttpTransport({
    name: 'ctx7',
    url: server.url,
    getAuth: () => {
      calls += 1
      return { CONTEXT7_API_KEY: `ctx-${calls}` }
    },
  })
  t.after(() => transport.close())

  await transport.listTools()
  await transport.listTools()

  assert.equal(calls, 4) // initialize + tools/list, twice
  const keys = server.requests.map((request) => request.headers['context7_api_key'])
  assert.deepEqual(keys, ['ctx-1', 'ctx-2', 'ctx-3', 'ctx-4'])
  assert.ok(server.requests.every((request) => request.headers.authorization === undefined))
})

test('endpoint keeps an existing /mcp segment case-insensitively and appends otherwise', async (t) => {
  const server = await startServer(mcpHandler({ sessionId: null }))
  t.after(() => server.close())

  for (const [configured, expectedPath] of [
    [`${server.url}/Mcp`, '/Mcp'],
    [`${server.url}/mcp`, '/mcp'],
    [`${server.url}/mcp/`, '/mcp'],
    [server.url, '/mcp'],
  ]) {
    const transport = new HttpTransport({ name: 'endpoint', url: configured })
    try {
      await transport.listTools()
    } finally {
      await transport.close()
    }
    assert.equal(server.requests.at(-1).url, expectedPath, `configured ${configured}`)
  }
})

test('parses a text/event-stream response body', async (t) => {
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25' } })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'event: message\n' +
        'data: {"jsonrpc":"2.0",\n' +
        'data: "id":2,"result":{"tools":[{"name":"sse-tool"}]}}\n' +
        '\n',
    )
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'sse', url: server.url })
  t.after(() => transport.close())

  assert.deepEqual(await transport.listTools(), [{ name: 'sse-tool' }])
})

test('recovers the session when the upstream answers 404 and retries once', async (t) => {
  let initializeCount = 0
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      initializeCount += 1
      respondJson(
        res,
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25' } },
        { 'Mcp-Session-Id': `sess-${initializeCount}` },
      )
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    if (body.method === 'tools/list') {
      if (server.requests.at(-1).headers['mcp-session-id'] === 'sess-1') {
        res.writeHead(404)
        res.end('{"error":"session expired"}')
        return
      }
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'retried' }] } })
      return
    }
    res.writeHead(500)
    res.end()
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'retry-404', url: server.url })
  t.after(() => transport.close())

  const tools = await transport.listTools()

  assert.deepEqual(tools, [{ name: 'retried' }])
  assert.equal(initializeCount, 2)
  assert.equal(server.requests.length, 6)
  assert.deepEqual(
    server.requests.map((request) => request.body.method),
    ['initialize', 'notifications/initialized', 'tools/list', 'initialize', 'notifications/initialized', 'tools/list'],
  )
  assert.equal(server.requests[2].headers['mcp-session-id'], 'sess-1')
  assert.equal(server.requests[5].headers['mcp-session-id'], 'sess-2')
})

test('rebuilds the connection and retries once after a dropped socket', async (t) => {
  let initializeCount = 0
  let listCount = 0
  const server = await startServer(({ req, res, body }) => {
    if (body.method === 'initialize') {
      initializeCount += 1
      respondJson(
        res,
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25' } },
        { 'Mcp-Session-Id': `sess-${initializeCount}` },
      )
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    if (body.method === 'tools/list') {
      listCount += 1
      if (listCount === 1) {
        req.socket.destroy()
        return
      }
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'recovered' }] } })
      return
    }
    res.writeHead(500)
    res.end()
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'drop', url: server.url })
  t.after(() => transport.close())

  const tools = await transport.listTools()

  assert.deepEqual(tools, [{ name: 'recovered' }])
  // The session was discarded, so the retry re-handshakes before listing again.
  assert.equal(initializeCount, 2)
  assert.deepEqual(
    server.requests.map((request) => request.body.method),
    ['initialize', 'notifications/initialized', 'tools/list', 'initialize', 'notifications/initialized', 'tools/list'],
  )
})

test('does not retry an HTTP error response', async (t) => {
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'sess-1' })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    res.writeHead(500)
    res.end('boom')
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'server-error', url: server.url })
  t.after(() => transport.close())

  await assert.rejects(transport.listTools(), (error) => {
    assert.ok(error instanceof UpstreamHttpError)
    assert.equal(error.status, 500)
    assert.match(error.message, /Upstream 'server-error' returned 500/)
    return true
  })
  // Exactly one attempt: initialize, initialized notification, tools/list.
  assert.equal(server.requests.length, 3)
})

test('turns a JSON-RPC error member into UpstreamRpcError', async (t) => {
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'sess-1' })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    respondJson(res, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'no such tool' } })
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'rpc-error', url: server.url })
  t.after(() => transport.close())

  await assert.rejects(transport.callTool('missing', {}), (error) => {
    assert.ok(error instanceof UpstreamRpcError)
    assert.match(error.message, /JSON-RPC error: no such tool/)
    return true
  })
})

test('falls back to JSON for an unknown content type and rejects an HTML body', async (t) => {
  let listCount = 0
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'sess-1' })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    listCount += 1
    if (listCount === 1) {
      // No proper content type, but the body is JSON anyway.
      res.writeHead(200)
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'fallback' }] } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html>not json</html>')
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'content-type', url: server.url })
  t.after(() => transport.close())

  assert.deepEqual(await transport.listTools(), [{ name: 'fallback' }])
  await assert.rejects(transport.listTools(), (error) => {
    assert.ok(error instanceof UpstreamHttpError)
    assert.equal(error.status, 200)
    assert.match(error.message, /unsupported content-type 'text\/html'/)
    return true
  })
})

test('times out a read and reports a transport error', async (t) => {
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'sess-1' })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    // Never answer tools/list: the client's read timer must fire.
  })
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'slow', url: server.url, readTimeout: 0.2 })
  t.after(() => transport.close())

  await assert.rejects(transport.listTools(), (error) => {
    assert.ok(error instanceof UpstreamTransportError)
    assert.match(error.message, /Upstream 'slow' transport error: read timeout after 0\.2s/)
    return true
  })
  // The timeout was retried once before surfacing: 2 handshakes + 2 lists.
  assert.equal(server.requests.length, 6)
})

test('connect timeout does not abort a response that is merely slow', async (t) => {
  const server = await startServer(({ res, body }) => {
    if (body.method === 'initialize') {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'sess-1' })
      return
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    // Connected long before this fires: only the read timer may still apply.
    setTimeout(() => {
      respondJson(res, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'slow' }] } })
    }, 300)
  })
  t.after(() => server.close())
  const transport = new HttpTransport({
    name: 'slow-response',
    url: server.url,
    connectTimeout: 0.1,
    readTimeout: 5,
  })
  t.after(() => transport.close())

  assert.deepEqual(await transport.listTools(), [{ name: 'slow' }])
})

test('close is idempotent and rejects later calls', async (t) => {
  const server = await startServer(mcpHandler({ sessionId: null }))
  t.after(() => server.close())
  const transport = new HttpTransport({ name: 'closing', url: server.url })

  await transport.close()
  await transport.close()
  await assert.rejects(transport.listTools(), UpstreamTransportError)
  assert.equal(server.requests.length, 0)
})

test('parseSseJson joins multi-line data and flushes a trailing event', () => {
  assert.deepEqual(parseSseJson('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'), {
    jsonrpc: '2.0',
    id: 1,
    result: {},
  })
  // Multi-line data is joined with newlines; CRLF and a missing final blank
  // line are both accepted.
  assert.deepEqual(
    parseSseJson('event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"ok":true}}\r\n'),
    { jsonrpc: '2.0', id: 2, result: { ok: true } },
  )
  // A first non-object event is skipped; the next valid one wins.
  assert.deepEqual(parseSseJson('data: [1,2]\n\ndata: {"id":3}\n\n'), { id: 3 })
  // Leading whitespace after `data:` is stripped.
  assert.deepEqual(parseSseJson('data:    {"id":4}\n'), { id: 4 })
  assert.equal(parseSseJson('event: ping\n\ndata: not json\n\n'), null)
  assert.equal(parseSseJson(''), null)
})
