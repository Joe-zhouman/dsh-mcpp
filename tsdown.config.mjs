/**
 * Package-local tsdown config, following the quota-monitor-plugin pattern: the
 * repository presets are workspace-only, so this file restates the contract.
 *
 * One host pass, one artifact: ESM lib/index.js from the Cordis plugin entry.
 * Runtime dependencies must be zero — the profile that loads this plugin only
 * gets what the DSH host itself provides (`@deepseek-ai/schemastery`) — so
 * js-yaml is bundled into the artifact instead of resolved from node_modules.
 * `static/index.html` stays a real file next to lib/, read through
 * `new URL('../static/index.html', import.meta.url)`.
 */

/** Package name; the loader handoff id. */
const ID = 'dsh-mcpp'

/** Only host-provided peers stay external; everything else is inlined. */
const HOST_PROVIDED = ['@deepseek-ai/schemastery']

const isHostProvided = specifier => HOST_PROVIDED.includes(specifier)

const host = {
  name: ID,
  entry: { index: 'index.mjs' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  deps: {
    neverBundle: isHostProvided,
    alwaysBundle: specifier => !isHostProvided(specifier),
  },
}

export default [host]
