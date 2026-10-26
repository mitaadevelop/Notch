// Zet de Agenda-server in het configuratiebestand van Claude Desktop (claude_desktop_config.json)
import os from 'node:os';
import path from 'node:path';

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function claudeDesktopConfigPath(platform: NodeJS.Platform = process.platform, home = os.homedir()) {
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json',
    );
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

// Voegt `agenda` toe aan `mcpServers` zonder iets anders aan te raken. Een bestaand, kapot bestand wordt nooit overschreven.
export function mergeClaudeConfig(existing: string | null, entry: ServerEntry): string {
  let config: Record<string, unknown> = {};
  if (existing !== null && existing.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(
        'Het bestand van Claude Desktop is geen geldige JSON; ik pas het niet aan. Herstel het eerst of voeg de server handmatig toe.',
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Het bestand van Claude Desktop heeft een onverwachte opbouw; ik pas het niet aan.');
    }
    config = parsed as Record<string, unknown>;
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  return `${JSON.stringify({ ...config, mcpServers: { ...servers, agenda: entry } }, null, 2)}\n`;
}
