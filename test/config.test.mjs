import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dumpConfig, loadConfigFile, parseConfig, resolveEnvValue } from '../src/config.ts'
import { ConfigError } from '../src/errors.ts'

const MINIMAL = `upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose: {}
`

/**
 * Build a YAML document with one upstream and one expose entry.
 * @param {string} [exposeBody] - YAML body appended under `gh/search`.
 * @returns {string} the document text.
 */
function oneTool(exposeBody) {
  return `upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose:
  gh/search:
    upstream: gh
    tool: search
${exposeBody ?? ''}`
}

test('parseConfig applies the model defaults', () => {
  const config = parseConfig(MINIMAL)
  assert.equal(config.upstreams.length, 1)
  const upstream = config.upstreams[0]
  assert.equal(upstream.name, 'gh')
  assert.equal(upstream.url, 'https://api.github.com/mcp')
  assert.equal(upstream.transport, 'http')
  assert.deepEqual(upstream.inheritEnv, ['PATH'])
  assert.equal(upstream.connectTimeout, 30)
  assert.equal(upstream.readTimeout, 120)
  assert.equal(upstream.listTimeout, 20)
  assert.equal(upstream.auth, undefined)
  assert.deepEqual(config.expose, {})
  assert.equal(config.serverName, 'mcpp')
  assert.equal(config.auth, undefined)
  assert.equal(config.clients, undefined)
})

test('parseConfig fills defaults for expose entries and parameter transforms', () => {
  const config = parseConfig(
    oneTool(`    params:
      - name: query
`),
  )
  const entry = config.expose['gh/search']
  assert.equal(entry.upstream, 'gh')
  assert.equal(entry.tool, 'search')
  assert.equal(entry.as, undefined)
  assert.equal(entry.toolset, undefined)
  assert.equal(entry.hide, false)
  assert.equal(entry.description, undefined)
  const param = entry.params[0]
  assert.equal(param.name, 'query')
  assert.equal(param.mapFrom, undefined)
  assert.equal(param.type, undefined)
  assert.equal(param.mapping, undefined)
  assert.equal(param.preset, undefined)
  assert.equal(param.hidden, false)
  assert.equal(param.default, undefined)
  assert.equal(param.description, undefined)
  assert.equal(param.required, undefined)
})

