/**
 * Behavior tests for the selection document: default path resolution, default
 * all-off state, atomic save, and safe fallback for malformed documents.
 *
 * Every test owns a throwaway temp directory; nothing reads the real DSH home.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { CapturingLogger } from '../src/logger.ts'
import { createSelectionStore, selectionPathFromEnv } from '../src/selection.ts'

/** The document a missing or unusable file produces. */
const EMPTY = { version: 1, enabled: [] }

/**
 * Create one isolated temp directory, removed after the test.
 * @param {object} t - node:test context.
 * @returns absolute directory path.
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mcpp-selection-'))
  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/**
 * Write arbitrary text at one path, creating its parent directory.
 * @param {string} filePath - destination path.
 * @param {string} text - file contents.
 */
function writeText(filePath, text) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, text)
}

test('selectionPathFromEnv derives the path under DSH_HOME', () => {
  const home = join('C:', 'dsh-home')
  assert.equal(
    selectionPathFromEnv({ DSH_HOME: home }),
    join(home, 'storages', 'mcpp', 'selection.json'),
  )
  const fallback = join(homedir(), '.dsh', 'storages', 'mcpp', 'selection.json')
  assert.equal(selectionPathFromEnv({}), fallback)
  assert.equal(selectionPathFromEnv({ DSH_HOME: '' }), fallback)
})

test('load defaults to the empty selection when the document does not exist', async (t) => {
  const filePath = join(tempDir(t), 'storages', 'mcpp', 'selection.json')
  const store = createSelectionStore(filePath)
  assert.equal(store.path(), filePath)
  assert.deepEqual(await store.load(), EMPTY)
})

test('save creates the directory and round-trips the selection', async (t) => {
  const dir = tempDir(t)
  const filePath = join(dir, 'storages', 'mcpp', 'selection.json')
  const store = createSelectionStore(filePath)

  await store.save(['gh/search', 'zhihu/Profile'])
  assert.deepEqual(await store.load(), { version: 1, enabled: ['gh/search', 'zhihu/Profile'] })

  const onDisk = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.deepEqual(onDisk, { version: 1, enabled: ['gh/search', 'zhihu/Profile'] })
  // The temporary file is renamed away, never left next to the document.
  assert.deepEqual(readdirSync(dirname(filePath)), ['selection.json'])

  await store.save(['gh/code'])
  assert.deepEqual(await store.load(), { version: 1, enabled: ['gh/code'] })
  assert.deepEqual(readdirSync(dirname(filePath)), ['selection.json'])
})

test('load drops non-string and duplicate keys', async (t) => {
  const filePath = join(tempDir(t), 'selection.json')
  writeText(filePath, JSON.stringify({
    version: 1,
    enabled: ['a', 'a', 3, null, { key: 'b' }, 'b', 'b'],
  }))
  const store = createSelectionStore(filePath)
  assert.deepEqual(await store.load(), { version: 1, enabled: ['a', 'b'] })
})

test('load falls back to the empty selection for invalid JSON', async (t) => {
  const filePath = join(tempDir(t), 'selection.json')
  writeText(filePath, '{not json')
  const logger = new CapturingLogger()
  const store = createSelectionStore(filePath, logger)
  assert.deepEqual(await store.load(), EMPTY)
  assert.match(logger.text(), /not valid JSON/)
})

test('load falls back to the empty selection for an unsupported shape', async (t) => {
  const dir = tempDir(t)
  const logger = new CapturingLogger()
  const cases = [
    ['unknown version', JSON.stringify({ version: 2, enabled: ['a'] })],
    ['missing enabled', JSON.stringify({ version: 1 })],
    ['non-string enabled', JSON.stringify({ version: 1, enabled: 'a' })],
    ['array document', '[]'],
    ['null document', 'null'],
  ]
  for (const [label, text] of cases) {
    const filePath = join(dir, `${label.replaceAll(' ', '-')}.json`)
    writeText(filePath, text)
    const store = createSelectionStore(filePath, logger)
    assert.deepEqual(await store.load(), EMPTY, label)
  }
  assert.match(logger.text(), /unsupported shape/)
})

test('load falls back to the empty selection when the document cannot be read', async (t) => {
  const filePath = join(tempDir(t), 'selection.json')
  mkdirSync(filePath)
  const logger = new CapturingLogger()
  const store = createSelectionStore(filePath, logger)
  assert.deepEqual(await store.load(), EMPTY)
  assert.match(logger.text(), /cannot read/)
})

test('save rejects when the destination directory cannot be created', async (t) => {
  const dir = tempDir(t)
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory')
  const store = createSelectionStore(join(blocker, 'selection.json'))
  await assert.rejects(store.save(['a']), /EEXIST|ENOTDIR/)
})
