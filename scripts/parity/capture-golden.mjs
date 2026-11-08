#!/usr/bin/env node
/**
 * capture-golden.mjs — record the reference Python mcpp gateway's responses.
 *
 * The Python service is the only source of truth while the gateway is rewritten
 * as a DSH plugin, so every downstream-visible response is captured verbatim
 * (status + parsed JSON) into test/fixtures/golden/, where compare.mjs can
 * replay it against a candidate implementation.
 *
 * Captured endpoints:
 *   admin/{upstreams,toolsets,client-presets,expose,keys}.json
 *   mcp/<toolset>/<naming>/initialize.json
 *   mcp/<toolset>/<naming>/tools-list.json
 *   mcp/legacy-mcp/{initialize,tools-list}.json
 *
 * Toolsets come from GET /api/toolsets and naming modes from
 * GET /api/client-presets, so the fixture tree follows the live config instead
 * of a hard-coded list. Requests run one at a time (tools/list fans out to all
 * upstreams on the reference gateway) and failures are retried once.
 *
 * Every fixture is a normalized JSON envelope:
 *   { "endpoint": "...", "method": "GET", "request": null|{...},
 *     "status": 200, "json": <canonicalized response body> }
 *
 * The bearer token is read from the reference config.yaml at runtime and is
 * never written to a fixture, log or error message. Before writing anything,
 * every serialized fixture is scanned for the token itself and for long hex
 * runs (the shape of an embedded upstream path token); a single hit aborts the
 * capture without writing any file.
 *
 * Usage:
 *   node scripts/parity/capture-golden.mjs [--base URL] [--token TOKEN]
 *        [--config PATH] [--out DIR] [--timeout MS]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_OUT = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'golden');
const DEFAULT_BASE = 'http://127.0.0.1:9020';
/** Reference service config: only used to read auth.token. */
const DEFAULT_CONFIG = 'C:/Users/joe/Documents/repo/skill/mcpp/config.yaml';
const DEFAULT_TIMEOUT_MS = 120_000;
/** A shorter value is treated as a test token, not a real secret to redact. */
const MIN_TOKEN_LENGTH_FOR_SCAN = 8;
const LEGACY_MCP_ENDPOINT = '/mcp';

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
    token: undefined,
    config: undefined,
    out: undefined,
    timeoutMs: undefined,
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
      if (index >= argv.length) fail(`missing value for ${key}`);
      return argv[index];
    };
    switch (key) {
      case '--base':
        args.base = takeValue();
        break;
      case '--token':
        args.token = takeValue();
        break;
      case '--config':
        args.config = takeValue();
        break;
      case '--out':
        args.out = takeValue();
        break;
      case '--timeout':
        args.timeoutMs = Number(takeValue());
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  if (args.timeoutMs !== undefined && !Number.isFinite(args.timeoutMs)) {
    fail('--timeout must be a number of milliseconds');
  }
  return args;
}

function usage() {
  return `Usage: node scripts/parity/capture-golden.mjs [options]

Capture golden responses from the reference Python mcpp gateway.

Options:
  --base <url>     Reference gateway origin (default ${DEFAULT_BASE})
  --token <token>  Gateway bearer token (default: auth.token from --config)
  --config <path>  Config YAML containing auth.token
                   (default ${DEFAULT_CONFIG})
  --out <dir>      Golden output directory (default test/fixtures/golden)
  --timeout <ms>   Per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  -h, --help       Show this help
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

/**
 * Read `auth.token` from the reference config with a line state machine — no
 * YAML dependency, and nothing from the file except the token is retained.
 * `${VAR}` references are resolved the way the Python service does it.
 *
 * @param {string} configPath path to the reference config.yaml
 * @returns {string} the gateway bearer token
 */
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

/** Canonical JSON value: recursively sorted object keys, arrays keep order. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the secret scan applied to every fixture before it is written.
 *
 * Two patterns:
 *  - the gateway bearer token itself;
 *  - a run of 48+ hex characters, the shape of upstream path tokens embedded
 *    in upstream URLs (those URLs are never captured, but a description could
 *    echo one).
 *
 * @param {string} token gateway bearer token
 * @returns {(text: string) => string[]} labels of the patterns that matched
 */
function buildSecretScan(token) {
  const patterns = [];
  if (token.length >= MIN_TOKEN_LENGTH_FOR_SCAN) {
    patterns.push({ label: 'gateway bearer token', source: escapeRegExp(token), flags: 'g' });
  }
  patterns.push({ label: 'long hex run (>=48 chars)', source: '[0-9a-f]{48,}', flags: 'gi' });
  return (text) =>
    patterns
      .filter(({ source, flags }) => new RegExp(source, flags).test(text))
      .map(({ label }) => label);
}

function initializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcpp-parity-capture', version: '0.0.0' },
    },
  };
}

function toolsListRequest() {
  return { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
}

/**
 * One HTTP request against the reference gateway.
 *
 * @returns {Promise<{status: number, json: unknown, elapsedMs: number}>}
 */
async function fetchJson(base, endpoint, { method = 'GET', requestBody, token, timeoutMs }) {
  const url = `${base.replace(/\/+$/, '')}${endpoint}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (requestBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(requestBody);
  }
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    fail(`${method} ${endpoint} failed: ${error.message}`);
  }
  const text = await response.text();
  const elapsedMs = Math.round(performance.now() - startedAt);
  let json;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    fail(
      `${method} ${endpoint} returned a non-JSON body (status ` +
        `${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return { status: response.status, json, elapsedMs };
}

/** fetchJson with exactly one retry; persistent 5xx is treated as failure. */
async function fetchWithRetry(base, endpoint, options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await fetchJson(base, endpoint, options);
      if (result.status < 500) return result;
      lastError = new Error(
        `${options.method ?? 'GET'} ${endpoint} returned HTTP ${result.status}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt === 1) {
      log(`    retrying ${endpoint} once (${lastError.message})`);
      await sleep(400);
    }
  }
  throw lastError;
}

