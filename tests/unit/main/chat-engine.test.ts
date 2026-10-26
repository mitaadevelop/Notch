import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test, vi } from 'vitest';
import { createChat, describeError, systemPrompt, TOOL_LABELS } from '../../../src/chat/engine.ts';
import type { CreateFn } from '../../../src/chat/engine.ts';
import { listApiTools } from '../../../src/chat/tools.ts';
import type { ToolOutcome } from '../../../src/mcp/appserver.ts';
import { ALL_TOOLS } from '../../../src/mcp/names.ts';

type Msg = Awaited<ReturnType<CreateFn>>;
const msg = (content: unknown[], stop_reason: string = 'end_turn'): Msg =>
  ({
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'x',
    content,
    stop_reason,
    stop_sequence: null,
    usage: {},
  }) as unknown as Msg;
const text = (t: string) => ({ type: 'text', text: t });
const tool = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use', id, name, input });

function setup(
  responses: Msg[],
  run = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: { ok: 1 } })),
  model = 'claude-opus-5-5',
) {
  const queue = [...responses];
  const calls: Parameters<CreateFn>[0][] = [];
  const create: CreateFn = vi.fn(async (params) => {
    // een momentopname: het gesprek wordt na afloop verder aangevuld
    calls.push(structuredClone(params));
    const next = queue.shift();
    if (!next) throw new Error('geen antwoord meer');
    return next;
  });
  const chat = createChat({
    create,
    model: async () => model,
    tools: [{ name: 'get_context', description: 'x', input_schema: { type: 'object' } }],
    run,
    now: () => new Date(2026, 9, 26, 10, 0),
  });
  return { chat, create, calls, run };
}

describe('een gewone vraag', () => {
  test('stuurt model, instructies en tools mee en geeft het antwoord terug', async () => {
    const { chat, calls } = setup([msg([text('Je hebt morgen een afspraak.')])]);
    const turn = await chat.send('  Wat staat er morgen?  ');
    expect(turn).toEqual({ text: 'Je hebt morgen een afspraak.', actions: [] });
    expect(calls[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000 });
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'Wat staat er morgen?' }]);
    expect(String(calls[0].system)).toContain('Agenda app');
    expect(String(calls[0].system)).toContain('maandag 26 oktober 2026');
    expect(calls[0].tools).toHaveLength(1);
  });

  test('dwingt nooit een tool af en schakelt het denken niet uit (kan niet bij deze modellen)', async () => {
    const { chat, calls } = setup([msg([text('ok')])]);
    await chat.send('hoi');
    expect(calls[0]).not.toHaveProperty('tool_choice');
    expect(calls[0]).not.toHaveProperty('thinking');
    expect(calls[0]).not.toHaveProperty('temperature');
  });

  test('meerdere tekstblokken worden samengevoegd; een leeg antwoord krijgt een melding', async () => {
    const { chat } = setup([
      msg([text('Eerste.'), { type: 'thinking', thinking: '', signature: 's' }, text('Tweede.')]),
      msg([]),
    ]);
    expect((await chat.send('a')).text).toBe('Eerste.\nTweede.');
    expect((await chat.send('b')).text).toBe('(geen antwoord)');
  });

  test('het gesprek gaat door: eerdere berichten en antwoorden worden meegestuurd', async () => {
    const { chat, calls } = setup([msg([text('Eén')]), msg([text('Twee')])]);
    await chat.send('eerste');
    await chat.send('tweede');
    expect(calls[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(chat.length).toBe(4);
    chat.reset();
    expect(chat.length).toBe(0);
  });
});

describe('modellen en terugval', () => {
  test('Opus en Sonnet vragen de server om automatisch terug te vallen bij een weigering', async () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
      const { chat, calls } = setup([msg([text('ok')])], undefined, model);
      await chat.send('hoi');
      expect(calls[0]).toMatchObject({ model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    }
  });

  test('Haiku heeft die terugval niet en vraagt er dus niet om', async () => {
    const { chat, calls } = setup([msg([text('ok')])], undefined, 'claude-haiku-5-5');
    await chat.send('hoi');
    expect(calls[0]).not.toHaveProperty('fallbacks');
    expect(calls[0]).not.toHaveProperty('betas');
  });

  test('een weigering geeft een nette melding', async () => {
    const { chat } = setup([msg([], 'refusal')]);
    expect(await chat.send('x')).toMatchObject({ text: 'Claude wilde hier niet op ingaan.', stopped: 'refusal' });
  });

  test('een afgekapt antwoord wordt gemeld', async () => {
    const { chat } = setup([msg([text('half')], 'max_tokens')]);
    expect(await chat.send('x')).toMatchObject({ text: 'half', stopped: 'max_tokens' });
  });
});

