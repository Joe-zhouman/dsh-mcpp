import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.ts'
import { ParamError } from '../src/errors.ts'
import {
  buildDownstreamSchema,
  displayName,
  paramTransformValue,
  transformTools,
} from '../src/transform.ts'

const SAMPLE_RAW = `upstreams:
  - name: gh
    url: https://api.github.com/mcp
expose:
  gh/search:
    upstream: gh
    tool: search
    as: gh_search
    description: "Search GitHub. Use \`gh/code\` for deep code search."
    params:
      - name: query
      - name: sort_order
        map_from: sort
      - name: per_page
        hidden: true
        default: 20
      - name: format
        default: json
  gh/code:
    upstream: gh
    tool: code_search
    description: "Deep code search. Call \`gh/search\` first."
`

/**
 * Build a minimal gateway configuration around one expose table.
 * @param {object} expose - expose table.
 * @param {string} [serverName] - aggregated server name.
 * @returns {object} the configuration.
 */
function configWith(expose, serverName = 'mcpp') {
  return { upstreams: [], expose, serverName }
}

/**
 * The upstream tools used by the ported Python transform tests.
 * @returns {object[]} raw tools.
 */
function sampleTools() {
  return [
    {
      name: 'search',
      description: 'Search repos',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          sort: { type: 'string', description: 'Sort order' },
          per_page: { type: 'integer', description: 'Results per page' },
          format: { type: 'string', description: 'Output format' },
        },
        required: ['query'],
      },
    },
    { name: 'code_search', description: 'Deep code search' },
    { name: 'unused_tool', description: 'Not exposed' },
  ]
}

/**
 * Find one transformed tool by name.
 * @param {object[]} tools - transformed tools.
 * @param {string} name - downstream name.
 * @returns {object} the tool.
 */
function byName(tools, name) {
  const found = tools.find((tool) => tool.name === name)
  assert.ok(found, `tool ${name} not found in ${tools.map((tool) => tool.name).join(', ')}`)
  return found
}

test('displayName prefers `as` and falls back to the key last segment', () => {
  assert.equal(displayName({ upstream: 'u', tool: 't', as: 'renamed', hide: false }, 'gh/t'), 'renamed')
  assert.equal(displayName({ upstream: 'u', tool: 't', hide: false }, 'gh/t'), 't')
  assert.equal(displayName({ upstream: 'u', tool: 't', hide: false }, 'a/b/c'), 'c')
  assert.equal(displayName({ upstream: 'u', tool: 't', hide: false }, 'plain'), 'plain')
})

test('transformTools drops unexposed and hidden tools and applies display names', () => {
  const config = parseConfig(SAMPLE_RAW)
  const names = transformTools('gh', sampleTools(), config).map((tool) => tool.name)
  assert.deepEqual(names, ['gh_search', 'code'])
  assert.equal(names.includes('search'), false)
  assert.equal(names.includes('unused_tool'), false)
})

test('transformTools keeps upstream order', () => {
  const config = configWith({
    'u/a': { upstream: 'u', tool: 'a', hide: false },
    'u/b': { upstream: 'u', tool: 'b', hide: false },
  })
  const tools = transformTools(
    'u',
    [
      { name: 'b', description: 'B' },
      { name: 'a', description: 'A' },
      { name: 'missing', description: 'M' },
    ],
    config,
  )
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['b', 'a'],
  )
})

test('transformTools drops tools whose expose entry is hidden', () => {
  const config = configWith({ 'u/a': { upstream: 'u', tool: 'a', hide: true } })
  assert.deepEqual(transformTools('u', [{ name: 'a', description: 'A' }], config), [])
})

test('transformTools resolves backtick references to display names', () => {
  const config = parseConfig(SAMPLE_RAW)
  const tools = transformTools('gh', sampleTools(), config)
  assert.equal(
    byName(tools, 'gh_search').description,
    'Search GitHub. Use `code` for deep code search.',
  )
  assert.equal(
    byName(tools, 'code').description,
    'Deep code search. Call `gh_search` first.',
  )
})

test('transformTools expands backtick references through the client format', () => {
  const config = parseConfig(SAMPLE_RAW)
  const tools = transformTools('gh', sampleTools(), config, 'claude')
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['mcp__mcpp__gh_search', 'mcp__mcpp__code'],
  )
  assert.ok(byName(tools, 'mcp__mcpp__gh_search').description.includes('`mcp__mcpp__code`'))
})

