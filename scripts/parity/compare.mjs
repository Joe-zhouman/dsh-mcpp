#!/usr/bin/env node
/**
 * compare.mjs — replay every golden fixture against the reference gateway and a
 * candidate gateway, then deep-compare status + normalized JSON.
 *
 * The goldens are recorded by capture-golden.mjs. Each fixture carries its own
 * endpoint, HTTP method, and JSON-RPC request body, so this script only has to
 * replay and compare — it never hard-codes routes.
 *
 * Comparison rules:
 *   - object key order is irrelevant (both sides canonicalized);
 *   - array order is significant;
 *   - numbers compare with strict equality;
 *   - the HTTP status is compared too.
 *
 * Output: identical endpoint count, and for every mismatched endpoint the
 * smallest differing paths with both values (truncated to 300 chars). A
 * response drift against the recorded golden is reported separately as
 * informational "base drift" — it does not affect the exit code.
 *
 * Exit codes: 0 = all endpoints identical, 1 = differences, 2 = connection or
 * usage failure.
 *
 * Usage:
 *   node scripts/parity/compare.mjs --candidate http://127.0.0.1:9030
 *        [--base http://127.0.0.1:9020] [--token TOKEN] [--config PATH]
 *        [--golden DIR] [--concurrency N] [--timeout MS] [--verbose]
 */

import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_GOLDEN = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'golden');
const DEFAULT_BASE = 'http://127.0.0.1:9020';
const DEFAULT_CONFIG = 'C:/Users/joe/Documents/repo/skill/mcpp/config.yaml';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_VALUE_CHARS = 300;
const MAX_DIFFS_SHOWN_PER_ENDPOINT = 20;
const MAX_DRIFT_PATHS_SHOWN = 5;

const MISSING = Symbol('missing');

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  throw error;
}

function fail(message) {
  throw new Error(message);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function padRight(value, width) {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    base: undefined,
    candidate: undefined,
    token: undefined,
    config: undefined,
    golden: undefined,
    concurrency: undefined,
    timeoutMs: undefined,
    verbose: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf('=');
    const key = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= argv.length) usageError(`missing value for ${key}`);
      return argv[index];
    };
    switch (key) {
      case '--base':
        args.base = takeValue();
        break;
      case '--candidate':
        args.candidate = takeValue();
        break;
      case '--token':
        args.token = takeValue();
        break;
      case '--config':
        args.config = takeValue();
        break;
      case '--golden':
        args.golden = takeValue();
        break;
      case '--concurrency':
        args.concurrency = Number(takeValue());
        break;
      case '--timeout':
        args.timeoutMs = Number(takeValue());
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        usageError(`unknown argument: ${arg}`);
    }
  }
  if (args.help) return args;
  if (!args.candidate) usageError('--candidate <url> is required');
  if (args.concurrency !== undefined && (!Number.isInteger(args.concurrency) || args.concurrency < 1)) {
    usageError('--concurrency must be a positive integer');
  }
  if (args.timeoutMs !== undefined && !Number.isFinite(args.timeoutMs)) {
    usageError('--timeout must be a number of milliseconds');
  }
  return args;
}

function usage() {
  return `Usage: node scripts/parity/compare.mjs --candidate <url> [options]

Replay test/fixtures/golden/ against the reference and candidate gateways and
deep-compare the responses.

Options:
  --candidate <url>  Candidate gateway origin (required)
  --base <url>       Reference gateway origin (default ${DEFAULT_BASE})
  --token <token>    Gateway bearer token (default: auth.token from --config)
  --config <path>    Config YAML containing auth.token
                     (default ${DEFAULT_CONFIG})
  --golden <dir>     Golden fixture directory (default test/fixtures/golden)
  --concurrency <n>  Concurrent endpoint replays (default ${DEFAULT_CONCURRENCY};
                     1 = gentlest on the reference service)
  --timeout <ms>     Per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --verbose          Print one line per endpoint, including matches
  -h, --help         Show this help

Exit codes: 0 all identical, 1 differences, 2 connection/usage failure.
`;
}

/** Strip one layer of YAML single/double quotes from a scalar value. */
function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Read `auth.token` from the reference config without a YAML dependency. */
function readAuthToken(configPath) {
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (error) {
    fail(`cannot read config file ${configPath}: ${error.message}`);
  }
  let inAuth = false;
  let authIndent = -1;
  let rawToken;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (!inAuth) {
      // Top-level only: upstream blocks also carry nested `auth:` keys.
      if (indent === 0 && /^auth:\s*(#.*)?$/.test(trimmed)) {
        inAuth = true;
        authIndent = indent;
      }
      continue;
    }
    if (indent <= authIndent) break;
    const match = /^token:\s*(.*)$/.exec(trimmed);
    if (match) {
      rawToken = unquoteYamlScalar(match[1]);
      break;
    }
  }
  if (!rawToken) {
    fail(
      `no auth.token found under the top-level auth: block in ${configPath} ` +
        '(pass --token to override)',
    );
  }
  const envRef = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(rawToken);
  if (envRef) {
    const resolved = process.env[envRef[1]];
    if (!resolved) {
      fail(
        `auth.token references \${${envRef[1]}} but that environment variable ` +
          'is empty',
      );
    }
    return resolved;
  }
  return rawToken;
}

