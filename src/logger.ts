/**
 * Leveled logger seam. The plugin adapts `ctx.logger` onto it; the standalone
 * harness adapts `console`. Keeping it an interface (not a global) means tests
 * can capture what the gateway reported without patching console.
 *
 * @module
 */

import type { Logger } from './types.ts'

/** Write one line to stderr with a level tag (the retired service's format). */
function toStderr(level: string, message: string): void {
  process.stderr.write(`${level} [mcpp] ${message}\n`)
}

/**
 * Build a logger writing to stderr, the retired service's destination.
 * @param label - optional prefix appended after `[mcpp]`.
 * @returns the logger.
 */
export function createLogger(label = ''): Logger {
  const suffix = label === '' ? '' : ` (${label})`
  return {
    info: (message) => { toStderr('INFO', message + suffix) },
    warn: (message) => { toStderr('WARNING', message + suffix) },
    error: (message) => { toStderr('ERROR', message + suffix) },
  }
}

/** A logger that records every line, for tests and for the admin status view. */
export class CapturingLogger implements Logger {
  readonly lines: { level: 'info' | 'warn' | 'error'; message: string }[] = []

  info(message: string): void { this.lines.push({ level: 'info', message }) }
  warn(message: string): void { this.lines.push({ level: 'warn', message }) }
  error(message: string): void { this.lines.push({ level: 'error', message }) }

  /** Every recorded line as `level: message`, oldest first. */
  text(): string {
    return this.lines.map((line) => `${line.level}: ${line.message}`).join('\n')
  }
}