test('parseConfig reads an auth block', () => {
  const config = parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
    auth:
      keys:
        - \${GH_KEY_1}
        - \${GH_KEY_2}
      header: Authorization
      scheme: "Bearer "
expose: {}
`)
  assert.deepEqual(config.upstreams[0].auth, {
    keys: ['${GH_KEY_1}', '${GH_KEY_2}'],
    header: 'Authorization',
    scheme: 'Bearer ',
  })
})

test('parseConfig keeps a custom header with an empty scheme', () => {
  const config = parseConfig(`upstreams:
  - name: context7
    url: https://mcp.context7.com/mcp
    auth:
      keys: ["\${CONTEXT7_API_KEY}"]
      header: CONTEXT7_API_KEY
      scheme: ""
expose: {}
`)
  assert.equal(config.upstreams[0].auth.header, 'CONTEXT7_API_KEY')
  assert.equal(config.upstreams[0].auth.scheme, '')
})

test('parseConfig requires auth header and scheme', () => {
  assert.throws(() => {
    parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
    auth:
      keys: ["k"]
expose: {}
`)
  }, ConfigError)
  assert.throws(() => {
    parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
    auth:
      keys: ["k"]
      header: Authorization
expose: {}
`)
  }, ConfigError)
})

test('parseConfig ignores unknown fields at every level', () => {
  const config = parseConfig(`unknown_top: 1
upstreams:
  - name: gh
    url: https://api.github.com/mcp
    unknown_upstream: true
    auth:
      keys: ["k"]
      header: h
      scheme: s
      unknown_auth: 1
expose:
  gh/search:
    upstream: gh
    tool: search
    unknown_entry: x
    params:
      - name: query
        unknown_param: y
server_name: mcpp
unknown_again: 2
`)
  assert.equal(config.upstreams[0].name, 'gh')
  assert.equal('unknownUpstream' in config.upstreams[0], false)
  assert.equal('unknown_auth' in config.upstreams[0].auth, false)
  const entry = config.expose['gh/search']
  assert.equal('unknown_entry' in entry, false)
  assert.equal('unknown_param' in entry.params[0], false)
  assert.equal('unknown_top' in config, false)
})

test('parseConfig rejects a document without upstreams or expose', () => {
  assert.throws(() => parseConfig('expose: {}\n'), ConfigError)
  assert.throws(() => parseConfig('upstreams: []\n'), ConfigError)
  assert.throws(() => parseConfig('upstreams: null\nexpose: {}\n'), ConfigError)
  assert.throws(() => parseConfig('upstreams: []\nexpose: null\n'), ConfigError)
})

test('parseConfig rejects missing required fields', () => {
  assert.throws(() => parseConfig('upstreams:\n  - url: u\nexpose: {}\n'), ConfigError)
  assert.throws(
    () => parseConfig('upstreams:\n  - name: a\n    url: u\nexpose:\n  a/t:\n    tool: t\n'),
    ConfigError,
  )
  assert.throws(
    () => parseConfig('upstreams:\n  - name: a\n    url: u\nexpose:\n  a/t:\n    upstream: a\n'),
    ConfigError,
  )
  assert.throws(
    () =>
      parseConfig(
        'upstreams:\n  - name: a\n    url: u\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params:\n      - map_from: x\n',
      ),
    ConfigError,
  )
})

test('parseConfig rejects values of the wrong type', () => {
  const cases = [
    // upstreams
    'upstreams: {}\nexpose: {}\n',
    'upstreams:\n  - name: 1\nexpose: {}\n',
    'upstreams:\n  - name: a\n    url: 1\nexpose: {}\n',
    'upstreams:\n  - name: a\n    transport: 1\nexpose: {}\n',
    'upstreams:\n  - name: a\n    transport: sse\nexpose: {}\n',
    'upstreams:\n  - name: a\n    args: [1]\nexpose: {}\n',
    'upstreams:\n  - name: a\n    env: {A: 1}\nexpose: {}\n',
    'upstreams:\n  - name: a\n    inherit_env: PATH\nexpose: {}\n',
    'upstreams:\n  - name: a\n    inherit_env: null\nexpose: {}\n',
    'upstreams:\n  - name: a\n    connect_timeout: "30"\nexpose: {}\n',
    'upstreams:\n  - name: a\n    connect_timeout: 30.5\nexpose: {}\n',
    // expose
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    as: 1\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    hide: "yes"\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    description: 1\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params: {}\n',
    // params
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params:\n      - name: p\n        type: foo\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params:\n      - name: p\n        mapping: []\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params:\n      - name: p\n        preset:\n          a: 1\n',
    'upstreams: []\nexpose:\n  a/t:\n    upstream: a\n    tool: t\n    params:\n      - name: p\n        hidden: 1\n',
    // top level
    'upstreams: []\nexpose: {}\nserver_name: null\n',
    'upstreams: []\nexpose: {}\nauth: 1\n',
    'upstreams: []\nexpose: {}\nauth:\n  token: 1\n',
    'upstreams: []\nexpose: {}\nclients:\n  claude: 1\n',
  ]
  for (const text of cases) assert.throws(() => parseConfig(text), ConfigError, text)
})

test('parseConfig treats explicit null as absent for optional fields', () => {
  const config = parseConfig(`upstreams:
  - name: gh
    url: null
    command: null
    args: null
    env: null
    auth: null
expose:
  gh/search:
    upstream: gh
    tool: search
    as: null
    toolset: null
    description: null
    params: null
server_name: mcpp
auth: null
clients: null
`)
  const upstream = config.upstreams[0]
  assert.equal(upstream.url, undefined)
  assert.equal(upstream.command, undefined)
  assert.equal(upstream.args, undefined)
  assert.equal(upstream.env, undefined)
  assert.equal(upstream.auth, undefined)
  const entry = config.expose['gh/search']
  assert.equal(entry.as, undefined)
  assert.equal(entry.toolset, undefined)
  assert.equal(entry.description, undefined)
  assert.equal(entry.params, undefined)
  assert.equal(config.auth, undefined)
  assert.equal(config.clients, undefined)
})

test('parseConfig keeps null parameter transforms distinct where the model does', () => {
  const config = parseConfig(
    oneTool(`    params:
      - name: p
        map_from: null
        type: null
        mapping: null
        preset: null
        default: null
        description: null
        required: null
`),
  )
  const param = config.expose['gh/search'].params[0]
  assert.equal(param.mapFrom, undefined)
  assert.equal(param.type, undefined)
  assert.equal(param.mapping, undefined)
  assert.equal(param.preset, undefined)
  assert.equal(param.default, null)
  assert.equal(param.description, undefined)
  assert.equal(param.required, undefined)
})

test('parseConfig keeps an empty params list distinct from an absent one', () => {
  const withEmpty = parseConfig(oneTool('    params: []\n'))
  assert.deepEqual(withEmpty.expose['gh/search'].params, [])
  const withNull = parseConfig(oneTool('    params: null\n'))
  assert.equal(withNull.expose['gh/search'].params, undefined)
})

test('parseConfig rejects malformed YAML', () => {
  assert.throws(() => parseConfig('upstreams: [\n'), ConfigError)
  assert.throws(() => parseConfig(''), ConfigError)
  assert.throws(() => parseConfig('- a\n- b\n'), ConfigError)
  assert.throws(() => parseConfig('upstreams:\n  - name: a\n   bad: indent\nexpose: {}\n'), ConfigError)
})

test('validateRefs accepts a description with a valid slash-bearing reference', () => {
  const config = parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose:
  gh/search:
    upstream: gh
    tool: search
    description: "Use \`gh/code\` for code search."
  gh/code:
    upstream: gh
    tool: code_search
`)
  assert.equal(Object.keys(config.expose).length, 2)
})

