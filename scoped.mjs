/**
 * Bundle entry for the preset-scoped surface: re-exports the Cordis plugin
 * from the TypeScript sources, which tsdown inlines into `lib/scoped.js`.
 *
 * @module
 */
export { apply, Config, inject, name } from './src/scoped.ts'
