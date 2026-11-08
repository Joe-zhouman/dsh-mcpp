/**
 * Round-robin, health-aware API key pool for one upstream.
 *
 * Ported from the retired service's `keypool.py`.
 *
 * Owner: config-transform. Contract: DESIGN.md § src/keypool.ts.
 *
 * @module
 */

import type { KeyPoolView, KeyStatus } from './types.ts'

/** Hidden-key prefix length reported by {@link KeyPool.statuses}. */
const MASK_PREFIX = 4

/**
 * Keys are handed out round-robin. A key marked bad is skipped until resumed;
 * when every key is paused {@link next} throws so the caller surfaces an
 * explicit "no healthy keys" failure instead of sending an empty credential.
 */
export class KeyPool implements KeyPoolView {
  private readonly keys: string[]
  private readonly bad = new Set<string>()
  private index = 0

  /**
   * @param keys - at least one key; the pool keeps its own copy.
   * @throws Error when `keys` is empty.
   */
  constructor(keys: string[]) {
    if (keys.length === 0) throw new Error('Pool requires at least one key')
    this.keys = [...keys]
  }

  /**
   * Next healthy key in round-robin order, shared by every caller.
   * @returns the key to send.
   * @throws Error when every key is paused.
   */
  next(): string {
    for (let attempt = 0; attempt < this.keys.length; attempt += 1) {
      const key = this.keys[this.index]
      this.index = (this.index + 1) % this.keys.length
      if (!this.bad.has(key)) return key
    }
    throw new Error('No healthy keys available in pool')
  }

  /**
   * Pause one key until it is resumed explicitly.
   * @param key - key that failed; an unknown key is recorded like the old service did.
   */
  markBad(key: string): void {
    this.bad.add(key)
  }

  /**
   * Return one paused key to rotation.
   * @param key - key to resume; resuming an unknown or healthy key is a no-op.
   */
  resume(key: string): void {
    this.bad.delete(key)
  }

  /** How many keys are currently usable. */
  get healthyCount(): number {
    return this.keys.length - this.bad.size
  }

  /**
   * Masked key statuses for the admin API.
   * @returns one status per key, in pool order.
   */
  statuses(): KeyStatus[] {
    return this.keys.map((key, index) => ({
      index,
      key: key.slice(0, MASK_PREFIX) + '...',
      paused: this.bad.has(key),
    }))
  }

  /**
   * Key at a raw index, for admin resume/delete operations.
   * @param index - zero-based index; negative indexes count from the end.
   * @returns the raw (unmasked) key.
   * @throws RangeError when the index falls outside the pool.
   */
  keyAt(index: number): string {
    const resolved = index < 0 ? index + this.keys.length : index
    if (resolved < 0 || resolved >= this.keys.length) {
      throw new RangeError(`Key index ${index} out of range for a pool of ${this.keys.length}`)
    }
    return this.keys[resolved]
  }

  /** The most recently returned key (used to mark a failed request's key bad). */
  get current(): string {
    const previous = (this.index - 1 + this.keys.length) % this.keys.length
    return this.keys[previous]
  }
}