test('validateRefs rejects a reference to a hidden tool', () => {
  assert.throws(
    () =>
      parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose:
  gh/search:
    upstream: gh
    tool: search
    description: "Use \`gh/code\` for code search."
  gh/code:
    upstream: gh
    tool: code_search
    hide: true
`),
    (error) => error instanceof ConfigError && /gh\/code/.test(error.message),
  )
})

test('validateRefs rejects a reference to a missing tool', () => {
  assert.throws(
    () =>
      parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose:
  gh/search:
    upstream: gh
    tool: search
    description: "Use \`gh/nonexistent\` for code search."
`),
    (error) => error instanceof ConfigError && /gh\/nonexistent/.test(error.message),
  )
})

test('validateRefs ignores backtick literals without a slash', () => {
  const config = parseConfig(
    oneTool(`    description: "Analyze an image. Pass \`action\` to pick the type, or \`Bearer \` for auth."
`),
  )
  assert.ok('gh/search' in config.expose)
})

test('validateRefs ignores references to tools of another upstream that exist', () => {
  const config = parseConfig(`upstreams:
  - name: a
    url: u
  - name: b
    url: v
expose:
  a/t:
    upstream: a
    tool: t
    description: "Calls \`b/u\`."
  b/u:
    upstream: b
    tool: u
`)
  assert.equal(Object.keys(config.expose).length, 2)
})

test('validateToolsets rejects the reserved fetch toolset', () => {
  assert.throws(
    () =>
      parseConfig(`upstreams: []
expose:
  gh/search:
    upstream: gh
    tool: search
    toolset: fetch
`),
    (error) => error instanceof ConfigError && /reserved/.test(error.message),
  )
})

test('validateToolsets applies the reserved check to the default server name', () => {
  assert.throws(
    () =>
      parseConfig(`upstreams: []
expose:
  gh/search:
    upstream: gh
    tool: search
server_name: fetch
`),
    ConfigError,
  )
})

test('validateToolsets allows a distinct toolset name', () => {
  const config = parseConfig(`upstreams: []
expose:
  gh/search:
    upstream: gh
    tool: search
    toolset: get
server_name: fetch
`)
  assert.equal(config.expose['gh/search'].toolset, 'get')
})

test('resolveEnvValue resolves ${VAR} references only', () => {
  const env = { TOKEN: 'abc', EMPTY: '', NUM_1: 'n' }
  assert.equal(resolveEnvValue('${TOKEN}', env), 'abc')
  assert.equal(resolveEnvValue('Bearer ${TOKEN}', env), 'Bearer abc')
  assert.equal(resolveEnvValue('${TOKEN}/${NUM_1}', env), 'abc/n')
  assert.equal(resolveEnvValue('${MISSING}', env), '')
  assert.equal(resolveEnvValue('pre${MISSING}post', env), 'prepost')
  assert.equal(resolveEnvValue('${EMPTY}', env), '')
  assert.equal(resolveEnvValue('$TOKEN', env), '$TOKEN')
  assert.equal(resolveEnvValue('${1INVALID}', env), '${1INVALID}')
  assert.equal(resolveEnvValue('${} ', env), '${} ')
  assert.equal(resolveEnvValue('', env), '')
  assert.equal(resolveEnvValue('plain', env), 'plain')
})

test('resolveEnvValue defaults to process.env', () => {
  assert.equal(resolveEnvValue('${PATH}'), process.env.PATH)
})

test('loadConfigFile reads and parses a file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-config-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'config.yaml')
  writeFileSync(path, MINIMAL, 'utf8')
  const config = loadConfigFile(path)
  assert.equal(config.upstreams[0].name, 'gh')
})

test('loadConfigFile wraps read failures with the path', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-config-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const missing = join(dir, 'missing.yaml')
  assert.throws(
    () => loadConfigFile(missing),
    (error) => error instanceof ConfigError && error.message.includes(missing),
  )
})

test('loadConfigFile rejects a file that does not validate', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-config-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'config.yaml')
  writeFileSync(path, 'upstreams: nope\nexpose: {}\n', 'utf8')
  assert.throws(() => loadConfigFile(path), ConfigError)
})