/** Recursively collect every *.json fixture, sorted by POSIX relative path. */
async function listFixtureFiles(root) {
  const files = [];
  const walk = async (directory, relative) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath, childRelative);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push({ relative: childRelative, filePath: childPath });
      }
    }
  };
  await walk(root, '');
  files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));
  return files;
}

/** Load and validate one fixture envelope. */
async function loadFixture({ relative, filePath }) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    fail(`cannot read fixture ${relative}: ${error.message}`);
  }
  let fixture;
  try {
    fixture = JSON.parse(raw);
  } catch (error) {
    fail(`fixture ${relative} is not valid JSON: ${error.message}`);
  }
  if (
    !fixture ||
    typeof fixture !== 'object' ||
    typeof fixture.endpoint !== 'string' ||
    !fixture.endpoint.startsWith('/') ||
    (fixture.method !== 'GET' && fixture.method !== 'POST') ||
    typeof fixture.status !== 'number' ||
    !('json' in fixture)
  ) {
    fail(
      `fixture ${relative} is malformed; expected ` +
        '{endpoint, method, request, status, json}. Re-capture with capture-golden.mjs.',
    );
  }
  return { ...fixture, relative };
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

/**
 * One HTTP replay of a fixture.
 *
 * @returns {Promise<{status: number, json: unknown, parseError?: string}>}
 */
async function replay(base, fixture, { token, timeoutMs }) {
  const url = `${base}${fixture.endpoint}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const init = { method: fixture.method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (fixture.request !== null && fixture.request !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(fixture.request);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const transportError = new Error(
      timeout
        ? `timed out after ${timeoutMs}ms: ${fixture.method} ${url}`
        : `connection failed: ${fixture.method} ${url} (${error.message})`,
    );
    transportError.transport = true;
    throw transportError;
  }
  const text = await response.text();
  let json;
  let parseError;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parseError = text.slice(0, 500);
  }
  return { status: response.status, json, parseError };
}

/** Cap progress chatter on a non-verbose run. */
function formatProgress(completed, total) {
  const percent = Math.round((completed / total) * 100);
  return `  progress ${completed}/${total} (${percent}%)`;
}

const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function appendKey(parentPath, key) {
  const isIdentifier = IDENTIFIER_KEY.test(key);
  if (!isIdentifier) return `${parentPath}[${JSON.stringify(key)}]`;
  return parentPath === '' ? key : `${parentPath}.${key}`;
}

function appendIndex(parentPath, index) {
  return `${parentPath}[${index}]`;
}

function rootLabel(pathValue) {
  return pathValue === '' ? '$' : pathValue;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Collect small (leaf) differences between two JSON values.
 *
 * @param {unknown} baseValue
 * @param {unknown} candidateValue
 * @param {string} pathValue path built from `.key` / `[index]` segments
 * @param {Array<{path: string, base: unknown, candidate: unknown, kind: string}>} out
 */
function diffValues(baseValue, candidateValue, pathValue, out) {
  if (baseValue === candidateValue) return;
  const baseType = typeOf(baseValue);
  const candidateType = typeOf(candidateValue);
  if (baseType !== candidateType) {
    out.push({ path: rootLabel(pathValue), base: baseValue, candidate: candidateValue, kind: 'type' });
    return;
  }
  if (baseType === 'array') {
    if (baseValue.length !== candidateValue.length) {
      out.push({
        path: `${rootLabel(pathValue)}.length`,
        base: baseValue.length,
        candidate: candidateValue.length,
        kind: 'array-length',
      });
    }
    const shared = Math.min(baseValue.length, candidateValue.length);
    for (let index = 0; index < shared; index += 1) {
      diffValues(baseValue[index], candidateValue[index], appendIndex(pathValue, index), out);
    }
    return;
  }
  if (baseType === 'object') {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(candidateValue)]);
    for (const key of [...keys].sort()) {
      const childPath = appendKey(pathValue, key);
      const inBase = Object.prototype.hasOwnProperty.call(baseValue, key);
      const inCandidate = Object.prototype.hasOwnProperty.call(candidateValue, key);
      if (!inBase) {
        out.push({ path: childPath, base: MISSING, candidate: candidateValue[key], kind: 'missing-in-base' });
        continue;
      }
      if (!inCandidate) {
        out.push({ path: childPath, base: baseValue[key], candidate: MISSING, kind: 'missing-in-candidate' });
        continue;
      }
      diffValues(baseValue[key], candidateValue[key], childPath, out);
    }
    return;
  }
  if (Number.isNaN(baseValue) && Number.isNaN(candidateValue)) return;
  out.push({ path: rootLabel(pathValue), base: baseValue, candidate: candidateValue, kind: baseType });
}

/** Compare one replayed pair: HTTP status first, then the JSON body. */
function compareResponses(baseResponse, candidateResponse) {
  const diffs = [];
  if (baseResponse.status !== candidateResponse.status) {
    diffs.push({
      path: 'status',
      base: baseResponse.status,
      candidate: candidateResponse.status,
      kind: 'http-status',
    });
  }
  const baseJson = baseResponse.parseError ?? baseResponse.json;
  const candidateJson = candidateResponse.parseError ?? candidateResponse.json;
  const parseMismatch = baseResponse.parseError !== undefined || candidateResponse.parseError !== undefined;
  if (parseMismatch) {
    if (baseResponse.parseError !== candidateResponse.parseError) {
      diffs.push({ path: 'body', base: baseJson, candidate: candidateJson, kind: 'non-json-body' });
    }
    return diffs;
  }
  diffValues(baseResponse.json, candidateResponse.json, '', diffs);
  return diffs;
}

function truncate(value, maxLength = MAX_VALUE_CHARS) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}... (${value.length} chars)`;
}

