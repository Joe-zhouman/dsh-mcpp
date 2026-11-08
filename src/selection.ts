/**
 * Selection document: which aggregated tools are registered into the DSH tool
 * registry. Default is "nothing registered" — the settings page is the only
 * place tools are turned on, so the model never pays for tools the user did not
 * ask for.
 *
 * Entries are stable expose keys (`upstream/tool`), not the client-visible
 * `mcp__<toolset>__<tool>` names: renaming a tool or moving it between toolsets
 * must not silently re-enable or drop it.
 *
 * Owner: native-tools. Contract: DESIGN.md § src/selection.ts.
 *
 * @module
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Logger } from './types.ts'

/** On-disk selection document. */
export interface SelectionDocument {
  version: 1
  /** Stable `upstream/tool` keys that are registered. */
  enabled: string[]
}

/** Read/write handle for the selection document. */
export interface SelectionStore {
  /** Absolute path of the document. */
  path(): string
  /** Read the document; a missing or malformed file yields the empty selection. */
  load(): Promise<SelectionDocument>
  /** Replace the selection atomically (temp file + rename). */
  save(enabled: string[]): Promise<void>
}

/** Document version this implementation reads and writes. */
const SELECTION_VERSION = 1

/** Logger used when the caller supplies none: selection problems stay silent by default. */
const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * The empty selection, the default for a missing or unusable document.
 * @returns a fresh all-off document.
 */
function emptySelection(): SelectionDocument {
  return { version: SELECTION_VERSION, enabled: [] }
}

/**
 * Whether a thrown file-system error reports a missing file.
 * @param error - thrown value.
 * @returns whether its `code` is `ENOENT`.
 */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * Render an unknown thrown value as a message.
 * @param error - thrown value.
 * @returns the error message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Validate a parsed selection document and canonicalize its key list.
 * @param value - parsed JSON value.
 * @returns the document, or undefined when the version or field layout is unknown.
 */
function asSelectionDocument(value: unknown): SelectionDocument | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== SELECTION_VERSION || !Array.isArray(record['enabled'])) return undefined
  const enabled: string[] = []
  for (const key of record['enabled']) {
    // Unknown entries are dropped, and repeated keys keep their first position.
    if (typeof key === 'string' && !enabled.includes(key)) enabled.push(key)
  }
  return { version: SELECTION_VERSION, enabled }
}

/**
 * Default selection path under the DSH home.
 * @param env - environment to read `DSH_HOME` from.
 * @returns `<DSH_HOME>/storages/mcpp/selection.json`, with `~/.dsh` when unset.
 */
export function selectionPathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['DSH_HOME']
  const home = configured === undefined || configured.trim() === '' ? join(homedir(), '.dsh') : configured
  return join(home, 'storages', 'mcpp', 'selection.json')
}

/**
 * Create the file-backed selection store.
 *
 * A missing file is the normal all-off state. An unreadable, non-JSON, or
 * unknown-version document is reported through `logger` and treated as all-off:
 * a damaged selection must never make the plugin fail to load.
 * @param filePath - absolute JSON path.
 * @param logger - optional warning sink; defaults to silence.
 * @returns the store handle.
 */
export function createSelectionStore(filePath: string, logger: Logger = SILENT_LOGGER): SelectionStore {
  return {
    path(): string {
      return filePath
    },

    async load(): Promise<SelectionDocument> {
      let text: string
      try {
        text = await readFile(filePath, 'utf8')
      } catch (error) {
        if (isMissingFile(error)) return emptySelection()
        logger.warn(`selection: cannot read ${filePath}: ${messageOf(error)}; using the empty selection`)
        return emptySelection()
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        logger.warn(`selection: ${filePath} is not valid JSON: ${messageOf(error)}; using the empty selection`)
        return emptySelection()
      }
      const document = asSelectionDocument(parsed)
      if (document === undefined) {
        logger.warn(`selection: ${filePath} has an unsupported shape; using the empty selection`)
        return emptySelection()
      }
      return document
    },

    async save(enabled: string[]): Promise<void> {
      const document: SelectionDocument = { version: SELECTION_VERSION, enabled: [...enabled] }
      const temporary = `${filePath}.${process.pid}.tmp`
      await mkdir(dirname(filePath), { recursive: true })
      try {
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await rename(temporary, filePath)
      } catch (error) {
        try {
          await rm(temporary, { force: true })
        } catch (cleanupError) {
          // A failed cleanup must not mask the save error the caller needs.
          void cleanupError
        }
        throw error
      }
    },
  }
}