describe('tools gebruiken', () => {
  test('voert de gevraagde tool uit en stuurt het resultaat terug, met het volledige antwoord van Claude eerst', async () => {
    const thinking = { type: 'thinking', thinking: 'plan', signature: 'handtekening' };
    const { chat, calls, run } = setup([
      msg(
        [thinking, text('Ik kijk even.'), tool('t1', 'list_events', { from: '2026-10-27', to: '2026-10-27' })],
        'tool_use',
      ),
      msg([text('Je hebt niets.')]),
    ]);
    run.mockResolvedValueOnce({ ok: true, result: { count: 0, events: [] } });
    const turn = await chat.send('Wat staat er morgen?');
    expect(run).toHaveBeenCalledWith('list_events', { from: '2026-10-27', to: '2026-10-27' });
    expect(turn.text).toBe('Je hebt niets.');
    expect(turn.actions).toEqual([{ tool: 'list_events', label: 'Afspraken opgevraagd', ok: true }]);
    const second = calls[1].messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    // denkwerk en handtekening komen ongewijzigd terug, zoals de API eist
    expect((second[1].content as unknown[])[0]).toEqual(thinking);
    expect(second[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ count: 0, events: [] }) },
    ]);
  });

  test('meerdere tools in één stap komen samen in één bericht terug', async () => {
    const { chat, calls } = setup([
      msg([tool('a', 'get_context'), tool('b', 'list_events', { from: '2026-10-26', to: '2026-10-27' })], 'tool_use'),
      msg([text('klaar')]),
    ]);
    await chat.send('x');
    const results = calls[1].messages[2].content as { tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
  });

  test('een mislukte tool wordt een fout in het resultaat die Claude kan uitleggen', async () => {
    const { chat, calls, run } = setup([
      msg([tool('t', 'delete_event', { id: 'x' })], 'tool_use'),
      msg([text('Dat lukte niet.')]),
    ]);
    run.mockResolvedValueOnce({ ok: false, error: 'Wijzigen staat uit.' } as never);
    const turn = await chat.send('verwijder');
    expect(turn.actions).toEqual([{ tool: 'delete_event', label: 'Afspraak verwijderd', ok: false }]);
    expect(calls[1].messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't', content: 'Wijzigen staat uit.', is_error: true },
    ]);
  });

  test('lange resultaten worden ingekort', async () => {
    const { chat, calls, run } = setup([msg([tool('t', 'list_events')], 'tool_use'), msg([text('ok')])]);
    run.mockResolvedValueOnce({ ok: true, result: 'x'.repeat(100_000) });
    await chat.send('x');
    const content = (calls[1].messages[2].content as { content: string }[])[0].content;
    expect(content.length).toBeLessThan(61_000);
    expect(content).toContain('ingekort');
  });

  test('na te veel stappen achter elkaar stopt het, zodat het niet eindeloos doorgaat', async () => {
    const loop = Array.from({ length: 20 }, (_, i) => msg([tool(`t${i}`, 'get_context')], 'tool_use'));
    const { chat, create } = setup(loop);
    const turn = await chat.send('x');
    expect(turn.stopped).toBe('steps');
    expect(create).toHaveBeenCalledTimes(10);
    expect(turn.actions).toHaveLength(10);
  });

  test('elk tool-label bestaat voor elke tool', () => {
    for (const name of ALL_TOOLS) expect(TOOL_LABELS[name], name).toBeTruthy();
  });
});

