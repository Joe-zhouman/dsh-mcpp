/**
 * Behavior tests for the `ctx.mcpp` service's preset-facing methods: the
 * `specs()` filter that selects registrable native tools and the low-level
 * `invoke()` call path. Upstreams are in-memory fakes; nothing listens on a
 * port.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createFixture } from './fixtures/mcpp-fixture.mjs'

test('specs selects nothing when the include filter is absent', async () => {
  const { service, rawToolCalls } = createFixture()
  assert.deepEqual(await service.specs(), [])
  assert.deepEqual(await service.specs({}), [])
  // An exclusion without an include filter still selects nothing, and must not
  // list the upstreams just to discard every tool.
  assert.deepEqual(await service.specs({ exclude: ['searxng'] }), [])
  assert.equal(rawToolCalls.count, 0)
})

test('specs filters by toolset and reports the upstream deadline', async () => {
  const { service } = createFixture()

  const search = await service.specs({ toolsets: ['search'] })
  assert.deepEqual(search.map((entry) => entry.spec.publicName), ['mcp__search__searxng'])
  assert.equal(search[0].timeoutMs, 60000)

  const academic = await service.specs({ toolsets: ['academic'] })
  assert.deepEqual(academic.map((entry) => entry.spec.publicName), ['mcp__academic__search_papers'])
  assert.equal(academic[0].timeoutMs, 75000)

  const both = await service.specs({ toolsets: ['search', 'get'] })
  assert.deepEqual(both.map((entry) => entry.spec.publicName), [
    'mcp__search__searxng',
    'mcp__get__jina_markdown',
  ])
})

test('specs resolves a tool by public name, display name, or stable key', async () => {
  const { service } = createFixture()
  for (const name of ['mcp__search__searxng', 'searxng', 'search/searxng_search']) {
    const entries = await service.specs({ tools: [name] })
    assert.deepEqual(entries.map((entry) => entry.spec.key), ['search/searxng_search'], name)
    assert.deepEqual(entries.map((entry) => entry.spec.upstreamName), ['search'], name)
  }
})

test('specs narrows by tools and toolset together and drops exclusions', async () => {
  const { service } = createFixture()

  // Both include lists are present, so a spec must satisfy each one.
  assert.deepEqual(await service.specs({ tools: ['searxng'], toolsets: ['academic'] }), [])

  const excluded = await service.specs({
    toolsets: ['search', 'get', 'academic'],
    exclude: ['mcp__search__searxng', 'jina_markdown'],
  })
  assert.deepEqual(excluded.map((entry) => entry.spec.key), ['academic/search_papers'])
})

test('specs ignores an exclusion that matches nothing', async () => {
  const { service } = createFixture()
  const entries = await service.specs({ toolsets: ['search'], exclude: ['mcp__search__missing'] })
  assert.deepEqual(entries.map((entry) => entry.spec.key), ['search/searxng_search'])
})

test('specs rejects an explicit tool name that matches no exposed tool', async () => {
  const { service } = createFixture()
  await assert.rejects(
    service.specs({ tools: ['mcp__search__missing'] }),
    /no exposed tool matches filter tools "mcp__search__missing"/,
  )
})

test('specs rejects a toolset that matches no exposed tool', async () => {
  const { service } = createFixture()
  await assert.rejects(
    service.specs({ toolsets: ['nope'] }),
    /no exposed tool matches filter toolsets "nope"/,
  )
})

test('specs reports every unknown selector at once', async () => {
  const { service } = createFixture()
  await assert.rejects(
    service.specs({ tools: ['missing'], toolsets: ['nope'] }),
    /tools "missing" and toolsets "nope"/,
  )
})

test('specs never selects hidden or unlisted tools', async () => {
  const { service } = createFixture()
  await assert.rejects(service.specs({ tools: ['mcp__academic__hidden_tool'] }), /hidden_tool/)
  await assert.rejects(service.specs({ tools: ['mcp__search__not_listed'] }), /not_listed/)
})

test('specs leaves timeoutMs undefined for an unconfigured upstream', async () => {
  const { service } = createFixture()
  const entries = await service.specs({ tools: ['mcp__mcpp__thing'] })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].spec.upstreamName, 'ghost')
  assert.equal(entries[0].timeoutMs, undefined)
})

test('specs asks the host for the raw tool snapshot on every include filter', async () => {
  const { service, rawToolCalls } = createFixture()
  await service.specs({ toolsets: ['search'] })
  await service.specs({ toolsets: ['academic'] })
  assert.equal(rawToolCalls.count, 2)
})

test('invoke calls the upstream transport without parameter transforms', async () => {
  const { service, transports } = createFixture()
  // `q` is the downstream spelling; invoke must hand it to the upstream as-is.
  const result = await service.invoke('search', 'searxng', { q: 'cats' })
  assert.deepEqual(transports.search.calls, [{ tool: 'searxng', args: { q: 'cats' } }])
  assert.deepEqual(result, { content: [{ type: 'text', text: 'search:searxng' }] })
})

test('invoke rejects an aborted call before dispatch', async () => {
  const { service, transports } = createFixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    service.invoke('search', 'searxng', {}, controller.signal),
    /canceled before dispatch/,
  )
  assert.deepEqual(transports.search.calls, [])
})

test('invoke rejects an upstream that is not configured', async () => {
  const { service } = createFixture()
  await assert.rejects(
    service.invoke('ghost', 'thing', {}),
    /upstream 'ghost' is not configured/,
  )
})
