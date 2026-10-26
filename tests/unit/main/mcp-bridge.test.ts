import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { socketPathFor, startAppServer, tokenPathFor } from '../../../src/mcp/appserver.ts';
import { callApp, defaultUserDataDir } from '../../../src/mcp/bridge.ts';

let dir: string;
let close: (() => Promise<void>) | null = null;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agenda-bridge-'));
});
afterEach(async () => {
  await close?.();
  close = null;
  rmSync(dir, { recursive: true, force: true });
});

async function app(call: (tool: string, args: unknown) => Promise<unknown>) {
  const server = await startAppServer({
    userDataDir: dir,
    getConfig: () => ({ allowWrite: true, shareNotes: true, shareInvitees: true }),
    call,
  });
  close = server.close;
}

describe('callApp', () => {
  test('stuurt de tool en de argumenten naar de app en geeft het resultaat terug', async () => {
    await app(async (tool, args) => ({ tool, args }));
    expect(await callApp(dir, 'list_events', { from: '2026-10-26' })).toEqual({
      tool: 'list_events',
      args: { from: '2026-10-26' },
    });
  });

  test('meerdere aanroepen na elkaar werken (elke keer een eigen verbinding)', async () => {
    await app(async () => 'ja');
    for (let i = 0; i < 5; i++) expect(await callApp(dir, 'get_context', {})).toBe('ja');
  });

  test('een fout van de app komt als Error met dezelfde melding', async () => {
    await app(async () => Promise.reject(new Error('Geen afspraak gevonden met id "x".')));
    await expect(callApp(dir, 'get_event', { id: 'x' })).rejects.toThrow('Geen afspraak gevonden met id "x".');
  });

  test('zonder draaiende app (geen geheim) een duidelijke melding', async () => {
    await expect(callApp(dir, 'get_context', {})).rejects.toThrow('De Agenda-app draait niet');
  });

  test('met een geheim maar zonder luisterende socket ook (de app is gecrasht)', async () => {
    writeFileSync(tokenPathFor(dir), 'oud');
    await expect(callApp(dir, 'get_context', {})).rejects.toThrow('De Agenda-app draait niet');
  });

  test('een verouderd geheim wordt door de app geweigerd', async () => {
    await app(async () => 'nee');
    writeFileSync(tokenPathFor(dir), 'verouderd');
    await expect(callApp(dir, 'get_context', {})).rejects.toThrow('Geen toegang');
  });

  test('een app die niet antwoordt geeft een time-out', async () => {
    await app(() => new Promise(() => {}));
    await expect(callApp(dir, 'get_context', {}, 150)).rejects.toThrow('time-out');
  });

  test('een verbinding die plots wegvalt geeft een melding in plaats van te blijven hangen', async () => {
    const server = net.createServer((socket) => socket.destroy()).listen(socketPathFor(dir));
    await new Promise((resolve) => server.once('listening', resolve));
    writeFileSync(tokenPathFor(dir), 'x');
    try {
      await expect(callApp(dir, 'get_context', {})).rejects.toThrow(/verbroken|draait niet/);
    } finally {
      server.close();
    }
  });

  test('onleesbare antwoorden worden netjes gemeld', async () => {
    const server = net
      .createServer((socket) => socket.on('data', () => socket.write('geen json\n')))
      .listen(socketPathFor(dir));
    await new Promise((resolve) => server.once('listening', resolve));
    writeFileSync(tokenPathFor(dir), 'x');
    try {
      await expect(callApp(dir, 'get_context', {})).rejects.toThrow('Onleesbaar antwoord');
    } finally {
      server.close();
    }
  });
});

describe('defaultUserDataDir', () => {
  test('wijst naar een map met "Agenda" in de naam, per systeem anders', () => {
    expect(path.basename(defaultUserDataDir())).toBe('Agenda');
  });
});
