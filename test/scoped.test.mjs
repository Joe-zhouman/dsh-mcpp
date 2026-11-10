/**
 * Behavior tests for the preset-scoped Cordis entry: which tools a row
 * registers, the filter spellings it accepts, fail-loud behavior for a filter
 * that matches nothing, execution through `ctx.mcpp.invoke`, and disposal with
 * the scope.
 *
 * The context, tool registry, and logger are in-memory fakes; `ctx.mcpp` is a
 * real service over the fake upstreams from `fixtures/mcpp-fixture.mjs`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, Config, inject, name } from '../src/scoped.ts'
import { createFixture } from './fixtures/mcpp-fixture.mjs'

/** Fake scope tool registry that reports conflicts like the real one. */
function createFakeTools() {
  const registered = new Map()
  const registerCalls = []
  return {
    registered,
    registerCalls,
    register(definition) {
      if (registered.has(definition.name)) {
        throw new Error(`tool "${definition.name}" is already registered`)
      }
      registerCalls.push(definition.name)
      registered.set(definition.name, definition)
      return () => { registered.delete(definition.name) }
    },
  }
}

/**
 * Build the preset-scope context around a service.
 * @param {object} mcpp - value exposed as `ctx.mcpp`.
 * @returns the context, its tool registry, recorded effects, and log lines.
 */
function createFakeCtx(mcpp) {
  const tools = createFakeTools()
  const effects = []
  const logs = []
  const ctx = {
    logger: {
      info: (...args) => { logs.push(`info: ${args.join(' ')}`) },
      warn: (...args) => { logs.push(`warn: ${args.join(' ')}`) },
      error: (...args) => { logs.push(`error: ${args.join(' ')}`) },
    },
    mcpp,
    tools,
    effect(execute, label) {
      effects.push({ label, dispose: execute() })
    },
  }
  return { ctx, tools, effects, logs }
}

/**
 * Assemble the fixture service and a fake context around it.
 * @returns the context, its tool registry, its effects, and the transports.
 */
function setup() {
  const { service, transports } = createFixture()
  const { ctx, tools, effects, logs } = createFakeCtx(service)
  return { ctx, tools, effects, logs, transports }
}

/** A row configuration with the given filter and empty defaults elsewhere. */
function row(overrides) {
  return { tools: [], toolsets: [], exclude: [], ...overrides }
}

test('the preset entry declares its name, services, and filter defaults', () => {
  assert.equal(name, 'mcpp-scoped')
  assert.deepEqual(inject, ['mcpp', 'tools'])
  assert.deepEqual(Config({}), { tools: [], toolsets: [], exclude: [] })
  assert.deepEqual(Config({ toolsets: ['search'] }), { tools: [], toolsets: ['search'], exclude: [] })
})

test('registers every tool of the requested toolsets into this scope', async () => {
  const { ctx, tools, logs } = setup()
  await apply(ctx, row({ toolsets: ['search', 'get'] }))

  assert.deepEqual([...tools.registered.keys()], ['mcp__search__searxng', 'mcp__get__jina_markdown'])
  const searxng = tools.registered.get('mcp__search__searxng')
  assert.equal(searxng.description, 'Search the web')
  assert.deepEqual(searxng.parameters, { type: 'object', properties: {} })
  assert.equal(searxng.timeoutMs, 60000)
  assert.match(logs.join('\n'), /mcpp-scoped: 2 tools registered/)
})

test('registers a tool addressed by public name, display name, or stable key', async () => {
  for (const toolName of ['mcp__academic__search_papers', 'search_papers', 'academic/search_papers']) {
    const { ctx, tools } = setup()
    await apply(ctx, row({ tools: [toolName] }))
    assert.deepEqual([...tools.registered.keys()], ['mcp__academic__search_papers'], toolName)
  }
})

test('exclusions drop matched tools from the registration', async () => {
  const { ctx, tools } = setup()
  await apply(ctx, row({ toolsets: ['search', 'get'], exclude: ['searxng'] }))
  assert.deepEqual([...tools.registered.keys()], ['mcp__get__jina_markdown'])
})

test('an unknown tool name fails activation instead of registering a partial set', async () => {
  const { ctx, tools } = setup()
  await assert.rejects(
    apply(ctx, row({ tools: ['mcp__search__typo'] })),
    /no exposed tool matches filter tools "mcp__search__typo"/,
  )
  assert.deepEqual(tools.registerCalls, [])
})

test('an empty filter fails activation with the filter in the message', async () => {
  const { ctx } = setup()
  await assert.rejects(
    apply(ctx, row({})),
    /matched no tools: \{"tools":\[\],"toolsets":\[\],"exclude":\[\]\}/,
  )
})

test('the registered tool executes through ctx.mcpp.invoke', async () => {
  const { ctx, tools, transports } = setup()
  await apply(ctx, row({ tools: ['jina_markdown'] }))

  const definition = tools.registered.get('mcp__get__jina_markdown')
  const value = await definition.execute({ id: 'doc-1' }, { signal: new AbortController().signal })

  assert.deepEqual(transports.search.calls, [{ tool: 'get_doc', args: { id: 'doc-1' } }])
  assert.deepEqual(value, { content: [{ type: 'text', text: 'search:get_doc' }] })
})

test('disposing the scope effect unregisters every tool it registered', async () => {
  const { ctx, tools, effects } = setup()
  await apply(ctx, row({ toolsets: ['search', 'get', 'academic'] }))
  assert.equal(tools.registered.size, 3)
  assert.equal(effects.length, 1)
  assert.equal(effects[0].label, 'mcpp-scoped.tools')

  effects[0].dispose()
  assert.equal(tools.registered.size, 0)
})
