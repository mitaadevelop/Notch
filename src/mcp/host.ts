// Hoort bij het hoofdproces: houdt de instellingen voor Claude bij, start de socket en stuurt verzoeken van de
// MCP-server door naar de pagina van de app (waar de agenda leeft) en het antwoord terug.
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpCall, McpConfig, McpStatus } from '../shared/types.ts';
import { runChecked, startAppServer } from './appserver.ts';
import { claudeDesktopConfigPath, mergeClaudeConfig } from './claude-config.ts';
import type { ServerEntry } from './claude-config.ts';
import { normalizeMcpConfig, readMcpConfig, writeMcpConfig } from './config.ts';

const READY_TIMEOUT_MS = 15_000;

export interface HostOptions {
  userDataDir: string;
  /** het script dat Claude start (dist/mcp.js) en het programma dat het uitvoert */
  command: string;
  scriptPath: string;
  getWindow: () => BrowserWindow | null;
  /** opent het venster als het gesloten is (macOS laat de app dan draaien) */
  openWindow: () => BrowserWindow;
  claudeConfigPath?: string;
  onActivity?: (tool: string) => void;
}

export function createMcpHost(options: HostOptions) {
  const { userDataDir } = options;
  let config: McpConfig | null = null;
  let server: Awaited<ReturnType<typeof startAppServer>> | null = null;

  // --- de pagina klaar? ---
  let resolveReady: () => void = () => {};
  let ready = new Promise<void>((resolve) => (resolveReady = resolve));
  let isReady = false;

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;

  function failPending(message: string) {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  }

  async function forward(tool: string, args: unknown): Promise<unknown> {
    const win = options.getWindow() ?? options.openWindow();
    if (!isReady) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Het Agenda-venster is nog niet klaar. Probeer het zo opnieuw.')),
            READY_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const call: McpCall = { id, tool, args };
      win.webContents.send('mcp:call', call);
      // een antwoord dat nooit komt mag niet eeuwig blijven hangen
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('De Agenda-app reageert niet (time-out).'));
      }, 60_000).unref();
    });
  }

  const getConfig = async () => (config ??= await readMcpConfig(userDataDir));

  const entry = (): ServerEntry => ({
    command: options.command,
    args: [options.scriptPath],
    // ELECTRON_RUN_AS_NODE: de app zelf draait het script als gewone Node, dus Claude heeft geen aparte Node nodig
    env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: userDataDir },
  });

  const claudePath = () => options.claudeConfigPath ?? claudeDesktopConfigPath();

  return {
    /** Voert een tool uit zoals Claude (MCP) dat zou doen, met dezelfde controles; voor de chat in de app. */
    run: (tool: string, args: unknown) => runChecked(tool, args, { getConfig, call: forward, timeoutMs: 60_000 }),

    async start() {
      server = await startAppServer({ userDataDir, getConfig, call: forward, onActivity: options.onActivity });
      return server.socketPath;
    },
    async stop() {
      failPending('De Agenda-app wordt afgesloten.');
      await server?.close();
      server = null;
    },

    // het venster is (opnieuw) gemaakt of gesloten: de pagina moet weer "klaar" melden
    windowCreated() {
      isReady = false;
      ready = new Promise<void>((resolve) => (resolveReady = resolve));
    },
    windowClosed() {
      isReady = false;
      failPending('Het Agenda-venster is gesloten.');
    },
    markReady() {
      isReady = true;
      resolveReady();
    },
    reply(id: number, reply: { ok: true; result: unknown } | { ok: false; error: string }) {
      const waiting = pending.get(id);
      if (!waiting) return;
      pending.delete(id);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
    },

    async status(): Promise<McpStatus> {
      const { command, args, env } = entry();
      return {
        config: await getConfig(),
        command,
        args,
        env,
        claudeDesktopConfig: claudePath(),
        running: server !== null,
      };
    },

    async setConfig(patch: Partial<McpConfig>) {
      config = normalizeMcpConfig({ ...(await getConfig()), ...patch });
      await writeMcpConfig(userDataDir, config);
      return this.status();
    },

    // Schrijft de server in het bestand van Claude Desktop; maakt eerst een kopie van een bestaand bestand.
    async installForClaude() {
      const file = claudePath();
      let existing: string | null = null;
      try {
        existing = await fs.readFile(file, 'utf8');
      } catch {
        // bestaat nog niet: dan maken we het
      }
      const merged = mergeClaudeConfig(existing, entry());
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (existing !== null) await fs.writeFile(`${file}.agenda-backup`, existing);
      await fs.writeFile(file, merged);
      return { installed: true, path: file };
    },
  };
}

export type McpHost = ReturnType<typeof createMcpHost>;