test('dumpConfig writes the model field order and aliases', () => {
  const config = parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
    auth:
      keys: ["\${GH_KEY}"]
      header: Authorization
      scheme: "Bearer "
expose:
  gh/search:
    upstream: gh
    tool: search
    as: gh_search
    description: "See \`gh/code\`."
    params:
      - name: query
      - name: per_page
        hidden: true
        default: 20
  gh/code:
    upstream: gh
    tool: code_search
server_name: mcpp
`)
  assert.equal(
    dumpConfig(config),
    `upstreams:
  - name: gh
    transport: http
    url: https://api.github.com/mcp
    inherit_env:
      - PATH
    auth:
      keys:
        - \${GH_KEY}
      header: Authorization
      scheme: 'Bearer '
    connect_timeout: 30
    read_timeout: 120
    list_timeout: 20
expose:
  gh/search:
    upstream: gh
    tool: search
    as: gh_search
    hide: false
    description: See \`gh/code\`.
    params:
      - name: query
        hidden: false
      - name: per_page
        hidden: true
        default: 20
  gh/code:
    upstream: gh
    tool: code_search
    hide: false
server_name: mcpp
`,
  )
})

test('dumpConfig emits every serialize-only field in model order', () => {
  const config = parseConfig(`upstreams:
  - name: local
    transport: stdio
    command: node
    args: []
    env: {}
    inherit_env: [PATH]
    connect_timeout: 1
    read_timeout: 2
    list_timeout: 3
expose:
  gh/search:
    upstream: local
    tool: search
    toolset: search
    description: ""
    params:
      - name: p
        map_from: up
        type: enum
        mapping:
          big: B
        preset: {}
        hidden: false
        default: '10'
        description: a param
        required: false
server_name: mcpp
auth: {}
clients: {}
`)
  assert.equal(
    dumpConfig(config),
    `upstreams:
  - name: local
    transport: stdio
    command: node
    args: []
    env: {}
    inherit_env:
      - PATH
    connect_timeout: 1
    read_timeout: 2
    list_timeout: 3
expose:
  gh/search:
    upstream: local
    tool: search
    toolset: search
    hide: false
    description: ''
    params:
      - name: p
        map_from: up
        type: enum
        mapping:
          big: B
        preset: {}
        hidden: false
        default: '10'
        description: a param
        required: false
server_name: mcpp
auth: {}
clients: {}
`,
  )
})

test('dumpConfig drops undefined and null fields', () => {
  const config = parseConfig(oneTool('    as: null\n    params: null\n'))
  const dumped = dumpConfig(config)
  assert.equal(dumped.includes('as:'), false)
  assert.equal(dumped.includes('params:'), false)
  assert.equal(dumped.includes('url: null'), false)
  assert.equal(dumped.includes('auth:'), false)
  assert.equal(dumped.includes('clients:'), false)
})

test('dumpConfig drops a null parameter default', () => {
  const config = parseConfig(
    oneTool(`    params:
      - name: p
        default: null
`),
  )
  assert.equal(dumpConfig(config).includes('default:'), false)
})

test('dumpConfig does not wrap long descriptions and keeps unicode verbatim', () => {
  const long = '中'.repeat(160)
  const config = parseConfig(
    oneTool(`    description: "${long}"
`),
  )
  const dumped = dumpConfig(config)
  assert.ok(dumped.includes(`description: ${long}`))
  assert.equal(dumped.includes('\\u4e2d'), false)
})

test('dumpConfig round-trips through parseConfig', () => {
  const config = parseConfig(`upstreams:
  - name: gh
    url: https://api.github.com/mcp
    auth:
      keys: ["\${GH_KEY}"]
      header: Authorization
      scheme: "Bearer "
  - name: local
    transport: stdio
    command: node
    args: ["a", "b"]
    env:
      FOO: bar
    inherit_env: [PATH, HOME]
expose:
  gh/search:
    upstream: gh
    tool: search
    as: gh_search
    toolset: search
    description: "Use \`gh/code\`. 中文"
    params:
      - name: query
      - name: size
        map_from: sz
        type: enum
        mapping:
          big: B
      - name: mode
        type: preset
        preset:
          fast:
            model: haiku
      - name: hidden_one
        hidden: true
        default: '10'
  gh/code:
    upstream: gh
    tool: code_search
server_name: mcpp
auth:
  token: \${MCPP_TOKEN}
clients:
  claude: false
`)
  const dumped = dumpConfig(config)
  const reparsed = parseConfig(dumped)
  assert.deepEqual(reparsed, config)
  assert.equal(dumpConfig(reparsed), dumped)
})