test('transformTools leaves unknown backtick references verbatim', () => {
  const config = configWith({ 'u/a': { upstream: 'u', tool: 'a', hide: false } })
  const tools = transformTools(
    'u',
    [{ name: 'a', description: 'Use `u/nope`, `u/a`, and `action`.' }],
    config,
  )
  assert.equal(byName(tools, 'a').description, 'Use `u/nope`, `a`, and `action`.')
})

test('transformTools falls back to the upstream description', () => {
  const config = configWith({ 'u/a': { upstream: 'u', tool: 'a', hide: false } })
  const tools = transformTools('u', [{ name: 'a', description: 'upstream text' }], config)
  assert.equal(byName(tools, 'a').description, 'upstream text')
  const empty = transformTools('u', [{ name: 'a' }], config)
  assert.equal(byName(empty, 'a').description, '')
})

test('transformTools emits only name, description, and inputSchema', () => {
  const config = configWith({ 'u/a': { upstream: 'u', tool: 'a', hide: false } })
  const tools = transformTools(
    'u',
    [
      {
        name: 'a',
        description: 'A',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        annotations: { title: 'ignored' },
        title: 'ignored',
      },
    ],
    config,
  )
  assert.deepEqual(Object.keys(tools[0]), ['name', 'description', 'inputSchema'])
})

test('transformTools filters by toolset and falls back to the server name', () => {
  const config = parseConfig(`upstreams:
  - name: u
    url: https://x/mcp
expose:
  u/a:
    upstream: u
    tool: a
    toolset: search
  u/b:
    upstream: u
    tool: b
  u/c:
    upstream: u
    tool: c
    as: renamed_c
server_name: mcpp
`)
  const tools = [
    { name: 'a', description: 'A' },
    { name: 'b', description: 'B' },
    { name: 'c', description: 'C' },
  ]
  assert.deepEqual(
    transformTools('u', tools, config, 'default', 'search').map((tool) => tool.name),
    ['a'],
  )
  assert.deepEqual(
    transformTools('u', tools, config, 'default', 'mcpp').map((tool) => tool.name),
    ['b', 'renamed_c'],
  )
  assert.deepEqual(
    transformTools('u', tools, config).map((tool) => tool.name),
    ['a', 'b', 'renamed_c'],
  )
})

test('transformTools uses the last expose entry when two map the same upstream tool', () => {
  const config = configWith({
    'u/old': { upstream: 'u', tool: 't', as: 'old_name', hide: false },
    'u/new': { upstream: 'u', tool: 't', as: 'new_name', hide: false },
  })
  const tools = transformTools('u', [{ name: 't', description: 'T' }], config)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['new_name'],
  )
})

test('transformTools falls back to the default format for an unknown client', () => {
  const config = parseConfig(SAMPLE_RAW)
  const tools = transformTools('gh', sampleTools(), config, 'not-a-client')
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['gh_search', 'code'],
  )
})

test('buildDownstreamSchema passes the upstream schema through without params', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' } } }
  const entry = { upstream: 'u', tool: 't', hide: false }
  assert.equal(buildDownstreamSchema(entry, schema), schema)
  assert.equal(buildDownstreamSchema(entry, undefined), undefined)
})

test('buildDownstreamSchema builds an empty object schema for an empty params list', () => {
  const entry = { upstream: 'u', tool: 't', hide: false, params: [] }
  assert.deepEqual(buildDownstreamSchema(entry, { type: 'object', properties: {} }), {
    type: 'object',
    properties: {},
  })
})

test('buildDownstreamSchema skips hidden params', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'visible', hidden: false },
      { name: 'secret', hidden: true, default: 'x' },
    ],
  }
  const schema = buildDownstreamSchema(entry, {
    type: 'object',
    properties: { visible: { type: 'string' }, secret: { type: 'string' } },
    required: ['visible', 'secret'],
  })
  assert.deepEqual(Object.keys(schema.properties), ['visible'])
  assert.deepEqual(schema.required, ['visible'])
})

test('buildDownstreamSchema inherits requiredness from the upstream schema', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [{ name: 'req_p', hidden: false }, { name: 'opt_p', hidden: false }],
  }
  const schema = buildDownstreamSchema(entry, {
    type: 'object',
    properties: { req_p: { type: 'string' }, opt_p: { type: 'string' } },
    required: ['req_p'],
  })
  assert.deepEqual(schema.required, ['req_p'])
})

