import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { redact, socketPathFor, startAppServer, tokenPathFor } from '../../../src/mcp/appserver.ts';
import type { McpConfig } from '../../../src/shared/types.ts';

let dir: string;
let closers: (() => Promise<void>)[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agenda-mcp-'));
});
afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
  closers = [];
  rmSync(dir, { recursive: true, force: true });
});

const ALL: McpConfig = { allowWrite: true, shareNotes: true, shareInvitees: true };

async function start(
  options: { config?: McpConfig; call?: (tool: string, args: unknown) => Promise<unknown>; timeoutMs?: number } = {},
) {
  const call = options.call ?? vi.fn().mockResolvedValue({ ok: 1 });
  const config = { value: options.config ?? ALL };
  const server = await startAppServer({
    userDataDir: dir,
    getConfig: () => config.value,
    call,
    timeoutMs: options.timeoutMs,
  });
  closers.push(server.close);
  const token = readFileSync(tokenPathFor(dir), 'utf8');
  // stuurt regels en geeft de eerste n antwoorden terug
  const talk = (lines: string[], replies = lines.length) =>
    new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const socket = net.connect(server.socketPath);
      const got: Record<string, unknown>[] = [];
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(lines.join('\n') + '\n'));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n')) !== -1) {
          got.push(JSON.parse(buffer.slice(0, at)));
          buffer = buffer.slice(at + 1);
          if (got.length === replies) {
            socket.destroy();
            resolve(got);
          }
        }
      });
      socket.on('error', reject);
      socket.on('close', () => got.length < replies && resolve(got));
    });
  const ask = async (tool: string, args: unknown = {}, withToken = token) =>
    (await talk([JSON.stringify({ id: 1, token: withToken, tool, args })]))[0];
  return { server, call, config, token, talk, ask };
}