/** Build the normalized fixture text written to disk. */
function buildFixtureText({ endpoint, method, request, status, json }) {
  const envelope = {
    endpoint,
    method,
    request: request ?? null,
    status,
    json: canonicalize(json),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** One-line item count for the capture summary (endpoint specific). */
function describe(json, measure) {
  try {
    return measure(json);
  } catch {
    return '-';
  }
}

async function main() {
  const startedAt = performance.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const base = (args.base ?? process.env.MCPP_REFERENCE_BASE ?? DEFAULT_BASE).replace(
    /\/+$/,
    '',
  );
  const configPath = args.config ?? process.env.MCPP_REFERENCE_CONFIG ?? DEFAULT_CONFIG;
  const outRoot = path.resolve(args.out ?? process.env.MCPP_GOLDEN_DIR ?? DEFAULT_OUT);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = args.token ?? process.env.MCPP_TOKEN ?? readAuthToken(configPath);

  log('mcpp golden capture');
  log(`  reference : ${base}`);
  log(`  config    : ${configPath}`);
  log(`  token     : <redacted, ${token.length} chars>`);
  log(`  output    : ${outRoot}`);
  log('');

  /** @type {Array<{label: string, relPath: string, endpoint: string, method: string, request: unknown, status: number, json: unknown, text: string}>} */
  const fixtures = [];

  const capture = async (label, relPath, endpoint, options = {}) => {
    const { method = 'GET', request, body, measure } = options;
    const result = await fetchWithRetry(base, endpoint, {
      method,
      requestBody: body,
      token,
      timeoutMs,
    });
    const fixture = {
      label,
      relPath,
      endpoint,
      method,
      request: request ?? null,
      status: result.status,
      json: result.json,
      text: '',
    };
    fixtures.push(fixture);
    const info = describe(result.json, measure ?? (() => '-'));
    log(
      `  ${padRight(label, 48)} status=${result.status} ${padRight(info, 22)} ${result.elapsedMs}ms`,
    );
    if (result.status === 401 || result.status === 403) {
      fail(
        `${method} ${endpoint} rejected the gateway token (HTTP ${result.status}); ` +
          'check auth.token in the reference config or pass --token',
      );
    }
    if (result.status !== 200) {
      log(`    WARNING: expected HTTP 200, got ${result.status}`);
    }
    return result.json;
  };

  log('admin API:');
  const upstreams = await capture('GET /api/upstreams', 'admin/upstreams.json', '/api/upstreams', {
    measure: (json) => `upstreams=${Array.isArray(json) ? json.length : '?'}`,
  });
  const toolsets = await capture('GET /api/toolsets', 'admin/toolsets.json', '/api/toolsets', {
    measure: (json) => `toolsets=${Array.isArray(json) ? json.length : '?'}`,
  });
  const clientPresets = await capture(
    'GET /api/client-presets',
    'admin/client-presets.json',
    '/api/client-presets',
    {
      measure: (json) =>
        `namings=${json?.naming_modes ? Object.keys(json.naming_modes).length : '?'}`,
    },
  );
  await capture('GET /api/expose', 'admin/expose.json', '/api/expose', {
    measure: (json) => `entries=${Array.isArray(json) ? json.length : '?'}`,
  });
  await capture('GET /api/keys', 'admin/keys.json', '/api/keys', {
    measure: (json) =>
      `upstreams=${json && typeof json === 'object' ? Object.keys(json).length : '?'}`,
  });

  if (!Array.isArray(upstreams) || upstreams.some((name) => typeof name !== 'string')) {
    fail('GET /api/upstreams did not return an array of upstream names');
  }
  if (!Array.isArray(toolsets)) fail('GET /api/toolsets did not return an array');
  const toolsetNames = toolsets
    .map((entry) => (entry && typeof entry === 'object' ? entry.toolset : undefined))
    .filter((name) => typeof name === 'string' && name.length > 0);
  if (toolsetNames.length === 0) fail('GET /api/toolsets returned no toolset names');
  const namingModes = Object.keys(
    clientPresets && typeof clientPresets === 'object'
      ? (clientPresets.naming_modes ?? {})
      : {},
  );
  if (namingModes.length === 0) {
    fail('GET /api/client-presets returned no naming_modes');
  }

  log('');
  log(
    `toolsets: ${toolsetNames.join(', ')} | naming modes: ${namingModes.join(', ')}`,
  );
  log('');
  log('MCP endpoints:');
  for (const toolset of toolsetNames) {
    for (const naming of namingModes) {
      const mode = clientPresets.naming_modes[naming];
      const template =
        mode && typeof mode.endpoint_path === 'string'
          ? mode.endpoint_path
          : `/{toolset}/${naming}/mcp`;
      const endpoint = template.replace('{toolset}', toolset);
      const dir = `mcp/${toolset}/${naming}`;
      await capture(
        `POST ${endpoint} initialize`,
        `${dir}/initialize.json`,
        endpoint,
        {
          method: 'POST',
          request: initializeRequest(),
          body: initializeRequest(),
          measure: (json) => `server=${json?.result?.serverInfo?.name ?? '?'}`,
        },
      );
      await capture(
        `POST ${endpoint} tools/list`,
        `${dir}/tools-list.json`,
        endpoint,
        {
          method: 'POST',
          request: toolsListRequest(),
          body: toolsListRequest(),
          measure: (json) => `tools=${json?.result?.tools?.length ?? '?'}`,
        },
      );
    }
  }
  await capture('POST /mcp initialize', 'mcp/legacy-mcp/initialize.json', LEGACY_MCP_ENDPOINT, {
    method: 'POST',
    request: initializeRequest(),
    body: initializeRequest(),
    measure: (json) => `server=${json?.result?.serverInfo?.name ?? '?'}`,
  });
  await capture('POST /mcp tools/list', 'mcp/legacy-mcp/tools-list.json', LEGACY_MCP_ENDPOINT, {
    method: 'POST',
    request: toolsListRequest(),
    body: toolsListRequest(),
    measure: (json) => `tools=${json?.result?.tools?.length ?? '?'}`,
  });

  log('');
  log('secret scan:');
  const scan = buildSecretScan(token);
  const hits = [];
  for (const fixture of fixtures) {
    fixture.text = buildFixtureText(fixture);
    const labels = scan(fixture.text);
    if (labels.length > 0) hits.push({ relPath: fixture.relPath, labels });
  }
  if (hits.length > 0) {
    process.stderr.write(
      'SECRET SCAN FAILED — refusing to write any fixture. Matched:\n',
    );
    for (const hit of hits) {
      process.stderr.write(`  ${hit.relPath}: ${hit.labels.join(', ')}\n`);
    }
    process.stderr.write(
      'A response contains the gateway token or a 48+ hex run that looks like an ' +
        'embedded path token. Do not force the write; narrow the response first.\n',
    );
    process.exitCode = 1;
    return;
  }
  log(`  clean (${fixtures.length} fixtures scanned)`);

  let totalBytes = 0;
  for (const fixture of fixtures) {
    const filePath = path.join(outRoot, fixture.relPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fixture.text, 'utf8');
    totalBytes += Buffer.byteLength(fixture.text);
  }

  const adminCount = fixtures.filter((fixture) => fixture.relPath.startsWith('admin/')).length;
  const statusOk = fixtures.filter((fixture) => fixture.status === 200).length;
  log('');
  log('=== CAPTURE SUMMARY ===');
  log(`  reference : ${base}`);
  log(`  fixtures  : ${fixtures.length} (admin ${adminCount}, mcp ${fixtures.length - adminCount})`);
  log(`  http 200  : ${statusOk}/${fixtures.length}`);
  log(`  written   : ${path.join(outRoot)}`);
  log(`  bytes     : ${totalBytes}`);
  log(`  elapsed   : ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  log('');
  log('  tools per toolset (default naming):');
  for (const toolset of toolsetNames) {
    const relPath = `mcp/${toolset}/default/tools-list.json`;
    const fixture = fixtures.find((entry) => entry.relPath === relPath);
    const count = fixture?.json?.result?.tools?.length;
    log(`    ${padRight(toolset, 14)} ${count ?? '?'}`);
  }
  log('');
  log(`  next: node scripts/parity/compare.mjs --candidate <new gateway url>`);

  if (statusOk !== fixtures.length) {
    log('');
    log('WARNING: some endpoints did not return HTTP 200 — the golden may be incomplete.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`capture-golden: ${error.message}\n`);
  if (process.env.MCPP_PARITY_DEBUG && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