test('buildDownstreamSchema lets an explicit required override both directions', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'a', hidden: false, required: false },
      { name: 'b', hidden: false, required: true },
    ],
  }
  const schema = buildDownstreamSchema(entry, {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['a'],
  })
  assert.deepEqual(schema.required, ['b'])
})

test('buildDownstreamSchema omits required when nothing is required', () => {
  const entry = { upstream: 'u', tool: 't', hide: false, params: [{ name: 'q', hidden: false }] }
  const schema = buildDownstreamSchema(entry, { type: 'object', properties: {} })
  assert.equal('required' in schema, false)
})

test('buildDownstreamSchema preserves upstream property constraints', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [{ name: 'action', mapFrom: 'action', hidden: false }],
  }
  const schema = buildDownstreamSchema(entry, {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['a', 'b'],
        format: 'path',
        items: { type: 'string' },
        minimum: 0,
      },
    },
    required: ['action'],
  })
  assert.deepEqual(schema.properties.action, {
    type: 'string',
    enum: ['a', 'b'],
    format: 'path',
    items: { type: 'string' },
    minimum: 0,
  })
  assert.notEqual(schema.properties.action, undefined)
})

test('buildDownstreamSchema copies the upstream property instead of sharing it', () => {
  const upstreamProperty = { type: 'string', description: 'upstream' }
  const entry = { upstream: 'u', tool: 't', hide: false, params: [{ name: 'q', hidden: false }] }
  const schema = buildDownstreamSchema(entry, { type: 'object', properties: { q: upstreamProperty } })
  assert.deepEqual(schema.properties.q, upstreamProperty)
  assert.notEqual(schema.properties.q, upstreamProperty)
})

test('buildDownstreamSchema overrides type and enum for enum and preset params', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'size', mapFrom: 'size', hidden: false, type: 'enum', mapping: { big: 'B', small: 'S' } },
      { name: 'mode', hidden: false, type: 'preset', preset: { fast: { model: 'haiku' } } },
    ],
  }
  const schema = buildDownstreamSchema(entry, {
    type: 'object',
    properties: {
      size: { type: 'string', enum: ['upstream-a'] },
      mode: { type: 'string' },
    },
    required: ['size'],
  })
  assert.deepEqual(schema.properties.size, { type: 'string', enum: ['big', 'small'] })
  assert.deepEqual(schema.properties.mode, { type: 'string', enum: ['fast'] })
})

test('buildDownstreamSchema falls back to a bare string property for unknown upstream params', () => {
  const entry = { upstream: 'u', tool: 't', hide: false, params: [{ name: 'q', hidden: false }] }
  const schema = buildDownstreamSchema(entry, { type: 'object', properties: {} })
  assert.deepEqual(schema.properties.q, { type: 'string' })
})

test('buildDownstreamSchema overrides or inherits the property description', () => {
  const upstreamSchema = {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'upstream q desc' },
      n: { type: 'integer', description: 'upstream n desc' },
    },
    required: ['q'],
  }
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'q', hidden: false, description: 'custom q for downstream' },
      { name: 'n', hidden: false },
    ],
  }
  const schema = buildDownstreamSchema(entry, upstreamSchema)
  assert.equal(schema.properties.q.description, 'custom q for downstream')
  assert.equal(schema.properties.n.description, 'upstream n desc')
})

test('buildDownstreamSchema works without an upstream schema', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'a', hidden: false },
      { name: 'b', hidden: false, required: true },
    ],
  }
  assert.deepEqual(buildDownstreamSchema(entry, undefined), {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['b'],
  })
})

test('paramTransformValue passes arguments through without params', () => {
  const rawArgs = { a: 1 }
  const entry = { upstream: 'u', tool: 't', hide: false }
  assert.equal(paramTransformValue(rawArgs, entry), rawArgs)
})

test('paramTransformValue maps names and injects hidden defaults', () => {
  const config = parseConfig(SAMPLE_RAW)
  const result = paramTransformValue({ query: 'test', sort_order: 'stars' }, config.expose['gh/search'])
  assert.deepEqual(result, { query: 'test', sort: 'stars', per_page: 20 })
})