function formatValue(value) {
  if (value === MISSING) return '<missing>';
  if (typeof value === 'string') return truncate(JSON.stringify(value));
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function printDiff(diff) {
  log(`    ${diff.path}`);
  log(`        base      : ${formatValue(diff.base)}`);
  log(`        candidate : ${formatValue(diff.candidate)}`);
}

/** Extract base/candidate tool counts per toolset for the summary table. */
function collectToolsetCounts(fixtures, responses) {
  const counts = new Map();
  for (const fixture of fixtures) {
    const match = /^mcp\/([^/]+)\/default\/tools-list\.json$/.exec(fixture.relative);
    if (!match) continue;
    const toolset = match[1];
    const response = responses.get(fixture.relative);
    if (!response) continue;
    const baseTools = response.base.json?.result?.tools;
    const candidateTools = response.candidate.json?.result?.tools;
    counts.set(toolset, {
      base: Array.isArray(baseTools) ? baseTools.length : '?',
      candidate: Array.isArray(candidateTools) ? candidateTools.length : '?',
    });
  }
  return counts;
}

async function main() {
  const startedAt = performance.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const base = normalizeBaseUrl(args.base ?? process.env.MCPP_REFERENCE_BASE ?? DEFAULT_BASE);
  const candidate = normalizeBaseUrl(args.candidate);
  const configPath = args.config ?? process.env.MCPP_REFERENCE_CONFIG ?? DEFAULT_CONFIG;
  const goldenDir = path.resolve(args.golden ?? process.env.MCPP_GOLDEN_DIR ?? DEFAULT_GOLDEN);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = args.concurrency ?? DEFAULT_CONCURRENCY;
  const token = args.token ?? process.env.MCPP_TOKEN ?? readAuthToken(configPath);

  log('mcpp parity compare');
  log(`  base        : ${base}`);
  log(`  candidate   : ${candidate}`);
  log(`  golden      : ${goldenDir}`);
  log(`  token       : <redacted, ${token.length} chars>`);
  log(`  concurrency : ${concurrency}`);
  log('');

  const fixtureFiles = await listFixtureFiles(goldenDir);
  if (fixtureFiles.length === 0) {
    usageError(`no golden fixtures under ${goldenDir}; run capture-golden.mjs first`);
  }
  const fixtures = [];
  for (const file of fixtureFiles) fixtures.push(await loadFixture(file));
  log(`loaded ${fixtures.length} golden fixtures`);

  // Fail fast on an unreachable/unauthorized origin so a connection problem is
  // never misreported as a response difference.
  const probe = async (label, origin) => {
    try {
      const response = await fetch(`${origin}/api/upstreams`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
      });
      if (response.status === 401 || response.status === 403) {
        await response.arrayBuffer();
        fail(`${label} ${origin} rejected the token (HTTP ${response.status}); check --token / config.yaml`);
      }
      await response.arrayBuffer();
      // Any other status (including 404 from a partially implemented candidate)
      // means the origin is reachable; replay reports the actual differences.
    } catch (error) {
      if (error.transport || error.usage) throw error;
      const transportError = new Error(`${label} ${origin} is unreachable: ${error.message}`);
      transportError.transport = true;
      throw transportError;
    }
  };
  await probe('base', base);
  await probe('candidate', candidate);
  log('both origins reachable');

  const responses = new Map();
  const transportFailures = [];
  let completed = 0;
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, fixtures.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= fixtures.length) return;
      const fixture = fixtures[index];
      let baseResponse;
      let candidateResponse;
      try {
        baseResponse = await replay(base, fixture, { token, timeoutMs });
        candidateResponse = await replay(candidate, fixture, { token, timeoutMs });
      } catch (error) {
        if (error.transport) {
          transportFailures.push({ fixture, message: error.message });
          return;
        }
        throw error;
      }
      responses.set(fixture.relative, { base: baseResponse, candidate: candidateResponse });
      completed += 1;
      if (args.verbose) {
        const diffs = compareResponses(baseResponse, candidateResponse);
        log(
          `[${padRight(`${completed}/${fixtures.length}`, 9)}] ` +
            `${padRight(fixture.relative, 52)} ${diffs.length === 0 ? 'match' : `DIFF (${diffs.length})`}`,
        );
      } else if (completed % 10 === 0 || completed === fixtures.length) {
        log(formatProgress(completed, fixtures.length));
      }
    }
  });
  await Promise.all(workers);

  if (transportFailures.length > 0) {
    log('');
    process.stderr.write(`FATAL: replay transport failure (${transportFailures.length} endpoint(s)):\n`);
    for (const failure of transportFailures.slice(0, 5)) {
      process.stderr.write(`  ${failure.fixture.relative}: ${failure.message}\n`);
    }
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const fixture of fixtures) {
    const response = responses.get(fixture.relative);
    if (!response) continue;
    const diffs = compareResponses(response.base, response.candidate);
    const drift = compareResponses(
      { status: fixture.status, json: fixture.json },
      response.base,
    );
    results.push({ fixture, diffs, drift });
  }

  const identical = results.filter((result) => result.diffs.length === 0);
  const different = results.filter((result) => result.diffs.length > 0);
  const drifted = results.filter((result) => result.drift.length > 0);

  log('');
  log('=== PARITY RESULT ===');
  log(`  fixtures compared : ${results.length}`);
  log(`  identical         : ${identical.length}`);
  log(`  different         : ${different.length}`);
  log(`  base drift        : ${drifted.length} (base vs recorded golden; informational)`);
  log(`  elapsed           : ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);

  const toolsetCounts = collectToolsetCounts(fixtures, responses);
  if (toolsetCounts.size > 0) {
    log('');
    log('  tool counts by toolset (base / candidate, default naming):');
    for (const [toolset, counts] of [...toolsetCounts.entries()].sort(([left], [right]) => (left < right ? -1 : 1))) {
      log(`    ${padRight(toolset, 14)} ${counts.base} / ${counts.candidate}`);
    }
  }

  if (different.length > 0) {
    log('');
    log('--- DIFFERENCES ---');
    for (const { fixture, diffs } of different) {
      log('');
      log(`${fixture.relative}  (${fixture.method} ${fixture.endpoint})`);
      log(`  differences: ${diffs.length}`);
      for (const diff of diffs.slice(0, MAX_DIFFS_SHOWN_PER_ENDPOINT)) printDiff(diff);
      if (diffs.length > MAX_DIFFS_SHOWN_PER_ENDPOINT) {
        log(`    ... ${diffs.length - MAX_DIFFS_SHOWN_PER_ENDPOINT} more difference(s) not shown`);
      }
    }
  }

  if (drifted.length > 0) {
    log('');
    log('--- BASE DRIFT vs recorded golden (informational) ---');
    log('  The reference service no longer matches the recorded fixture.');
    log('  Re-capture before treating candidate diffs as regressions.');
    for (const { fixture, drift } of drifted) {
      log('');
      log(`${fixture.relative}  (${fixture.method} ${fixture.endpoint}) drift: ${drift.length}`);
      for (const diff of drift.slice(0, MAX_DRIFT_PATHS_SHOWN)) printDiff(diff);
      if (drift.length > MAX_DRIFT_PATHS_SHOWN) {
        log(`    ... ${drift.length - MAX_DRIFT_PATHS_SHOWN} more drift difference(s) not shown`);
      }
    }
  }

  log('');
  if (different.length === 0 && transportFailures.length === 0) {
    log(`RESULT: MATCH (${identical.length}/${results.length} endpoints identical)`);
    process.exitCode = 0;
  } else {
    log(`RESULT: MISMATCH (${different.length}/${results.length} endpoints differ)`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error.usage) {
    process.stderr.write(`compare: ${error.message}\n`);
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  if (error.transport) {
    process.stderr.write(`FATAL: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`compare: ${error.message}\n`);
  if (process.env.MCPP_PARITY_DEBUG && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
