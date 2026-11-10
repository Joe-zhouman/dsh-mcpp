/**
 * Package-local tsdown config, following the quota-monitor-plugin pattern: the
 * repository presets are workspace-only, so this file restates the contracts.
 *
 * Two passes, one lib/ artifact directory:
 * 1. host  — ESM lib/index.js from the Cordis plugin entry plus lib/scoped.js
 *            from the preset-scoped entry. Runtime dependencies must be zero
 *            (the profile only provides `@deepseek-ai/schemastery`), so js-yaml
 *            is bundled into the artifact.
 * 2. client — CJS factory lib/client.js for the browser module loader. The
 *            banner/intro/footer are copied verbatim from the DSH client build
 *            so the artifact is executable by `window.__ModuleLoader__.load`.
 *            Only the module-table keys (`react`, `react/jsx-runtime`) stay
 *            external; every other specifier is bundled.
 *
 * `static/index.html` stays a real file next to lib/, read through
 * `new URL('../static/index.html', import.meta.url)`.
 */

/** Package name; the loader handoff id and the client bundle filter name. */
const ID = 'dsh-mcpp'

/** Module-table specifiers this bundle imports at runtime and must not inline. */
const MODULE_TABLE_KEYS = ['react', 'react/jsx-runtime']

const isModuleTableKey = (specifier) => MODULE_TABLE_KEYS.includes(specifier)

/** Host pass: the Cordis plugin entries, loaded from the real profile install. */
const host = {
  name: ID,
  entry: { index: 'index.mjs', scoped: 'scoped.mjs' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  deps: {
    neverBundle: ['@deepseek-ai/schemastery'],
    alwaysBundle: (specifier) => specifier !== '@deepseek-ai/schemastery',
  },
}

/** Client pass: one browser factory over the TSX sources. */
const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isModuleTableKey,
    alwaysBundle: (specifier) => !isModuleTableKey(specifier),
  },
  transform: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [host, client]
