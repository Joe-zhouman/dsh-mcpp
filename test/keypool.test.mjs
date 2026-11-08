import assert from 'node:assert/strict'
import test from 'node:test'

import { KeyPool } from '../src/keypool.ts'

test('next rotates round-robin', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  assert.equal(pool.next(), 'a')
  assert.equal(pool.next(), 'b')
  assert.equal(pool.next(), 'c')
  assert.equal(pool.next(), 'a')
})

test('markBad pauses a key until it is resumed', () => {
  const pool = new KeyPool(['a', 'b'])
  assert.equal(pool.next(), 'a')
  pool.markBad('a')
  assert.equal(pool.next(), 'b')
  assert.equal(pool.next(), 'b')
})

test('next throws when every key is paused', () => {
  const pool = new KeyPool(['a'])
  pool.markBad('a')
  assert.throws(() => pool.next(), { name: 'Error', message: 'No healthy keys available in pool' })
})

test('resume returns a paused key to rotation', () => {
  const pool = new KeyPool(['a', 'b'])
  pool.markBad('a')
  pool.markBad('b')
  assert.throws(() => pool.next(), /No healthy keys available in pool/)
  pool.resume('a')
  assert.equal(pool.next(), 'a')
})

test('the constructor rejects an empty key list', () => {
  assert.throws(() => new KeyPool([]), { name: 'Error', message: 'Pool requires at least one key' })
})

test('the constructor copies the keys it is given', () => {
  const keys = ['a', 'b']
  const pool = new KeyPool(keys)
  keys.push('c')
  keys[0] = 'z'
  assert.equal(pool.next(), 'a')
  assert.equal(pool.next(), 'b')
  assert.equal(pool.next(), 'a')
})

test('current is the most recently handed-out key', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  assert.equal(pool.next(), 'a')
  assert.equal(pool.current, 'a')
  assert.equal(pool.next(), 'b')
  assert.equal(pool.current, 'b')
  pool.markBad(pool.current)
  assert.equal(pool.current, 'b')
})

test('current before the first next is the pool tail', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  assert.equal(pool.current, 'c')
})

test('current keeps tracking the last return when keys are paused', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  pool.markBad('a')
  assert.equal(pool.next(), 'b')
  assert.equal(pool.current, 'b')
  pool.markBad('b')
  assert.equal(pool.next(), 'c')
  assert.equal(pool.current, 'c')
})

test('statuses report masked keys and pause state', () => {
  const pool = new KeyPool(['abcdefgh', 'ij', 'secret-key'])
  pool.markBad('ij')
  assert.deepEqual(pool.statuses(), [
    { index: 0, key: 'abcd...', paused: false },
    { index: 1, key: 'ij...', paused: true },
    { index: 2, key: 'secr...', paused: false },
  ])
})

test('statuses return a fresh snapshot', () => {
  const pool = new KeyPool(['abcd'])
  const first = pool.statuses()
  pool.markBad('abcd')
  assert.deepEqual(first, [{ index: 0, key: 'abcd...', paused: false }])
  assert.deepEqual(pool.statuses(), [{ index: 0, key: 'abcd...', paused: true }])
})

test('healthyCount follows pause and resume', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  assert.equal(pool.healthyCount, 3)
  pool.markBad('a')
  assert.equal(pool.healthyCount, 2)
  pool.markBad('a')
  assert.equal(pool.healthyCount, 2)
  pool.markBad('b')
  assert.equal(pool.healthyCount, 1)
  pool.resume('a')
  assert.equal(pool.healthyCount, 2)
  pool.resume('not-in-the-pool')
  assert.equal(pool.healthyCount, 2)
})

test('healthyCount records an unknown bad key like the old pool did', () => {
  // Ported from the retired service: healthy_count = len(keys) - len(bad_set),
  // so a key that is not in the pool still reduces the count.
  const pool = new KeyPool(['a', 'b'])
  pool.markBad('ghost')
  assert.equal(pool.healthyCount, 1)
  assert.equal(pool.next(), 'a')
  pool.resume('ghost')
  assert.equal(pool.healthyCount, 2)
})

test('keyAt returns raw keys by index', () => {
  const pool = new KeyPool(['abcd1234', 'efgh5678'])
  assert.equal(pool.keyAt(0), 'abcd1234')
  assert.equal(pool.keyAt(1), 'efgh5678')
})

test('keyAt accepts a negative index from the end', () => {
  const pool = new KeyPool(['abcd1234', 'efgh5678'])
  assert.equal(pool.keyAt(-1), 'efgh5678')
  assert.equal(pool.keyAt(-2), 'abcd1234')
})

test('keyAt rejects an out-of-range index', () => {
  const pool = new KeyPool(['abcd1234'])
  assert.throws(() => pool.keyAt(1), RangeError)
  assert.throws(() => pool.keyAt(-2), RangeError)
})

test('a paused key is skipped without disturbing the round-robin cursor', () => {
  const pool = new KeyPool(['a', 'b', 'c'])
  assert.equal(pool.next(), 'a')
  pool.markBad('b')
  assert.equal(pool.next(), 'c')
  assert.equal(pool.next(), 'a')
  pool.resume('b')
  assert.equal(pool.next(), 'b')
})
