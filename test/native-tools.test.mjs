/**
 * Behavior tests for the native DSH tool surface: spec collection from the
 * expose table, ToolDefinition construction, argument mapping, output
 * projection, and differential registration.
 *
 * Every dependency is an in-memory fake: the tool registry is a Map, the call
 * path is a closure, and the logger captures lines. Nothing listens on a port
 * or spawns a child.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapturingLogger } from '../src/logger.ts'
import {
  collectNativeToolSpecs,
  createNativeToolSet,
  selectSpecs,
} from '../src/native-tools.ts'

/** The JSON Schema every native tool declares for its canonical result value. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'array', items: {} },
    structuredContent: {},
  },
  required: ['content'],
  additionalProperties: false,
}

/**
 * Raw tools advertised by upstream `gh`.
 * @returns raw tool list.
 */
function ghTools() {
  return [
    {
      name: 'search',
      description: 'Search repositories',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query' },
          sort: { type: 'string', description: 'Sort order' },
          per_page: { type: 'integer' },
          format: { type: 'string' },
        },
        required: ['query'],
      },
    },
    { name: 'code_search', description: 'Deep code search' },
    { name: 'unused_tool', description: 'Not exposed to anyone' },
  ]
}

/**
 * Minimal gateway configuration: one transformed search tool, one passthrough
 * tool with no upstream schema, a hidden entry, a tool the upstream dropped, and
 * an entry whose upstream was never listed.
 * @returns the configuration.
 */
function baseConfig() {
  return {
    upstreams: [],
    serverName: 'mcpp',
    expose: {
      'gh/search': {
        upstream: 'gh',
        tool: 'search',
        toolset: 'search',
        as: 'gh_search',
        description: 'Search GitHub. Use `gh/code` for deep code search.',
        params: [
          { name: 'q', mapFrom: 'query', required: true },
          { name: 'sort', type: 'enum', mapping: { best: 'best', top: 'top' } },
          { name: 'per_page', hidden: true, default: 20 },
          { name: 'format' },
        ],
      },
      'gh/code': {
        upstream: 'gh',
        tool: 'code_search',
        description: 'Deep search; `gh/search` finds repositories first.',
      },
      'gh/hidden': { upstream: 'gh', tool: 'unused_tool', hide: true },
      'gh/missing': { upstream: 'gh', tool: 'not_listed' },
      'other/absent': { upstream: 'other', tool: 'anything' },
    },
  }
}

/**
 * The raw tool list map passed to spec collection.
 * @returns upstream name -> raw tools.
 */
function upstreamToolMap() {
  return new Map([['gh', ghTools()]])
}

/**
 * Fake of the DSH tool registry: conflict on an occupied name throws, and every
 * registration exposes its disposer for observation.
 * @param {object} [options] - initial state.
 * @param {string[]} [options.occupied] - names squatted on by another plugin.
 * @returns the fake registry plus observable registration state.
 */
function createFakeRegistry({ occupied = [] } = {}) {
  const registered = new Map()
  const occupiedNames = new Set(occupied)
  const registerCalls = []
  const disposed = []
  const registry = {
    registered,
    registerCalls,
    disposed,
    occupy(name) { occupiedNames.add(name) },
    release(name) { occupiedNames.delete(name) },
    register(definition) {
      if (occupiedNames.has(definition.name) || registered.has(definition.name)) {
        throw new Error(`tool "${definition.name}" is already registered`)
      }
      registerCalls.push(definition.name)
      registered.set(definition.name, definition)
      return () => {
        disposed.push(definition.name)
        registered.delete(definition.name)
      }
    },
  }
  return registry
}

/**
 * Fake upstream call path that records every invocation.
 * @param {Function} [handler] - result producer for one call.
 * @returns the call function and its recorded invocations.
 */
function createCallPath(handler = () => ({ content: [{ type: 'text', text: 'ok' }] })) {
  const calls = []
  const call = async (upstreamName, tool, args, signal) => {
    const invocation = { upstreamName, tool, args, signal }
    calls.push(invocation)
    return handler(invocation)
  }
  return { calls, call }
}

/**
 * Assemble a native tool set over in-memory fakes.
 * @param {object} [options] - registry, call handler, and deadline policy.
 * @returns the set handle with its fakes.
 */
