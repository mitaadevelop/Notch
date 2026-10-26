import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { callApp } from '../../../src/mcp/bridge.ts';
import { createMcpHost } from '../../../src/mcp/host.ts';
import type { McpCall } from '../../../src/shared/types.ts';

let dir: string;
let stops: (() => Promise<void>)[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agenda-host-'));
});
afterEach(async () => {
  await Promise.all(stops.map((stop) => stop()));
  stops = [];
  rmSync(dir, { recursive: true, force: true });
});

// een nep-venster dat verzoeken van de host onthoudt; de test speelt zelf de pagina
function fakeWindow() {
  const calls: McpCall[] = [];
  const window = {
    webContents: { send: vi.fn((_channel: string, call: McpCall) => calls.push(call)) },
  } as unknown as BrowserWindow;
  return { window, calls };
}

async function setup(over: { window?: BrowserWindow | null; claudeConfigPath?: string } = {}) {
  const page = fakeWindow();
  let current: BrowserWindow | null = over.window === undefined ? page.window : over.window;
  const openWindow = vi.fn(() => {
    current = page.window;
    host.windowCreated();
    return page.window;
  });
  const host = createMcpHost({
    userDataDir: dir,
    command: '/app/Agenda',
    scriptPath: '/app/dist/mcp.js',
    getWindow: () => current,
    openWindow,
    claudeConfigPath: over.claudeConfigPath ?? path.join(dir, 'claude', 'claude_desktop_config.json'),
  });
  await host.start();
  stops.push(() => host.stop());
  return { host, page, openWindow, closeWindow: () => (current = null) };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

describe('verzoeken doorsturen naar de pagina', () => {
  test('van Claude via de socket naar de pagina en weer terug', async () => {
    const { host, page } = await setup();
    host.markReady();
    const request = callApp(dir, 'list_events', { from: '2026-10-26', to: '2026-10-27' });
    await waitFor(() => page.calls.length === 1);
    expect(page.calls[0]).toMatchObject({ tool: 'list_events', args: { from: '2026-10-26', to: '2026-10-27' } });
    host.reply(page.calls[0].id, { ok: true, result: { count: 0, events: [] } });
    expect(await request).toEqual({ count: 0, events: [] });
  });

  test('een fout van de pagina komt bij Claude aan als melding', async () => {
    const { host, page } = await setup();
    host.markReady();
    const request = callApp(dir, 'get_event', { id: 'x' });
    await waitFor(() => page.calls.length === 1);
    host.reply(page.calls[0].id, { ok: false, error: 'Geen afspraak gevonden met id "x".' });
    await expect(request).rejects.toThrow('Geen afspraak gevonden met id "x".');
  });

  test('gelijktijdige verzoeken krijgen elk hun eigen antwoord', async () => {
    const { host, page } = await setup();
    host.markReady();
    const a = callApp(dir, 'get_context', { n: 'a' });
    const b = callApp(dir, 'get_context', { n: 'b' });
    await waitFor(() => page.calls.length === 2);
    // antwoorden in omgekeerde volgorde
    for (const call of [...page.calls].reverse())
      host.reply(call.id, { ok: true, result: (call.args as { n: string }).n });
    expect([await a, await b]).toEqual(['a', 'b']);
  });

  test('wacht tot de pagina klaar is met laden voordat hij iets stuurt', async () => {
    const { host, page } = await setup();
    host.windowCreated(); // het venster is net nieuw
    const request = callApp(dir, 'get_context', {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(page.calls).toHaveLength(0);
    host.markReady();
    await waitFor(() => page.calls.length === 1);
    host.reply(page.calls[0].id, { ok: true, result: 'klaar' });
    expect(await request).toBe('klaar');
  });

  test('is het venster gesloten, dan wordt het geopend en gewacht', async () => {
    const { host, page, openWindow } = await setup({ window: null });
    const request = callApp(dir, 'get_context', {});
    await waitFor(() => openWindow.mock.calls.length === 1);
    host.markReady();
    await waitFor(() => page.calls.length === 1);
    host.reply(page.calls[0].id, { ok: true, result: 'open' });
    expect(await request).toBe('open');
  });

  test('sluit het venster tijdens een verzoek, dan krijgt Claude een melding in plaats van eindeloos te wachten', async () => {
    const { host, page } = await setup();
    host.markReady();
    const request = callApp(dir, 'get_context', {});
    await waitFor(() => page.calls.length === 1);
    host.windowClosed();
    await expect(request).rejects.toThrow('venster is gesloten');
  });

  test('een antwoord op een onbekend of al afgehandeld verzoek wordt genegeerd', async () => {
    const { host } = await setup();
    expect(() => host.reply(999, { ok: true, result: 1 })).not.toThrow();
  });

  test('afsluiten maakt de socket dicht; daarna draait de app "niet" voor Claude', async () => {
    const { host } = await setup();
    await host.stop();
    stops = [];
    await expect(callApp(dir, 'get_context', {})).rejects.toThrow('draait niet');
  });
});

describe('instellingen', () => {
  test('beginnen met alles aan en worden bewaard (ook na een herstart)', async () => {
    const { host } = await setup();
    expect((await host.status()).config).toEqual({ allowWrite: true, shareNotes: true, shareInvitees: true });
    await host.setConfig({ allowWrite: false, shareNotes: false });
    expect(JSON.parse(readFileSync(path.join(dir, 'mcp.json'), 'utf8'))).toEqual({
      allowWrite: false,
      shareNotes: false,
      shareInvitees: true,
    });

    const again = await setup();
    expect((await again.host.status()).config).toEqual({ allowWrite: false, shareNotes: false, shareInvitees: true });
  });

  test('onzin in de patch wordt genegeerd', async () => {
    const { host } = await setup();
    const status = await host.setConfig({ allowWrite: 'ja', extra: 1 } as never);
    expect(status.config).toEqual({ allowWrite: true, shareNotes: true, shareInvitees: true });
  });

  test('een kapot mcp.json valt terug op de standaard', async () => {
    writeFileSync(path.join(dir, 'mcp.json'), '{ kapot');
    const { host } = await setup();
    expect((await host.status()).config.allowWrite).toBe(true);
  });

  test('een instelling geldt meteen voor lopende verzoeken (alleen lezen)', async () => {
    const { host, page } = await setup();
    host.markReady();
    await host.setConfig({ allowWrite: false });
    await expect(callApp(dir, 'delete_event', { id: 'x' })).rejects.toThrow('alleen mag lezen');
    expect(page.calls).toHaveLength(0);
  });

  test('de status vertelt hoe Claude de server start', async () => {
    const { host } = await setup();
    expect(await host.status()).toMatchObject({
      running: true,
      command: '/app/Agenda',
      args: ['/app/dist/mcp.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: dir },
    });
  });
});

describe('toevoegen aan Claude Desktop', () => {
  test('schrijft de server in het configuratiebestand en maakt een nieuwe map aan indien nodig', async () => {
    const file = path.join(dir, 'claude', 'claude_desktop_config.json');
    const { host } = await setup({ claudeConfigPath: file });
    expect(await host.installForClaude()).toEqual({ installed: true, path: file });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.mcpServers.agenda).toEqual({
      command: '/app/Agenda',
      args: ['/app/dist/mcp.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: dir },
    });
    expect(existsSync(`${file}.agenda-backup`)).toBe(false); // er was niets om te bewaren
  });

  test('een bestaand bestand blijft behouden en er komt een kopie', async () => {
    const file = path.join(dir, 'config.json');
    const original = JSON.stringify({ mcpServers: { andere: { command: 'x' } }, theme: 'dark' });
    writeFileSync(file, original);
    const { host } = await setup({ claudeConfigPath: file });
    await host.installForClaude();
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.mcpServers.andere).toEqual({ command: 'x' });
    expect(written.theme).toBe('dark');
    expect(readFileSync(`${file}.agenda-backup`, 'utf8')).toBe(original);
  });

  test('een kapot bestand wordt niet aangeraakt en de gebruiker krijgt de reden', async () => {
    const file = path.join(dir, 'config.json');
    writeFileSync(file, '{ kapot');
    const { host } = await setup({ claudeConfigPath: file });
    await expect(host.installForClaude()).rejects.toThrow('geen geldige JSON');
    expect(readFileSync(file, 'utf8')).toBe('{ kapot');
    expect(existsSync(`${file}.agenda-backup`)).toBe(false);
  });

  test('een map die niet bestaat wordt aangemaakt (Claude Desktop nog nooit gestart)', async () => {
    const file = path.join(dir, 'nieuw', 'diep', 'config.json');
    mkdirSync(dir, { recursive: true });
    const { host } = await setup({ claudeConfigPath: file });
    await host.installForClaude();
    expect(existsSync(file)).toBe(true);
  });
});
