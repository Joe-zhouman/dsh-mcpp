/**
 * Typed failures of the gateway. Each one carries the layer that owns the
 * handling decision, so callers never string-match a message.
 */

/** A configuration document that violates the model or its cross-references. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

/**
 * An HTTP-level upstream failure. `status` is the upstream's status code so the
 * MCP layer can rotate the key pool on 401/403/429 while still reporting the
 * failure to the client.
 */
export class UpstreamHttpError extends Error {
  override readonly name = 'UpstreamHttpError'
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** A JSON-RPC error answered by the upstream server itself. */
export class UpstreamRpcError extends Error {
  override readonly name = 'UpstreamRpcError'
}

/** A downstream argument that no configured transform accepts. */
export class ParamError extends Error {
  override readonly name = 'ParamError'
}

/** A transport-level failure that is not an HTTP status (reset, EOF, timeout). */
export class UpstreamTransportError extends Error {
  override readonly name = 'UpstreamTransportError'
}
