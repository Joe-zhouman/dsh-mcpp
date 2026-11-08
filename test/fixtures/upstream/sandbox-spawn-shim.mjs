/**
 * Verification-only `--import` preload: replaces `child_process.spawn` with an
 * in-memory child that emulates `fake-stdio-server.mjs`.
 *
 * The DSH Windows sandbox denies piped child stdio (EPERM), so `node --test`
 * cannot spawn the real fixture there. Loading this preload before the stdio
 * test file exercises the real transport state machine and the real test
 * assertions against an in-process stand-in:
 *
 *   node --test --test-isolation=none --experimental-strip-types --import <file-url-of-this-file> test/upstream-stdio.test.mjs
 *
 * Outside the sandbox, run the test file normally: it spawns the real fixture
 * (`fake-stdio-server.mjs`) through `process.execPath`.
 */

import cp from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import readline from 'node:readline'
import { PassThrough } from 'node:stream'

let nextPid = 4_000_000_001

class FakeChild extends EventEmitter {
  constructor(options) {
    super()
    this.pid = nextPid++
    this.stdin = new PassThrough()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.exitCode = null
    this.signalCode = null
    this.signals = []
    this.env = options.env ?? {}
    const lines = readline.createInterface({ input: this.stdin })
    lines.on('line', (line) => {
      let request
      try {
        request = JSON.parse(line)
      } catch {
        throw new Error(`fake child received a torn line: ${line.slice(0, 80)}`)
      }
      this.handle(request)
    })
  }

  send(message) {
    const body = JSON.stringify(message)
    if (this.framing === 'content-length') {
      this.stdout.write(
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          body,
      )
    } else {
      this.stdout.write(`${body}\n`)
    }
  }

  die(code = 0, signal = null) {
    if (this.exitCode !== null || this.signalCode !== null) {
      return
    }
    if (signal === null) {
      this.exitCode = code
    } else {
      this.signalCode = signal
    }
    this.stdin.destroy()
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => {
      this.emit('exit', this.exitCode, this.signalCode)
      this.emit('close', this.exitCode, this.signalCode)
    })
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal)
    if (this.exitCode !== null || this.signalCode !== null) {
      return false
    }
    setImmediate(() => {
      this.die(0, signal)
    })
    return true
  }

  handle(request) {
    const method = request.method
    if (method === 'initialize') {
      this.send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-stdio', version: '0.0.0' },
        },
      })
      return
    }
    if (method === 'notifications/initialized') {
      return
    }
    if (this.mode === 'hang') {
      return
    }
    if (method === 'tools/list') {
      this.send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            { name: 'echo', description: 'Echo the call arguments' },
            { name: 'env', description: 'Report selected child environment variables' },
            { name: 'exit', description: 'Answer, then exit the process' },
            { name: 'die', description: 'Exit the process without answering' },
            { name: 'rpc-error', description: 'Answer with a JSON-RPC error' },
          ],
        },
      })
      return
    }
    if (method === 'tools/call') {
      const params = request.params ?? {}
      const args = params.arguments ?? {}
      switch (params.name) {
        case 'echo':
          this.send({
            jsonrpc: '2.0',
            id: request.id,
            result: { content: [{ type: 'text', text: JSON.stringify(args) }] },
          })
          return
        case 'env': {
          const seen = {}
          for (const key of ['MCPP_TEST_MARKER', 'MCPP_TEST_INHERITED', 'MCPP_TEST_LEAK', 'PATH']) {
            seen[key] = this.env[key] ?? null
          }
          this.send({
            jsonrpc: '2.0',
            id: request.id,
            result: { content: [{ type: 'text', text: JSON.stringify(seen) }] },
          })
          return
        }
        case 'exit':
          this.send({
            jsonrpc: '2.0',
            id: request.id,
            result: { content: [{ type: 'text', text: 'bye' }] },
          })
          setImmediate(() => this.die(0))
          return
        case 'die':
          setImmediate(() => this.die(0))
          return
        case 'rpc-error':
          this.send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'boom' } })
          return
        default:
          this.send({
            jsonrpc: '2.0',
            id: request.id,
            result: { content: [{ type: 'text', text: 'ok' }] },
          })
          return
      }
    }
    if (typeof request.id === 'number') {
      this.send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `unknown method ${method}` },
      })
    }
  }
}

cp.spawn = (command, args = [], options = {}) => {
  if (command === 'mcpp-no-such-binary-xyz') {
    const error = new Error('spawn EPERM')
    error.code = 'EPERM'
    throw error
  }
  const child = new FakeChild(options)
  child.framing = args.includes('--framing=content-length') ? 'content-length' : 'line'
  child.mode = args.includes('--mode=hang') ? 'hang' : 'normal'
  const pidFile = child.env['MCPP_TEST_PID_FILE']
  if (pidFile !== undefined) {
    fs.appendFileSync(pidFile, `${child.pid}\n`)
  }
  return child
}
syncBuiltinESMExports()
