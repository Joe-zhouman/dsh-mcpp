/**
 * Verify a candidate gateway against the recorded golden snapshots alone — no
 * reference service needed. Useful after the retired service is gone: replay
 * every captured request against `--candidate` and deep-compare the response
 * with the golden body.
 *
 * Usage:
 *   node scripts/parity/verify-against-golden.mjs --candidate http://127.0.0.1:9020 [--token T | --config path]
 *
 * Exit codes: 0 all identical, 1 differences, 2 transport/auth failure.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOLDEN_DIR = fileURLToPath(new URL('../../test/fixtures/golden/', import.meta.url))
const DEFAULT_CONFIG = 'C:/Users/joe/Documents/repo/skill/mcpp/config.yaml'

/**
 * Parse `--flag value` pairs.
 * @param argv - process arguments after the script name.
 * @returns flag map.
 */
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
const candidate = (args['candidate'] ?? '').replace(/\/$/, '')
if (candidate === '') {
  process.stderr.write('usage: verify-against-golden.mjs --candidate <url> [--token T | --config path]\n')
  process.exit(2)
}

/** Gateway token, read from the reference config at runtime and never printed. */
const token = args['token'] ?? (() => {
  const text = readFileSync(args['config'] ?? DEFAULT_CONFIG, 'utf8')
  const match = /^auth:\s*\n\s*token:\s*(\S+)/m.exec(text)
  if (match === null) throw new Error('no auth.token in reference config')
  return match[1].replace(/^['"]|['"]$/g, '')
})()

/** Collect every golden file with its relative name. */
function collect(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...collect(join(dir, entry.name), `${prefix}${entry.name}/`))
    else if (entry.name.endsWith('.json')) out.push({ name: `${prefix}${entry.name}`, path: join(dir, entry.name) })
  }
  return out
}

/**
 * Normalize a JSON value so object key order never counts and arrays keep order.
 * @param value - parsed JSON.
 * @returns normalized value.
 */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
  }
  return value
}

/**
 * Report the first structural difference between two values.
 * @param left - expected.
 * @param right - actual.
 * @param path - current JSON path for the message.
 * @returns a description, or undefined when equal.
 */
function difference(left, right, path = '$') {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return `${path}.length: expected ${left.length}, got ${right.length}`
    for (let index = 0; index < left.length; index += 1) {
      const inner = difference(left[index], right[index], `${path}[${index}]`)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    for (const key of leftKeys) {
      if (!(key in right)) return `${path}.${key}: missing on candidate`
      const inner = difference(left[key], right[key], `${path}.${key}`)
      if (inner !== undefined) return inner
    }
    for (const key of rightKeys) if (!(key in left)) return `${path}.${key}: extra on candidate`
    return undefined
  }
  if (left !== right) {
    const shorten = (value) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      return text === undefined ? String(value) : text.length > 300 ? `${text.slice(0, 300)}…` : text
    }
    return `${path}: expected ${shorten(left)}, got ${shorten(right)}`
  }
  return undefined
}

const fixtures = collect(GOLDEN_DIR)
const failures = []
let identical = 0

for (const fixture of fixtures) {
  const golden = JSON.parse(readFileSync(fixture.path, 'utf8'))
  const headers = { authorization: `Bearer ${token}` }
  let response
  try {
    if (golden.method === 'POST') {
      headers['content-type'] = 'application/json'
      response = await fetch(`${candidate}${golden.endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(golden.request),
        signal: AbortSignal.timeout(120_000),
      })
    } else {
      response = await fetch(`${candidate}${golden.endpoint}`, { headers, signal: AbortSignal.timeout(120_000) })
    }
  } catch (error) {
    process.stderr.write(`transport failure on ${fixture.name}: ${error.message}\n`)
    process.exit(2)
  }
  const text = await response.text()
  if (response.status !== golden.status) {
    failures.push(`${fixture.name}: status expected ${golden.status}, got ${response.status}`)
    continue
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    failures.push(`${fixture.name}: response is not JSON`)
    continue
  }
  const diff = difference(normalize(golden.json), normalize(body))
  if (diff === undefined) identical += 1
  else failures.push(`${fixture.name}: ${diff}`)
  process.stdout.write(`\rcompared ${identical + failures.length}/${fixtures.length}`)
}
process.stdout.write('\n')

process.stdout.write(`\ngolden verification against ${candidate}\n`)
process.stdout.write(`  fixtures: ${fixtures.length}\n  identical: ${identical}\n  different: ${failures.length}\n`)
for (const failure of failures) process.stdout.write(`  - ${failure}\n`)
if (failures.length > 0) {
  process.stdout.write('\nRESULT: MISMATCH\n')
  process.exit(1)
}
process.stdout.write('\nRESULT: MATCH\n')
