/**
 * Run the gateway outside DSH for verification: `node --experimental-strip-types
 * scripts/run-standalone.mjs <config.yaml> [port]`.
 *
 * This is the pre-install harness — it exercises the same `createGateway` path
 * the Cordis plugin uses, so a listener that answers here answers identically
 * once the plugin is active in a profile.
 *
 * @module
 */

import { createGateway } from '../src/bootstrap.ts'

const configPath = process.argv[2] ?? 'config.yaml'
const port = Number(process.argv[3] ?? process.env['MCPP_PORT'] ?? '9021')

const gateway = createGateway({ configPath, host: '127.0.0.1', port })
const address = await gateway.start()
process.stdout.write(`mcpp-standalone listening on http://${address.host}:${address.port}\n`)

const shutdown = async (signal) => {
  process.stdout.write(`mcpp-standalone: ${signal}, shutting down\n`)
  await gateway.close()
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