function createSet({ registry = createFakeRegistry(), handler, timeoutFor } = {}) {
  const callPath = createCallPath(handler)
  const logger = new CapturingLogger()
  const set = createNativeToolSet({
    tools: registry,
    logger,
    call: callPath.call,
    ...(timeoutFor === undefined ? {} : { timeoutFor }),
  })
  return { set, registry, calls: callPath.calls, logger }
}

/**
 * Collect the specs of the base fixture.
 * @returns native specs.
 */
function baseSpecs() {
  return collectNativeToolSpecs(baseConfig(), upstreamToolMap())
}

test('collectNativeToolSpecs maps expose entries to claude public names', () => {
  const specs = baseSpecs()
  assert.deepEqual(specs.map((spec) => spec.publicName), ['mcp__search__gh_search', 'mcp__mcpp__code'])
  assert.deepEqual(specs.map((spec) => spec.key), ['gh/search', 'gh/code'])
  assert.deepEqual(specs.map((spec) => spec.toolset), ['search', 'mcpp'])
  assert.deepEqual(specs.map((spec) => spec.upstreamName), ['gh', 'gh'])
  const search = specs[0]
  assert.equal(search.description, 'Search GitHub. Use `mcp__mcpp__code` for deep code search.')
  assert.equal(specs[1].description, 'Deep search; `mcp__search__gh_search` finds repositories first.')
})

test('collectNativeToolSpecs derives the downstream input schema', () => {
  const [search, code] = baseSpecs()
  assert.deepEqual(search.inputSchema, {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Query' },
      sort: { type: 'string', description: 'Sort order', enum: ['best', 'top'] },
      format: { type: 'string' },
    },
    required: ['q'],
  })
  assert.equal(code.inputSchema, undefined)
})

test('collectNativeToolSpecs skips hidden, vanished, and absent tools', () => {
  const names = baseSpecs().map((spec) => spec.publicName)
  assert.equal(names.includes('mcp__mcpp__hidden'), false)
  assert.equal(names.includes('mcp__mcpp__missing'), false)
  assert.equal(names.includes('mcp__mcpp__absent'), false)
  assert.deepEqual(collectNativeToolSpecs(baseConfig(), new Map()), [])
})

test('collectNativeToolSpecs transforms each upstream once', () => {
  const upstreamTools = upstreamToolMap()
  let lookups = 0
  const counting = {
    get(name) {
      lookups += 1
      return upstreamTools.get(name)
    },
  }
  collectNativeToolSpecs(baseConfig(), counting)
  // One lookup for `gh`, one for the upstream that has no tool list.
  assert.equal(lookups, 2)
})

test('selectSpecs filters by stable expose key', () => {
  const specs = baseSpecs()
  assert.deepEqual(selectSpecs(specs, ['gh/code']).map((spec) => spec.key), ['gh/code'])
  assert.deepEqual(selectSpecs(specs, new Set(['gh/search'])).map((spec) => spec.key), ['gh/search'])
  assert.deepEqual(selectSpecs(specs, ['gh/search', 'gh/code']).map((spec) => spec.key), ['gh/search', 'gh/code'])
  assert.deepEqual(selectSpecs(specs, []), [])
  assert.deepEqual(selectSpecs(specs, ['unknown/key']), [])
})

test('sync registers one ToolDefinition per spec', () => {
  const { set, registry } = createSet({ timeoutFor: (spec) => (spec.key === 'gh/search' ? 5000 : undefined) })
  const result = set.sync(baseSpecs())
  assert.deepEqual(result.registered.sort(), ['mcp__mcpp__code', 'mcp__search__gh_search'])
  assert.deepEqual(result.errors, [])
  assert.deepEqual(set.registeredNames().sort(), ['mcp__mcpp__code', 'mcp__search__gh_search'])

  const search = registry.registered.get('mcp__search__gh_search')
  assert.equal(search.name, 'mcp__search__gh_search')
  assert.equal(search.description, 'Search GitHub. Use `mcp__mcpp__code` for deep code search.')
  assert.deepEqual(search.parameters, baseSpecs()[0].inputSchema)
  assert.equal(search.timeoutMs, 5000)
  assert.deepEqual(search.output.schema, OUTPUT_SCHEMA)

  // A tool with no upstream schema still gets a valid empty argument schema.
  const code = registry.registered.get('mcp__mcpp__code')
  assert.deepEqual(code.parameters, { type: 'object', properties: {} })
  assert.equal('timeoutMs' in code, false)
})