describe('bereikbaarheid en beveiliging', () => {
  test('maakt een socket die alleen de gebruiker kan openen, en een geheim dat ook alleen hij kan lezen', async () => {
    const { server } = await start();
    if (process.platform !== 'win32') {
      expect(statSync(server.socketPath).mode & 0o777).toBe(0o600);
      expect(statSync(tokenPathFor(dir)).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(tokenPathFor(dir), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('het geheim wisselt bij elke start', async () => {
    const first = await start();
    const a = first.token;
    await first.server.close();
    closers = [];
    const second = await start();
    expect(second.token).not.toBe(a);
  });

  test('zonder of met een fout geheim gebeurt er niets', async () => {
    const { ask, call } = await start();
    expect(await ask('get_context', {}, 'fout')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Geen toegang'),
    });
    expect(await ask('get_context', {}, '')).toMatchObject({ ok: false });
    expect(call).not.toHaveBeenCalled();
  });

  test('een geheim van een andere lengte of type wordt netjes geweigerd', async () => {
    const { talk, call } = await start();
    const [reply] = await talk([JSON.stringify({ id: 1, token: 12345, tool: 'get_context' })]);
    expect(reply).toMatchObject({ ok: false });
    expect(call).not.toHaveBeenCalled();
  });

  test('onbekende tools worden geweigerd, ook als ze op een echte lijken', async () => {
    const { ask, call } = await start();
    for (const tool of ['rm_rf', 'get_context ', 'GET_CONTEXT', '__proto__', 'constructor']) {
      expect(await ask(tool)).toMatchObject({ ok: false, error: expect.stringContaining('Onbekende tool') });
    }
    expect(call).not.toHaveBeenCalled();
  });

  test('onleesbare of onvolledige regels geven een foutmelding en leggen de server niet plat', async () => {
    const { talk, ask } = await start();
    const replies = await talk(['dit is geen json', '{}', JSON.stringify({ id: 5 })]);
    expect(replies.map((r) => r.ok)).toEqual([false, false, false]);
    expect(await ask('get_context')).toMatchObject({ ok: true });
  });

  test('een te grote regel verbreekt de verbinding', async () => {
    const { server } = await start();
    const closed = await new Promise<boolean>((resolve) => {
      const socket = net.connect(server.socketPath);
      socket.on('connect', () => socket.write('x'.repeat(2 * 1024 * 1024)));
      socket.on('close', () => resolve(true));
      socket.on('error', () => resolve(true));
    });
    expect(closed).toBe(true);
  });

  test('afsluiten ruimt socket en geheim op', async () => {
    const { server } = await start();
    await server.close();
    closers = [];
    if (process.platform !== 'win32') expect(existsSync(server.socketPath)).toBe(false);
    expect(existsSync(tokenPathFor(dir))).toBe(false);
  });

  test('een achtergebleven socket van een eerdere start staat een nieuwe start niet in de weg', async () => {
    const first = await start();
    // de eerste server "crasht": socketbestand blijft liggen
    await first.server.close();
    closers = [];
    const second = await start();
    expect(await second.ask('get_context')).toMatchObject({ ok: true });
  });
});

describe('uitvoeren', () => {
  test('geeft het resultaat van de tool terug, en meerdere verzoeken over één verbinding', async () => {
    const call = vi.fn(async (tool: string) => ({ tool }));
    const { talk, token } = await start({ call });
    const replies = await talk([
      JSON.stringify({ id: 1, token, tool: 'get_context' }),
      JSON.stringify({ id: 2, token, tool: 'list_events', args: { from: 'a' } }),
    ]);
    expect(replies).toEqual([
      { id: 1, ok: true, result: { tool: 'get_context' } },
      { id: 2, ok: true, result: { tool: 'list_events' } },
    ]);
    expect(call).toHaveBeenCalledWith('list_events', { from: 'a' });
  });

  test('een fout van de tool komt als melding terug, zonder de server te raken', async () => {
    const { ask } = await start({ call: async () => Promise.reject(new Error('Geen afspraak gevonden.')) });
    expect(await ask('get_event')).toEqual({ id: 1, ok: false, error: 'Geen afspraak gevonden.' });
    expect(await ask('get_event')).toMatchObject({ ok: false });
  });

  test('een tool die niet antwoordt geeft een time-out', async () => {
    const { ask } = await start({ call: () => new Promise(() => {}), timeoutMs: 80 });
    expect(await ask('get_context')).toMatchObject({ ok: false, error: expect.stringContaining('time-out') });
  });

  test('ontbrekende argumenten worden als leeg object doorgegeven', async () => {
    const { ask, call } = await start();
    await ask('get_context', undefined);
    expect(call).toHaveBeenCalledWith('get_context', {});
  });
});

describe('wat Claude mag', () => {
  test.each(['create_events', 'update_event', 'delete_event'])(
    'met "alleen lezen" wordt %s geweigerd zonder de pagina te raken',
    async (tool) => {
      const { ask, call } = await start({ config: { ...ALL, allowWrite: false } });
      expect(await ask(tool, { id: 'x' })).toMatchObject({
        ok: false,
        error: expect.stringContaining('alleen mag lezen'),
      });
      expect(call).not.toHaveBeenCalled();
    },
  );

  test('lezen blijft werken als wijzigen uit staat', async () => {
    const { ask } = await start({ config: { ...ALL, allowWrite: false } });
    for (const tool of ['get_context', 'list_events', 'search_events', 'get_event', 'find_free_time']) {
      expect(await ask(tool)).toMatchObject({ ok: true });
    }
  });

  test('een wijziging van de instellingen geldt meteen, zonder herstart', async () => {
    const { ask, config } = await start();
    expect(await ask('delete_event', { id: 'x' })).toMatchObject({ ok: true });
    config.value = { ...ALL, allowWrite: false };
    expect(await ask('delete_event', { id: 'x' })).toMatchObject({ ok: false });
  });

  test('notities en genodigden worden uit antwoorden gehaald als de gebruiker die niet deelt, ook diep verstopt', async () => {
    const event = { title: 'Tandarts', notes: 'geheim', invitees: ['Sam'], nested: { notes: 'ook geheim', keep: 1 } };
    const { ask } = await start({
      config: { ...ALL, shareNotes: false, shareInvitees: false },
      call: async () => ({ events: [event], notes: 'top' }),
    });
    const reply = await ask('list_events');
    expect(JSON.stringify(reply)).not.toContain('geheim');
    expect(JSON.stringify(reply)).not.toContain('Sam');
    expect(reply).toMatchObject({ result: { events: [{ title: 'Tandarts', nested: { keep: 1 } }] } });
  });
});

describe('redact', () => {
  const sample = { notes: 'n', invitees: ['i'], title: 't', list: [{ notes: 'x' }] };
  test.each([
    [{ ...ALL }, { notes: 'n', invitees: ['i'], title: 't', list: [{ notes: 'x' }] }],
    [
      { ...ALL, shareNotes: false },
      { invitees: ['i'], title: 't', list: [{}] },
    ],
    [
      { ...ALL, shareInvitees: false },
      { notes: 'n', title: 't', list: [{ notes: 'x' }] },
    ],
  ])('%j', (config, expected) => {
    expect(redact(sample, config)).toEqual(expected);
  });

  test('gewone waarden en null blijven ongemoeid', () => {
    expect(redact(null, ALL)).toBeNull();
    expect(redact('tekst', { ...ALL, shareNotes: false })).toBe('tekst');
    expect(redact(5, ALL)).toBe(5);
  });
});

describe('socketPathFor', () => {
  test('hetzelfde pad voor dezelfde map en een kort pad in de gegevensmap', () => {
    expect(socketPathFor('/a/b')).toBe(socketPathFor('/a/b'));
    if (process.platform !== 'win32') expect(socketPathFor('/a/b')).toBe('/a/b/agenda-mcp.sock');
  });

  test('een te lang pad valt terug op een korte plek met een vaste naam per map', () => {
    const long = `/${'x'.repeat(120)}`;
    const p = socketPathFor(long);
    if (process.platform !== 'win32') {
      expect(p.length).toBeLessThanOrEqual(104);
      expect(p.startsWith(tmpdir())).toBe(true);
    }
    expect(socketPathFor(long)).toBe(p);
    expect(socketPathFor(`${long}2`)).not.toBe(p);
  });
});

describe('runChecked (gedeeld met de chat in de app)', () => {
  const run = async (
    tool: unknown,
    args: unknown,
    config: McpConfig,
    call = vi.fn().mockResolvedValue({ notes: 'n', ok: 1 }),
  ) => {
    const { runChecked } = await import('../../../src/mcp/appserver.ts');
    return { outcome: await runChecked(tool, args, { getConfig: () => config, call, timeoutMs: 80 }), call };
  };

  test('voert een bekende tool uit en laat notities weg als die niet gedeeld worden', async () => {
    const { outcome, call } = await run('get_event', { id: 'x' }, { ...ALL, shareNotes: false });
    expect(outcome).toEqual({ ok: true, result: { ok: 1 } });
    expect(call).toHaveBeenCalledWith('get_event', { id: 'x' });
  });

  test('onbekende tools en wijzigen-bij-alleen-lezen komen de pagina niet binnen', async () => {
    const a = await run('rm_rf', {}, ALL);
    expect(a.outcome).toMatchObject({ ok: false, error: expect.stringContaining('Onbekende tool') });
    const b = await run('delete_event', { id: 'x' }, { ...ALL, allowWrite: false });
    expect(b.outcome).toMatchObject({ ok: false, error: expect.stringContaining('alleen mag lezen') });
    const c = await run(5, {}, ALL);
    expect(c.outcome.ok).toBe(false);
    expect(a.call).not.toHaveBeenCalled();
    expect(b.call).not.toHaveBeenCalled();
    expect(c.call).not.toHaveBeenCalled();
  });

  test('een tool die niet antwoordt geeft een time-out, een fout wordt een melding', async () => {
    expect(
      (
        await run(
          'get_context',
          {},
          ALL,
          vi.fn(() => new Promise(() => {})),
        )
      ).outcome,
    ).toMatchObject({ ok: false, error: expect.stringContaining('time-out') });
    expect((await run('get_context', {}, ALL, vi.fn().mockRejectedValue(new Error('kapot')))).outcome).toEqual({
      ok: false,
      error: 'kapot',
    });
  });
});
