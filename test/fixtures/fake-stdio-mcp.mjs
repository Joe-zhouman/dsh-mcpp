/**
 * A minimal stdio MCP server for integration tests: newline-delimited JSON on
 * stdin/stdout, the same framing FastMCP emits. Run as
 * `node test/fixtures/fake-stdio-mcp.mjs`.
 *
 * @module
 */

import { createInterface } from 'node:readline'

const TOOLS = [
  {
    name: 'document_to_pdf',
    description: 'Render a document to PDF.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, format: { type: 'string' } },
      required: ['url'],
    },
  },
]

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  const reply = (payload) => { process.stdout.write(`${JSON.stringify(payload)}\n`) }
  if (message.method === 'initialize') {
    reply({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-stdio', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    reply({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })
    return
  }
  if (message.method === 'tools/call') {
    reply({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: `stdio:${JSON.stringify(message.params)}` }] },
    })
    return
  }
  reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } })
})
