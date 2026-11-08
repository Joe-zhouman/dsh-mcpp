/**
 * Minimal MCP stdio server used by the hermetic upstream-transport tests.
 *
 * It reads one JSON-RPC request per stdin line (which is the only client-side
 * framing the transport writes) and answers with either newline-delimited JSON
 * (default) or `Content-Length` framed blocks (`--framing=content-length`).
 *
 * Behavior switches:
 *   --mode=normal   answer initialize / tools/list / tools/call (default)
 *   --mode=hang     complete the handshake, then never answer anything else
 *
 * Tools it exposes: `echo` (answers with its own arguments), `env` (answers
 * with selected child environment variables), `exit` (answers, then exits 0),
 * `die` (exits 0 with no answer), `rpc-error` (answers with a JSON-RPC error).
 */

import fs from 'node:fs'
import process from 'node:process'
import readline from 'node:readline'

const options = new Map()
for (const raw of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(raw)
  if (match !== null) {
    options.set(match[1], match[2])
  }
}
const framing = options.get('framing') ?? 'line'
const mode = options.get('mode') ?? 'normal'

const pidFile = process.env.MCPP_TEST_PID_FILE
if (pidFile !== undefined) {
  fs.appendFileSync(pidFile, `${process.pid}\n`)
}

/** Environment variables the `env` tool reports, so tests can assert delivery. */
const ENV_KEYS = ['MCPP_TEST_MARKER', 'MCPP_TEST_INHERITED', 'MCPP_TEST_LEAK', 'PATH']

/**
 * Encode one message in the configured response framing.
 * @param {string} body - serialized JSON.
 * @returns {string} wire text.
 */
function encode(body) {
  if (framing === 'content-length') {
    // Official SDK framing: Content-Length first, then (as some servers do) a
    // content type; a blank line terminates the header block.
    return (
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      body
    )
  }
  return `${body}\n`
}

/**
 * Write one JSON-RPC message to stdout.
 * @param {unknown} message - message to encode.
 */
function send(message) {
  process.stdout.write(encode(JSON.stringify(message)))
}

/**
 * Write one successful result response.
 * @param {number} id - request id.
 * @param {unknown} result - JSON-RPC result member.
 */
function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

/**
 * Exit once everything already written to stdout reached the pipe.
 * @param {number} code - process exit code.
 */
function exitAfterFlush(code) {
  process.stdout.write('', () => {
    process.exit(code)
  })
}

/**
 * Handle one decoded JSON-RPC request.
 * @param {any} request - decoded request object.
 */
function handle(request) {
  const method = request.method
  if (method === 'initialize') {
    sendResult(request.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-stdio', version: '0.0.0' },
    })
    return
  }
  if (method === 'notifications/initialized') {
    return
  }
  if (mode === 'hang') {
    // Handshake succeeded; everything after it stays unanswered on purpose.
    return
  }
  if (method === 'tools/list') {
    sendResult(request.id, {
      tools: [
        { name: 'echo', description: 'Echo the call arguments' },
        { name: 'env', description: 'Report selected child environment variables' },
        { name: 'exit', description: 'Answer, then exit the process' },
        { name: 'die', description: 'Exit the process without answering' },
        { name: 'rpc-error', description: 'Answer with a JSON-RPC error' },
      ],
    })
    return
  }
  if (method === 'tools/call') {
    const params = request.params ?? {}
    const args = params.arguments ?? {}
    switch (params.name) {
      case 'echo':
        sendResult(request.id, {
          content: [{ type: 'text', text: JSON.stringify(args) }],
        })
        return
      case 'env': {
        const seen = {}
        for (const key of ENV_KEYS) {
          seen[key] = process.env[key] ?? null
        }
        sendResult(request.id, {
          content: [{ type: 'text', text: JSON.stringify(seen) }],
        })
        return
      }
      case 'exit':
        sendResult(request.id, { content: [{ type: 'text', text: 'bye' }] })
        exitAfterFlush(0)
        return
      case 'die':
        // No answer: the client must observe EOF and fail the pending caller.
        process.exit(0)
        return
      case 'rpc-error':
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'boom' } })
        return
      default:
        sendResult(request.id, { content: [{ type: 'text', text: 'ok' }] })
        return
    }
  }
  if (typeof request.id === 'number') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `unknown method ${method}` },
    })
  }
}

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  handle(request)
})
