// Startpunt van de MCP-server die Claude (Desktop of Code) als apart proces start. Praat met Claude via stdin/stdout
// (daarom gaat alle logging naar stderr) en met de draaiende Agenda-app via een lokale socket.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { callApp, defaultUserDataDir } from './mcp/bridge.ts';
import { buildServer } from './mcp/tools.ts';

async function main() {
  const dir = process.env.AGENDA_USER_DATA || defaultUserDataDir();
  let version = '0.0.0';
  try {
    version = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string })
      .version;
  } catch {
    // zonder versie werkt de server gewoon
  }
  const server = buildServer((tool, args) => callApp(dir, tool, args), version);
  await server.connect(new StdioServerTransport());
  console.error(`Agenda MCP-server gestart (gegevens: ${dir})`);
}

main().catch((error) => {
  console.error('Agenda MCP-server kon niet starten:', error);
  process.exit(1);
});
