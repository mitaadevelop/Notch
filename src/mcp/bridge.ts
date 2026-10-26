// Verbinding van de MCP-server (los proces, gestart door Claude) met de draaiende Agenda-app
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { socketPathFor, tokenPathFor } from './appserver.ts';

const NOT_RUNNING = 'De Agenda-app draait niet. Start de app en probeer het opnieuw.';

// de gegevensmap van de app als Claude niets anders doorgeeft (zie AGENDA_USER_DATA in de configuratie die de app schrijft)
export function defaultUserDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Agenda');
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Agenda');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Agenda');
}

// Eén verzoek aan de app; geeft het resultaat terug of gooit een Error met een melding die Claude aan de gebruiker kan tonen.
export async function callApp(userDataDir: string, tool: string, args: unknown, timeoutMs = 35_000): Promise<unknown> {
  let token: string;
  try {
    token = (await fs.readFile(tokenPathFor(userDataDir), 'utf8')).trim();
  } catch {
    throw new Error(NOT_RUNNING);
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPathFor(userDataDir));
    let buffer = '';
    let finished = false;
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('De Agenda-app reageert niet (time-out).'))),
      timeoutMs,
    );

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, token, tool, args })}\n`));
    socket.on('error', () => finish(() => reject(new Error(NOT_RUNNING))));
    socket.on('close', () => finish(() => reject(new Error('De verbinding met de Agenda-app werd verbroken.'))));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline)) as { ok: boolean; result?: unknown; error?: string };
        finish(() => (reply.ok ? resolve(reply.result) : reject(new Error(reply.error ?? 'Onbekende fout.'))));
      } catch {
        finish(() => reject(new Error('Onleesbaar antwoord van de Agenda-app.')));
      }
    });
  });
}
