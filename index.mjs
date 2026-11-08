/**
 * Bundle entry for the dsh loader: re-exports the Cordis plugin surface from
 * the TypeScript sources, which tsdown inlines into `lib/index.js`.
 *
 * @module
 */
export { apply, Config, name } from './src/plugin.ts'