test('output.render projects MCP content to one text block', () => {
  const { set, registry } = createSet()
  set.sync(baseSpecs())
  const render = registry.registered.get('mcp__search__gh_search').output.render

  assert.deepEqual(render(undefined, {
    content: [{ type: 'text', text: 'alpha' }, { type: 'text', text: 'beta' }],
  }), [{ type: 'text', text: 'alpha\nbeta' }])

  assert.deepEqual(render(undefined, {
    content: [
      { type: 'text', text: 'see' },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'audio', mimeType: 'audio/wav', data: 'AAAA' },
      { type: 'resource', resource: { uri: 'file:///x', text: 'body' } },
      { type: 'resource_link', name: 'README', uri: 'file:///README.md' },
      { type: 'resource_link' },
      { type: 'not-a-block' },
      'not a block',
    ],
  }), [{
    type: 'text',
    text: [
      'see',
      '[image png]',
      '[audio wav]',
      '[embedded resource]',
      'Resource link: README (file:///README.md)',
      '[resource link unavailable: the MCP block is missing its name or URI]',
      '[unsupported MCP content type: not-a-block]',
      '[unsupported MCP content block: expected an object]',
    ].join('\n'),
  }])

  const empty = [{ type: 'text', text: '(tool returned no model-visible content)' }]
  assert.deepEqual(render(undefined, { content: [] }), empty)
  assert.deepEqual(render(undefined, {}), empty)
})

test('execute maps arguments through the expose transforms and returns the result value', async () => {
  const { set, registry, calls } = createSet({
    handler: () => ({ content: [{ type: 'text', text: 'hit' }], structuredContent: { total: 1 } }),
  })
  set.sync(baseSpecs())
  const definition = registry.registered.get('mcp__search__gh_search')
  const signal = new AbortController().signal

  const result = await definition.execute(
    { q: 'cats', sort: 'top', format: 'json', ignored: true },
    { signal },
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].upstreamName, 'gh')
  assert.equal(calls[0].tool, 'search')
  assert.equal(calls[0].signal, signal)
  assert.deepEqual(calls[0].args, { query: 'cats', sort: 'top', per_page: 20, format: 'json' })
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'hit' }],
    structuredContent: { total: 1 },
  })
})

test('execute treats non-object arguments as none', async () => {
  const { set, registry, calls } = createSet()
  set.sync(baseSpecs())
  const definition = registry.registered.get('mcp__search__gh_search')
  const signal = new AbortController().signal

  await definition.execute('not-a-json-object', { signal })
  // Hidden defaults are still injected; nothing else survives.
  assert.deepEqual(calls[0].args, { per_page: 20 })
})

test('execute throws the projected text of an isError result', async () => {
  const { set, registry } = createSet({
    handler: () => ({
      isError: true,
      content: [
        { type: 'text', text: 'upstream exploded' },
        { type: 'image', mimeType: 'image/png' },
      ],
    }),
  })
  set.sync(baseSpecs())
  const definition = registry.registered.get('mcp__search__gh_search')
  await assert.rejects(
    definition.execute({ q: 'cats' }, { signal: new AbortController().signal }),
    /upstream exploded\n\[image png\]/,
  )
})

test('execute omits structuredContent when the upstream did not return it', async () => {
  const { set, registry } = createSet({ handler: () => ({ content: [] }) })
  set.sync(baseSpecs())
  const definition = registry.registered.get('mcp__mcpp__code')
  const result = await definition.execute({}, { signal: new AbortController().signal })
  assert.deepEqual(result, { content: [] })
  assert.equal(Object.hasOwn(result, 'structuredContent'), false)
})