test('paramTransformValue skips omitted and null arguments', () => {
  const config = parseConfig(SAMPLE_RAW)
  const entry = config.expose['gh/search']
  assert.deepEqual(paramTransformValue({ query: 'test' }, entry), { query: 'test', per_page: 20 })
  assert.deepEqual(paramTransformValue({ query: 'test', format: null }, entry), {
    query: 'test',
    per_page: 20,
  })
})

test('paramTransformValue does not send a hidden param without a default', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'q', hidden: false },
      { name: 'secret', mapFrom: 's', hidden: true },
      { name: 'nulled', mapFrom: 'n', hidden: true, default: null },
    ],
  }
  assert.deepEqual(paramTransformValue({ q: 'hi' }, entry), { q: 'hi' })
})

test('paramTransformValue keeps a visible optional default out of the call', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'q', hidden: false },
      { name: 'opt', hidden: false, required: false, default: 'filler' },
    ],
  }
  assert.deepEqual(paramTransformValue({ q: 'hi' }, entry), { q: 'hi' })
})

test('paramTransformValue maps enum values', () => {
  const config = parseConfig(`upstreams:
  - name: ai
    url: https://ai.example.com/mcp
expose:
  ai/chat:
    upstream: ai
    tool: chat
    params:
      - name: message
      - name: style
        map_from: temperature
        type: enum
        mapping:
          precise: 0.1
          balanced: 1.0
`)
  const result = paramTransformValue(
    { message: 'hi', style: 'precise' },
    config.expose['ai/chat'],
  )
  assert.deepEqual(result, { message: 'hi', temperature: 0.1 })
})

test('paramTransformValue merges preset values shallowly', () => {
  const config = parseConfig(`upstreams:
  - name: ai
    url: https://ai.example.com/mcp
expose:
  ai/chat:
    upstream: ai
    tool: chat
    params:
      - name: message
      - name: max_tokens
      - name: mode
        type: preset
        preset:
          fast: {"model": "haiku", "max_tokens": 4096}
          deep: {"model": "opus", "max_tokens": 256000}
`)
  const result = paramTransformValue(
    { message: 'hi', max_tokens: 1, mode: 'deep' },
    config.expose['ai/chat'],
  )
  assert.deepEqual(result, { message: 'hi', max_tokens: 256000, model: 'opus' })
})

test('paramTransformValue rejects an enum value outside the whitelist', () => {
  const config = parseConfig(`upstreams:
  - name: ai
    url: https://ai.example.com/mcp
expose:
  ai/chat:
    upstream: ai
    tool: chat
    params:
      - name: style
        type: enum
        mapping:
          precise: 0.1
          balanced: 1.0
`)
  assert.throws(
    () => paramTransformValue({ style: 'nope' }, config.expose['ai/chat']),
    (error) =>
      error instanceof ParamError &&
      error.message.includes("'nope'") &&
      error.message.includes('precise') &&
      error.message.includes('balanced'),
  )
})

test('paramTransformValue rejects a preset value outside the whitelist', () => {
  const config = parseConfig(`upstreams:
  - name: ai
    url: https://ai.example.com/mcp
expose:
  ai/chat:
    upstream: ai
    tool: chat
    params:
      - name: mode
        type: preset
        preset:
          fast: {"model": "haiku"}
`)
  assert.throws(
    () => paramTransformValue({ mode: 'nope' }, config.expose['ai/chat']),
    (error) => error instanceof ParamError && error.message.includes('fast'),
  )
})

test('paramTransformValue treats an enum/preset without a table as a passthrough', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'a', hidden: false, type: 'enum' },
      { name: 'b', hidden: false, type: 'preset' },
    ],
  }
  assert.deepEqual(paramTransformValue({ a: 'x', b: 'y' }, entry), { a: 'x', b: 'y' })
})

test('paramTransformValue keeps the configured param order', () => {
  const entry = {
    upstream: 'u',
    tool: 't',
    hide: false,
    params: [
      { name: 'z', hidden: false },
      { name: 'a', hidden: false },
      { name: 'hidden', mapFrom: 'm', hidden: true, default: 1 },
    ],
  }
  assert.deepEqual(Object.keys(paramTransformValue({ z: 1, a: 2 }, entry)), ['z', 'a', 'm'])
})

test('paramTransformValue does not mutate the client arguments', () => {
  const config = parseConfig(SAMPLE_RAW)
  const rawArgs = { query: 'test' }
  paramTransformValue(rawArgs, config.expose['gh/search'])
  assert.deepEqual(rawArgs, { query: 'test' })
})
