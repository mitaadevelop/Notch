import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test, vi } from 'vitest';
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from '../../../src/mcp/names.ts';
import { buildServer } from '../../../src/mcp/tools.ts';

// een echte MCP-client verbonden met onze server, zoals Claude dat zou doen
async function connect(call: (tool: string, args: unknown) => Promise<unknown> = async () => ({ ok: true })) {
  const spy = vi.fn(call);
  const server = buildServer(spy, '1.2.3');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, spy, server };
}

const textOf = (result: unknown) => (result as { content: { type: string; text: string }[] }).content[0].text;

describe('welke tools Claude ziet', () => {
  test('precies de bedoelde tools, met namen die overeenkomen met wat de app toestaat', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    expect(ALL_TOOLS.length).toBe(READ_TOOLS.length + WRITE_TOOLS.length);
  });

  test('lezende tools zijn als alleen-lezen gemarkeerd, het verwijderen als destructief', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of READ_TOOLS) expect(byName[name]?.readOnlyHint).toBe(true);
    for (const name of WRITE_TOOLS) expect(byName[name]?.readOnlyHint).toBe(false);
    expect(byName.delete_event?.destructiveHint).toBe(true);
    expect(byName.create_events?.destructiveHint).toBe(false);
  });

  test('elke tool heeft een beschrijving en een schema', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('de server legt uit hoe Claude de agenda moet gebruiken', async () => {
    const { client } = await connect();
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('get_context');
    expect(instructions).toContain('read_only');
    expect(instructions).toContain('ask the user first');
    expect(client.getServerVersion()).toMatchObject({ name: 'agenda', version: '1.2.3' });
  });
});

describe('aanroepen', () => {
  test('geldige argumenten gaan ongewijzigd naar de app, het antwoord komt als tekst terug', async () => {
    const { client, spy } = await connect(async () => ({ count: 2, events: [{ title: 'Tandarts' }] }));
    const result = await client.callTool({ name: 'list_events', arguments: { from: '2026-10-26', to: '2026-11-01' } });
    expect(spy).toHaveBeenCalledWith('list_events', { from: '2026-10-26', to: '2026-11-01' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ count: 2, events: [{ title: 'Tandarts' }] });
  });

  test('een fout van de app wordt een leesbare toolfout in plaats van een protocolfout', async () => {
    const { client } = await connect(async () =>
      Promise.reject(new Error('De Agenda-app draait niet. Start de app en probeer het opnieuw.')),
    );
    const result = await client.callTool({ name: 'get_context', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('De Agenda-app draait niet. Start de app en probeer het opnieuw.');
  });

  test.each([
    ['list_events', { from: '26-10-2026', to: '2026-11-01' }],
    ['list_events', { from: '2026-10-26' }],
    ['find_free_time', { from: '2026-10-26', to: '2026-10-27', duration_minutes: 2 }],
    ['create_events', { events: [] }],
    ['create_events', { events: [{ title: '', date: '2026-10-26' }] }],
    ['create_events', { events: [{ title: 'X', date: '2026-10-26', start_time: '25:00' }] }],
    ['create_events', { events: [{ title: 'X', date: '2026-10-26', repeat: { frequency: 'sometimes' } }] }],
    ['update_event', { id: '' }],
    ['update_event', { id: 'x', scope: 'everything' }],
    ['delete_event', { id: 'x', occurrence_date: 'morgen' }],
    ['search_events', { query: '' }],
  ])('ongeldige invoer wordt al bij Claude afgewezen en komt de app niet binnen: %s %j', async (name, args) => {
    const { client, spy } = await connect();
    let outcome: { isError?: boolean } | 'protocol-error';
    try {
      outcome = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
    } catch {
      outcome = 'protocol-error';
    }
    expect(outcome === 'protocol-error' || outcome.isError === true).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  test('een geldige samengestelde afspraak komt volledig door', async () => {
    const { client, spy } = await connect();
    const event = {
      title: 'Yoga',
      date: '2026-10-26',
      start_time: '19:00',
      end_time: '20:00',
      calendar: 'Privé',
      location: 'Studio',
      invitees: ['Sam'],
      repeat: { frequency: 'weekly', interval: 2, until: '2026-12-31', weekdays: [1, 4] },
      alert_minutes_before: 15,
    };
    await client.callTool({ name: 'create_events', arguments: { events: [event] } });
    expect(spy).toHaveBeenCalledWith('create_events', { events: [event] });
  });

  test('update_event laat repeat: null toe (stoppen met herhalen)', async () => {
    const { client, spy } = await connect();
    await client.callTool({ name: 'update_event', arguments: { id: 'a', repeat: null } });
    expect(spy).toHaveBeenCalledWith('update_event', { id: 'a', repeat: null });
  });

  test('een tool die iets niet-serialiseerbaars teruggeeft wordt niet fataal', async () => {
    const { client } = await connect(async () => ({ when: new Date('2026-10-26T10:00:00Z') }));
    const result = await client.callTool({ name: 'get_context', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('2026-10-26');
  });
});
