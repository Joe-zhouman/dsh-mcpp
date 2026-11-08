/**
 * Packaging contract: the npm `files` list must ship every artifact the DSH
 * loader and the plugin's own runtime read from the installed package.
 *
 * Regression guard for the 2026-11-08 incident: pnpm materializes a `file:`
 * dependency as a packed copy that respects `files`; `cordis.patch.yml` was
 * missing from that list, so a profile update installed a package whose
 * declared bundle patch did not exist and the next boot preflight rejected the
 * whole profile ("declared patch ./cordis.patch.yml is missing").
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))

test('files ships everything the installed package needs at runtime', () => {
  const files = manifest.files ?? []
  for (const required of ['lib', 'static', 'cordis.patch.yml']) {
    assert.ok(files.includes(required), `package.json files must include "${required}"`)
  }
  // npm always includes package.json itself; nothing else is read at runtime.
  assert.deepEqual(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('every declared artifact exists on disk', () => {
  for (const file of manifest.files ?? []) {
    assert.ok(existsSync(join(packageDir, file)), `declared artifact "${file}" is missing`)
  }
  assert.equal(manifest.main, './lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.ok(existsSync(join(packageDir, 'lib/client.js')), 'client bundle must be built before packaging')
})

test('the bundle patch is valid and inserts this plugin row', () => {
  const patch = readFileSync(join(packageDir, manifest.dsh.bundle.patch), 'utf8')
  assert.match(patch, /^\s*- insert:/m)
  assert.match(patch, /name: dsh-mcpp/)
})
