// De agenda-tools in het formaat van de Anthropic API, afgeleid van dezelfde definities als de MCP-server
// (zo kunnen de twee nooit uit elkaar lopen).
import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/tools.ts';

export async function listApiTools(): Promise<Anthropic.Beta.BetaTool[]> {
  const server = buildServer(async () => ({}), '0');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'chat', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
  } finally {
    await client.close();
  }
}
