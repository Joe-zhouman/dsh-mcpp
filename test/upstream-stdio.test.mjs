/**
 * Hermetic tests for the stdio upstream transport. Every test spawns a small
 * Node MCP server (`fake-stdio-server.mjs`) as the child, so no external
 * process or package is involved.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { UpstreamRpcError, UpstreamTransportError } from '../src/errors.ts'
import { StdioTransport } from '../src/upstream-stdio.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FAKE_SERVER = path.join(here, 'fixtures', 'upstream', 'fake-stdio-server.mjs')
const NODE = process.execPath

/**
 * Create a transport whose child is the fake server, plus its temp bookkeeping.
 * @param {import('node:test').TestContext} t - test context owning cleanup.
 * @param {{ args?: string[], env?: Record<string, string>, inheritEnv?: string[],
 *   readTimeout?: number }} [options] - transport overrides.
 * @returns {{ transport: StdioTransport, pidFile: string }} the transport and
 *   the file where the child appends its pid on startup.
 */
function startTransport(t, { args = [], env = {}, inheritEnv, readTimeout } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpp-stdio-'))
  const pidFile = path.join(dir, 'pids.txt')
  const transport = new StdioTransport({
    name: 'fake',
    command: NODE,
    args: [FAKE_SERVER, ...args],
    env: { MCPP_TEST_PID_FILE: pidFile, ...env },
    ...(inheritEnv === undefined ? {} : { inheritEnv }),
    ...(readTimeout === undefined ? {} : { readTimeout }),
  })
  t.after(async () => {
    await transport.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { transport, pidFile }
}

/**
 * Read the pids the fake child reported so far.
 * @param {string} pidFile - pid log path.
 * @returns {number[]} recorded pids, oldest first.
 */
function readPids(pidFile) {
  if (!fs.existsSync(pidFile)) {
    return []
  }
  return fs
    .readFileSync(pidFile, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => Number(line))
}

test('newline framing: handshake, tools/list, and close', async (t) => {
  const { transport, pidFile } = startTransport(t)

  const tools = await transport.listTools()

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['echo', 'env', 'exit', 'die', 'rpc-error'],
  )
  assert.equal(tools[0].description, 'Echo the call arguments')
  assert.equal(readPids(pidFile).length, 1)

  await transport.close()
  await transport.close() // idempotent
})

test('newline framing: concurrent calls receive their own responses', async (t) => {
  const { transport } = startTransport(t)

  const results = await Promise.all([
    transport.callTool('echo', { q: 'a' }),
    transport.callTool('echo', { q: 'b' }),
    transport.callTool('echo', { q: 'c' }),
  ])

  assert.deepEqual(
    results.map((result) => result.content[0].text),
    ['{"q":"a"}', '{"q":"b"}', '{"q":"c"}'],
  )
})

test('Content-Length framing: handshake, tools/list, and tools/call', async (t) => {
  const { transport } = startTransport(t, { args: ['--framing=content-length'] })

  const tools = await transport.listTools()
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['echo', 'env', 'exit', 'die', 'rpc-error'],
  )

  const result = await transport.callTool('echo', { q: 'framed' })
  assert.equal(result.content[0].text, '{"q":"framed"}')
})

test('a JSON-RPC error member rejects the call and leaves the child usable', async (t) => {
  const { transport } = startTransport(t)

  await assert.rejects(transport.callTool('rpc-error', {}), (error) => {
    assert.ok(error instanceof UpstreamRpcError)
    assert.match(error.message, /Upstream 'fake' JSON-RPC error: boom/)
    return true
  })

  const tools = await transport.listTools()
  assert.equal(tools.length, 5)
})

test('read timeout fails only that call', async (t) => {
  const { transport } = startTransport(t, { args: ['--mode=hang'], readTimeout: 0.3 })

  await assert.rejects(transport.listTools(), (error) => {
    assert.ok(error instanceof UpstreamTransportError)
    assert.match(error.message, /Stdio upstream 'fake': read timeout after 0\.3s/)
    return true
  })
})

test('EOF fails the pending call and the next call respawns the child', async (t) => {
  const { transport, pidFile } = startTransport(t)
  await transport.listTools()
  assert.equal(readPids(pidFile).length, 1)

  await assert.rejects(transport.callTool('die', {}), (error) => {
    assert.ok(error instanceof UpstreamTransportError)
    assert.match(error.message, /stream closed \(exit code 0\)/)
    return true
  })

  const tools = await transport.listTools()
  assert.equal(tools.length, 5)
  assert.equal(readPids(pidFile).length, 2)
})

test('child env is the inherit whitelist overridden by explicit env', async (t) => {
  process.env.MCPP_TEST_LEAK = 'leak'
  process.env.MCPP_TEST_INHERITED = 'inherited'
  t.after(() => {
    delete process.env.MCPP_TEST_LEAK
    delete process.env.MCPP_TEST_INHERITED
  })
  const { transport } = startTransport(t, {
    env: { MCPP_TEST_MARKER: 'abc' },
    inheritEnv: ['PATH', 'MCPP_TEST_INHERITED'],
  })

  const result = await transport.callTool('env', {})
  const seen = JSON.parse(result.content[0].text)

  assert.equal(seen.MCPP_TEST_MARKER, 'abc')
  assert.equal(seen.MCPP_TEST_INHERITED, 'inherited')
  assert.equal(seen.MCPP_TEST_LEAK, null)
  assert.equal(typeof seen.PATH, 'string')
})

test('an empty inherit whitelist keeps only the explicit env', async (t) => {
  process.env.MCPP_TEST_LEAK = 'leak'
  t.after(() => { delete process.env.MCPP_TEST_LEAK })
  const { transport } = startTransport(t, {
    env: { MCPP_TEST_MARKER: 'abc' },
    inheritEnv: [],
  })

  const result = await transport.callTool('env', {})
  const seen = JSON.parse(result.content[0].text)

  assert.equal(seen.MCPP_TEST_MARKER, 'abc')
  // Windows always adds a fixed set of system variables (PATH, SYSTEMROOT,
  // TEMP, …) to a spawned child, so only a non-system parent variable proves
  // the whitelist gate: it must not leak.
  assert.equal(seen.MCPP_TEST_LEAK, null)
})

test('a command that cannot spawn fails as a transport error', async (t) => {
  const transport = new StdioTransport({
    name: 'missing',
    command: 'mcpp-no-such-binary-xyz',
    readTimeout: 5,
  })
  t.after(() => transport.close())

  await assert.rejects(transport.ensureProcess(), UpstreamTransportError)
})

test('closeIfUnready leaves a ready child in place', async (t) => {
  const { transport, pidFile } = startTransport(t)

  await transport.closeIfUnready() // not spawned yet
  assert.deepEqual(readPids(pidFile), [])

  await transport.ensureProcess()
  await transport.closeIfUnready() // ready: must not tear the child down
  assert.equal(readPids(pidFile).length, 1)

  const tools = await transport.listTools()
  assert.equal(tools.length, 5)
  assert.equal(readPids(pidFile).length, 1)
})

test('killNowait kills the child synchronously', async (t) => {
  const { transport, pidFile } = startTransport(t)
  await transport.ensureProcess()
  const [pid] = readPids(pidFile)
  assert.ok(pid !== undefined)

  transport.killNowait()

  // The kill reaches the OS synchronously; poll briefly for process removal.
  const deadline = Date.now() + 5000
  let alive = true
  while (alive && Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      await new Promise((resolve) => setTimeout(resolve, 25))
    } catch {
      alive = false
    }
  }
  assert.equal(alive, false, 'child process was left running')
})