test('sync diffs by public name and keeps unchanged registrations', () => {
  const { set, registry } = createSet()
  const config = baseConfig()
  const upstreamTools = upstreamToolMap()

  const first = set.sync(collectNativeToolSpecs(config, upstreamTools))
  assert.equal(first.registered.length, 2)
  assert.equal(registry.registerCalls.length, 2)

  // The same content collected again must not churn the registry.
  const second = set.sync(collectNativeToolSpecs(config, upstreamTools))
  assert.equal(registry.registerCalls.length, 2)
  assert.deepEqual(registry.disposed, [])
  assert.deepEqual(second.registered, first.registered)

  // A changed description disposes and re-registers exactly that tool.
  const changed = baseConfig()
  changed.expose['gh/search'].description = 'Changed description'
  const third = set.sync(collectNativeToolSpecs(changed, upstreamTools))
  assert.equal(registry.registerCalls.length, 3)
  assert.deepEqual(registry.disposed, ['mcp__search__gh_search'])
  assert.equal(
    registry.registered.get('mcp__search__gh_search').description,
    'Changed description',
  )
  assert.deepEqual(third.registered.sort(), ['mcp__mcpp__code', 'mcp__search__gh_search'])

  // A removed entry disposes only its own tool.
  delete changed.expose['gh/code']
  const fourth = set.sync(collectNativeToolSpecs(changed, upstreamTools))
  assert.deepEqual(fourth.registered, ['mcp__search__gh_search'])
  assert.deepEqual(registry.disposed, ['mcp__search__gh_search', 'mcp__mcpp__code'])
  assert.equal(registry.registerCalls.length, 3)
})

test('sync ignores JSON key order when hashing a schema', () => {
  const { set, registry } = createSet()
  const specs = baseSpecs()
  set.sync(specs)
  assert.equal(registry.registerCalls.length, 2)

  /**
   * Rebuild a JSON value with reversed object keys.
   * @param {unknown} value - value to flip.
   * @returns the same content with different key order.
   */
  const reverseKeys = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]),
    )
  }
  const reordered = specs.map((spec) => (
    spec.inputSchema === undefined
      ? spec
      : { ...spec, inputSchema: reverseKeys(spec.inputSchema) }
  ))
  set.sync(reordered)
  assert.equal(registry.registerCalls.length, 2)
  assert.deepEqual(registry.disposed, [])
})

test('sync re-registers a tool when its deadline changes', () => {
  let timeoutMs = 100
  const { set, registry } = createSet({
    timeoutFor: (spec) => (spec.key === 'gh/search' ? timeoutMs : undefined),
  })
  const specs = baseSpecs()
  set.sync(specs)
  assert.equal(registry.registered.get('mcp__search__gh_search').timeoutMs, 100)

  timeoutMs = 250
  set.sync(specs)
  assert.equal(registry.registered.get('mcp__search__gh_search').timeoutMs, 250)
  assert.equal(registry.registerCalls.length, 3)
  assert.deepEqual(registry.disposed, ['mcp__search__gh_search'])
})

test('sync reports a registration conflict and keeps the rest of the generation', () => {
  const registry = createFakeRegistry({ occupied: ['mcp__search__gh_search'] })
  const { set, logger } = createSet({ registry })
  const result = set.sync(baseSpecs())

  assert.deepEqual(result.registered, ['mcp__mcpp__code'])
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].name, 'mcp__search__gh_search')
  assert.match(result.errors[0].message, /already registered/)
  assert.deepEqual(set.registeredNames(), ['mcp__mcpp__code'])
  assert.deepEqual(set.errors(), result.errors)
  assert.match(logger.text(), /cannot register "mcp__search__gh_search"/)

  // A later sync retries the failed name once the conflict clears.
  registry.release('mcp__search__gh_search')
  const retry = set.sync(baseSpecs())
  assert.deepEqual(retry.registered.sort(), ['mcp__mcpp__code', 'mcp__search__gh_search'])
  assert.deepEqual(retry.errors, [])
  assert.deepEqual(set.errors(), [])
})

test('dispose unregisters every tool this set registered', () => {
  const { set, registry } = createSet()
  set.sync(baseSpecs())
  assert.equal(registry.registered.size, 2)

  set.dispose()
  assert.deepEqual(set.registeredNames(), [])
  assert.equal(registry.registered.size, 0)
  assert.deepEqual(set.errors(), [])

  set.dispose()
  assert.equal(registry.registered.size, 0)
})
