/**
 * Minimal local typing for the DSH host services this plugin consumes.
 *
 * The plugin runs out-of-tree: it cannot import `@deepseek-ai/cordis` or the
 * DSH tool-registry packages (the profile only provides
 * `@deepseek-ai/schemastery`). These interfaces mirror the published contracts
 * of the services reached through `ctx.get(...)` / `ctx.provide(...)`, so every
 * call site stays type-checked without a runtime dependency.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Leveled logger face (`ctx.logger`). */
export interface DshLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Execution identity handed to a registered tool body. */
export interface DshToolRunContext {
  /** Cancellation of the owning tool call. */
  readonly signal: AbortSignal
}

/** Canonical output declaration a DSH tool must provide. */
export interface DshToolOutputLike {
  /** Raw supported JSON Schema enforced against every successful value. */
  schema: unknown
  /** Pure projection from validated value to model-visible content blocks. */
  render(args: unknown, value: unknown): unknown[]
}

/** One DSH tool registration (`ctx.tools.register`). */
export interface DshToolDefinitionLike {
  name: string
  description: string
  parameters: unknown
  output: DshToolOutputLike
  execute(args: unknown, exec: DshToolRunContext): Promise<unknown>
  timeoutMs?: number
}

/** The slice of the DSH tool registry this plugin registers into. */
export interface DshToolsService {
  register(definition: DshToolDefinitionLike): () => void
}

/** A node:http route handler owning its full response lifecycle. */
export type DshRouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** The host web server service (`ctx.get('webServer')`). */
export interface DshWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: DshRouteHandler }): () => void
}

/** The connection service's browser-request fence (`ctx.get('connection')`). */
export interface DshConnectionService {
  /**
   * Return the rejection for a request that fails the loopback / trusted-host /
   * Origin policy: the HTTP status (the real service answers 401 or 403), a
   * diagnostic string, or undefined when the request may proceed.
   */
  requestRejection(req: IncomingMessage): 401 | 403 | undefined
}

/**
 * The Cordis context face used by the host half. `get` reads an optional
 * service; `inject` runs a callback once the named services are available;
 * `provide` publishes a service to every later consumer.
 */
export interface DshPluginContext {
  logger: DshLogger
  /** Register a lifecycle effect; the callback returns its disposer. */
  effect(execute: () => Promise<() => Promise<void>>, label: string): Promise<unknown>
  /**
   * Optional service lookup; `undefined` when the service is not mounted.
   * `strict` (default true) hides services whose providing fiber is not active
   * yet, which is why activation-time lookups of late rows need `false`.
   */
  get<T>(name: string, strict?: boolean): T | undefined
  /**
   * Run `callback` with a scoped context once every named service is available.
   * The callback never runs for a service that is not mounted at all.
   */
  inject(services: readonly string[], callback: (scope: DshPluginContext) => void): void
  /** Publish a service other plugins can inject; the returned disposer retires it. */
  provide(name: string, value: unknown): () => void
}
