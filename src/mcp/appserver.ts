// De deur waar Claude's MCP-server (een apart proces) bij de draaiende app aanklopt: een socket die alleen de
// gebruiker zelf kan openen, plus een geheim dat bij elke app-start vernieuwd wordt. Verzoeken zijn één JSON per regel.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { McpConfig } from '../shared/types.ts';
import { ALL_TOOLS, isWriteTool } from './names.ts';

const MAX_LINE = 1024 * 1024;
const MAX_UNIX_PATH = 100; // sockets op macOS/Linux mogen niet veel langer (sun_path)

export const tokenPathFor = (userDataDir: string) => path.join(userDataDir, 'mcp-token');

// Vast pad per gegevensmap, zodat de app en de MCP-server elkaar zonder afspraken vinden.
export function socketPathFor(userDataDir: string) {
  const hash = createHash('sha256').update(userDataDir).digest('hex').slice(0, 10);
  if (process.platform === 'win32') return `\\\\.\\pipe\\agenda-mcp-${hash}`;
  const preferred = path.join(userDataDir, 'agenda-mcp.sock');
  return preferred.length <= MAX_UNIX_PATH ? preferred : path.join(os.tmpdir(), `agenda-mcp-${hash}.sock`);
}

// Haalt notities en genodigden uit een antwoord als de gebruiker die niet wil delen. Gebeurt hier, in de app,
// zodat het niet afhangt van wat de tools zelf teruggeven.
export function redact(value: unknown, config: McpConfig): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, config));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'notes' && !config.shareNotes) continue;
      if (key === 'invitees' && !config.shareInvitees) continue;
      out[key] = redact(inner, config);
    }
    return out;
  }
  return value;
}

export interface AppServerOptions {
  userDataDir: string;
  getConfig: () => McpConfig | Promise<McpConfig>;
  /** voert de tool uit (in de pagina) en geeft het resultaat; gooit een Error met een leesbare melding */
  call: (tool: string, args: unknown) => Promise<unknown>;
  timeoutMs?: number;
  onActivity?: (tool: string) => void;
}

type Reply = { id: unknown; ok: true; result: unknown } | { id: unknown; ok: false; error: string };

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

export interface RunOptions {
  getConfig: () => McpConfig | Promise<McpConfig>;
  call: (tool: string, args: unknown) => Promise<unknown>;
  timeoutMs?: number;
  onActivity?: (tool: string) => void;
}

// Voert één tool uit met alle controles die voor Claude gelden: bekende tool, wijzigen toegestaan, time-out en het
// weglaten van notities/genodigden. De MCP-socket en de chat in de app gebruiken dezelfde regels.
export async function runChecked(tool: unknown, args: unknown, options: RunOptions): Promise<ToolOutcome> {
  if (typeof tool !== 'string' || !ALL_TOOLS.includes(tool))
    return { ok: false, error: `Onbekende tool: ${String(tool)}.` };
  const config = await options.getConfig();
  if (isWriteTool(tool) && !config.allowWrite) {
    return {
      ok: false,
      error:
        'Wijzigen staat uit: de gebruiker heeft in de voorkeuren van de Agenda-app ingesteld dat Claude alleen mag lezen.',
    };
  }
  options.onActivity?.(tool);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      options.call(tool, args ?? {}),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('De Agenda-app reageert niet (time-out).')),
          options.timeoutMs ?? 30_000,
        );
      }),
    ]);
    return { ok: true, result: redact(result, config) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function startAppServer(options: AppServerOptions) {
  const { userDataDir, call } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const socketPath = socketPathFor(userDataDir);
  const token = randomBytes(32).toString('hex');
  const tokenBuffer = Buffer.from(token);
  const sockets = new Set<net.Socket>();

  const authorized = (given: unknown) => {
    if (typeof given !== 'string') return false;
    const buffer = Buffer.from(given);
    return buffer.length === tokenBuffer.length && timingSafeEqual(buffer, tokenBuffer);
  };

  async function handle(line: string): Promise<Reply> {
    let request: { id?: unknown; token?: unknown; tool?: unknown; args?: unknown };
    try {
      request = JSON.parse(line) as typeof request;
    } catch {
      return { id: null, ok: false, error: 'Ongeldig verzoek.' };
    }
    const id = request.id ?? null;
    if (!authorized(request.token))
      return { id, ok: false, error: 'Geen toegang: ongeldig geheim. Start de MCP-server opnieuw.' };
    const outcome = await runChecked(request.tool, request.args, {
      getConfig: options.getConfig,
      call,
      timeoutMs,
      onActivity: options.onActivity,
    });
    return { id, ...outcome };
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        void handle(line).then((reply) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`);
        });
      }
    });
  });

  await fs.mkdir(userDataDir, { recursive: true });
  // een achtergebleven socket van een eerdere (gecrashte) start opruimen; de pipe op Windows verdwijnt vanzelf
  if (process.platform !== 'win32') await fs.rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  if (process.platform !== 'win32') await fs.chmod(socketPath, 0o600);
  await fs.writeFile(tokenPathFor(userDataDir), token, { mode: 0o600 });

  return {
    socketPath,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') await fs.rm(socketPath, { force: true });
      await fs.rm(tokenPathFor(userDataDir), { force: true });
    },
  };
}
