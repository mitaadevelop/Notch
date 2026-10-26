// instellingen voor Claude (mcp.json in de gegevensmap): wat Claude mag zien en doen
import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpConfig } from '../shared/types.ts';

export const DEFAULT_MCP_CONFIG: McpConfig = { allowWrite: true, shareNotes: true, shareInvitees: true };

// onbekende of kapotte inhoud valt per veld terug op de standaard
export function normalizeMcpConfig(raw: unknown): McpConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof McpConfig) => (typeof source[key] === 'boolean' ? source[key] : DEFAULT_MCP_CONFIG[key]);
  return { allowWrite: pick('allowWrite'), shareNotes: pick('shareNotes'), shareInvitees: pick('shareInvitees') };
}

const file = (dir: string) => path.join(dir, 'mcp.json');

export async function readMcpConfig(dir: string): Promise<McpConfig> {
  try {
    return normalizeMcpConfig(JSON.parse(await fs.readFile(file(dir), 'utf8')));
  } catch {
    return { ...DEFAULT_MCP_CONFIG }; // ontbreekt of kapot
  }
}

export async function writeMcpConfig(dir: string, config: McpConfig) {
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file(dir)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2));
  await fs.rename(tmp, file(dir));
}