describe('fouten en grenzen', () => {
  test('bij een fout van de API blijft het gesprek ongewijzigd en kan de gebruiker het opnieuw proberen', async () => {
    const { chat, create } = setup([msg([text('ok')])]);
    vi.mocked(create).mockRejectedValueOnce(new Error('boem'));
    await expect(chat.send('eerste poging')).rejects.toThrow('boem');
    expect(chat.length).toBe(0);
    expect(chat.busy).toBe(false);
    expect((await chat.send('tweede poging')).text).toBe('ok');
  });

  test('een fout na een tool-stap haalt ook de halve beurt weg, zodat er geen losse tool_use achterblijft', async () => {
    const { chat, create } = setup([msg([tool('t', 'get_context')], 'tool_use')]);
    vi.mocked(create)
      .mockResolvedValueOnce(msg([tool('t', 'get_context')], 'tool_use'))
      .mockRejectedValueOnce(new Error('weg'));
    await expect(chat.send('x')).rejects.toThrow('weg');
    expect(chat.length).toBe(0);
  });

  test('een leeg of te lang bericht wordt geweigerd zonder de API aan te roepen', async () => {
    const { chat, create } = setup([]);
    await expect(chat.send('   ')).rejects.toThrow('Typ eerst');
    await expect(chat.send('x'.repeat(9000))).rejects.toThrow('te lang');
    await expect(chat.send(5 as never)).rejects.toThrow('Typ eerst');
    expect(create).not.toHaveBeenCalled();
  });

  test('twee berichten tegelijk kan niet', async () => {
    let release: (m: Msg) => void = () => {};
    const create: CreateFn = () => new Promise<Msg>((resolve) => (release = resolve));
    const chat = createChat({ create, model: async () => 'claude-opus-5-5', tools: [], run: vi.fn() });
    const first = chat.send('a');
    await Promise.resolve();
    await expect(chat.send('b')).rejects.toThrow('nog bezig');
    release(msg([text('ok')]));
    await first;
  });

  test('een heel lang gesprek vraagt om een nieuw gesprek', async () => {
    const many = Array.from({ length: 40 }, () => msg([text('ok')]));
    const { chat } = setup(many);
    for (let i = 0; i < 40; i++) await chat.send(`vraag ${i}`);
    await expect(chat.send('nog één')).rejects.toThrow('nieuw gesprek');
    chat.reset();
    await expect(chat.send('vers')).rejects.toThrow('geen antwoord meer'); // de nep is leeg, maar de begrenzing is weg
  });
});

describe('describeError', () => {
  const headers = new Headers();
  test.each([
    [() => new Anthropic.AuthenticationError(401, { error: { message: 'x' } }, 'x', headers), 'niet geaccepteerd'],
    [() => new Anthropic.PermissionDeniedError(403, { error: { message: 'x' } }, 'x', headers), 'niet geaccepteerd'],
    [() => new Anthropic.RateLimitError(429, { error: { message: 'x' } }, 'x', headers), 'te veel verzoeken'],
    [() => new Anthropic.APIConnectionError({ message: 'x' }), 'Geen verbinding'],
    [
      () => new Anthropic.BadRequestError(400, { error: { message: 'x' } }, 'Slecht verzoek', headers),
      'wees het verzoek af',
    ],
    [() => new Anthropic.InternalServerError(500, { error: { message: 'x' } }, 'x', headers), 'gaf een fout (500)'],
    [() => new Error('eigen melding'), 'eigen melding'],
  ])('%#', (make, expected) => {
    expect(describeError(make(), Anthropic)).toContain(expected);
  });

  test('een tekst of onbekend ding wordt gewoon tekst', () => {
    expect(describeError('kapot', Anthropic)).toBe('kapot');
  });
});

describe('tools voor de API', () => {
  test('precies dezelfde tools als de MCP-server, met schema en beschrijving', async () => {
    const tools = await listApiTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
    }
    const create = tools.find((t) => t.name === 'create_events')!;
    expect(JSON.stringify(create.input_schema)).toContain('start_time');
  });

  test('de systeemtekst noemt de datum en de gespreksstijl', () => {
    const prompt = systemPrompt(new Date(2026, 9, 26, 10, 5));
    expect(prompt).toContain('maandag 26 oktober 2026');
    expect(prompt).toContain('get_context');
    expect(prompt).toContain('Dutch by default');
  });
});
