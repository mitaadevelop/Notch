import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0)); // maandag 26 oktober 2026, 10:00
});
afterEach(() => vi.useRealTimers());

interface Ev {
  id: string;
  occurrence_date: string;
  title: string;
  date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  calendar: string | null;
  read_only: boolean;
  holiday?: boolean;
  location: string | null;
  notes?: string | null;
  invitees?: string[];
  alert_minutes_before?: number | null;
  repeat?: { frequency: string; interval: number; until: string | null; weekdays?: number[] } | null;
  recurring: boolean;
}

async function setup() {
  const ctx = await freshModules();
  const toast = vi.fn();
  ctx.state.hooks.undoToast = toast;
  const mcp = await import('../../../src/js/mcp.ts');
  const call = <T = unknown>(tool: string, args?: unknown) => mcp.handleMcpCall(tool, args) as Promise<T>;
  const seed = (e: Record<string, unknown>) => ctx.store.addEvent({ title: 'X', date: '2026-10-27', ...e } as never);
  toast.mockClear();
  return { ...ctx, mcp, call, toast, seed };
}

type List = { count: number; truncated: boolean; events: Ev[] };

describe('get_context', () => {
  test("datum, agenda's en wat eraan komt", async () => {
    const { call, seed, store } = await setup();
    seed({ title: 'Tandarts', date: '2026-10-27', time: '14:00', endTime: '15:00', location: 'Utrecht' });
    seed({ title: 'Voorbij', date: '2026-10-26', time: '08:00', endTime: '09:00' });
    seed({ title: 'Nog bezig', date: '2026-10-26', time: '09:30', endTime: '11:00' });
    seed({ title: 'Ver weg', date: '2027-03-01' });
    const external = store.addCalendar({
      name: 'Google',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
    });
    store.applySync(external.id, [{ id: 'u', title: 'Extern', date: '2026-10-28' }]);

    const ctx = await call<Record<string, unknown> & { upcoming_events: Ev[]; calendars: Record<string, unknown>[] }>(
      'get_context',
    );
    expect(ctx).toMatchObject({
      today: '2026-10-26',
      now: '2026-10-26T10:00',
      weekday: 'maandag',
      week_starts_on: 'monday',
      total_events: 5,
    });
    expect(typeof ctx.timezone).toBe('string');
    expect(ctx.upcoming_events.map((e) => e.title)).toEqual(['Nog bezig', 'Tandarts', 'Extern']);
    const google = ctx.calendars.find((c) => c.name === 'Google');
    expect(google).toMatchObject({ read_only: true, source: 'link', event_count: 1 });
    expect(ctx.calendars.find((c) => c.name === 'Feestdagen NL')).toMatchObject({ read_only: true, type: 'holidays' });
    expect(ctx.calendars.find((c) => c.name === 'Privé')).toMatchObject({
      read_only: false,
      source: null,
      event_count: 4,
    });
  });

  test('een lege agenda geeft lege lijsten, geen fout', async () => {
    const { call } = await setup();
    const ctx = await call<{ upcoming_events: unknown[]; total_events: number }>('get_context');
    expect(ctx.upcoming_events).toEqual([]);
    expect(ctx.total_events).toBe(0);
  });
});

describe('list_events', () => {
  test('geeft afspraken in een bereik, gesorteerd, met alle velden', async () => {
    const { call, seed } = await setup();
    seed({ title: 'Later', date: '2026-10-28', time: '15:00', endTime: '16:00' });
    seed({
      title: 'Eerst',
      date: '2026-10-27',
      time: '09:00',
      endTime: '10:00',
      location: 'Kantoor',
      notes: 'Slides',
      invitees: ['Sam'],
      alert: 15,
    });
    seed({ title: 'Hele dag', date: '2026-10-27' });
    seed({ title: 'Buiten bereik', date: '2026-11-20' });
    const result = await call<List>('list_events', { from: '2026-10-26', to: '2026-11-01' });
    expect(result).toMatchObject({ from: '2026-10-26', to: '2026-11-01', count: 3, truncated: false });
    expect(result.events.map((e) => e.title)).toEqual(['Hele dag', 'Eerst', 'Later']);
    expect(result.events[1]).toMatchObject({
      title: 'Eerst',
      date: '2026-10-27',
      end_date: '2026-10-27',
      start_time: '09:00',
      end_time: '10:00',
      all_day: false,
      calendar: 'Privé',
      location: 'Kantoor',
      notes: 'Slides',
      invitees: ['Sam'],
      alert_minutes_before: 15,
      read_only: false,
      recurring: false,
      repeat: null,
    });
    expect(result.events[0]).toMatchObject({ all_day: true, start_time: null, end_time: null });
  });

  test('herhalende afspraken worden uitgesplitst per voorkomen, met hun oorspronkelijke datum', async () => {
    const { call, seed } = await setup();
    seed({
      title: 'Yoga',
      date: '2026-10-05',
      time: '19:00',
      endTime: '20:00',
      repeat: { freq: 'weekly', interval: 1, until: '' },
    });
    const { events } = await call<List>('list_events', { from: '2026-10-26', to: '2026-11-08' });
    expect(events.map((e) => e.date)).toEqual(['2026-10-26', '2026-11-02']);
    expect(events.map((e) => e.occurrence_date)).toEqual(['2026-10-26', '2026-11-02']);
    expect(events[0]).toMatchObject({ recurring: true, repeat: { frequency: 'weekly', interval: 1, until: null } });
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
  });

  test('wekelijkse herhaling op meerdere dagen laat de weekdagen zien', async () => {
    const { call, seed } = await setup();
    seed({
      title: 'Sport',
      date: '2026-10-26',
      time: '18:00',
      endTime: '19:00',
      repeat: { freq: 'weekly', interval: 1, until: '', byDay: [1, 3] },
    });
    const { events } = await call<List>('list_events', { from: '2026-10-26', to: '2026-10-31' });
    expect(events.map((e) => e.date)).toEqual(['2026-10-26', '2026-10-28']);
    expect(events[0].repeat?.weekdays).toEqual([1, 3]);
  });

  test('een meerdaagse afspraak telt mee als hij midden in het bereik begint of eindigt', async () => {
    const { call, seed } = await setup();
    seed({ title: 'Reis', date: '2026-10-20', endDate: '2026-10-28' });
    const { events } = await call<List>('list_events', { from: '2026-10-26', to: '2026-10-27' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2026-10-20', end_date: '2026-10-28' });
  });

  test('filtert op agenda (naam, id of begin van de naam) en kent feestdagen alleen op verzoek', async () => {
    const { call, seed } = await setup();
    seed({ title: 'Privé-ding', date: '2026-10-25' });
    seed({ title: 'Werk-ding', date: '2026-10-25', calendarId: 'work' });
    const base = { from: '2026-10-25', to: '2026-10-25' };
    const christmas = { from: '2026-12-25', to: '2026-12-25' };
    expect((await call<List>('list_events', { ...base, calendar: 'Werk' })).events.map((e) => e.title)).toEqual([
      'Werk-ding',
    ]);
    expect((await call<List>('list_events', { ...base, calendar: 'work' })).events.map((e) => e.title)).toEqual([
      'Werk-ding',
    ]);
    expect((await call<List>('list_events', { ...base, calendar: 'priv' })).events.map((e) => e.title)).toEqual([
      'Privé-ding',
    ]);
    expect((await call<List>('list_events', christmas)).events.some((e) => e.holiday)).toBe(false);
    const withHolidays = await call<List>('list_events', { ...christmas, include_holidays: true });
    expect(withHolidays.events.map((e) => e.title)).toContain('Eerste Kerstdag');
  });

  test('een onbekende agenda noemt de beschikbare namen', async () => {
    const { call } = await setup();
    await expect(
      call('list_events', { from: '2026-10-25', to: '2026-10-25', calendar: 'Bestaat niet' }),
    ).rejects.toThrow(/"Privé".*"Werk"/);
  });

  test('een verborgen agenda telt niet mee (zoals in de weergave)', async () => {
    const { call, seed, store } = await setup();
    seed({ title: 'Geheim', date: '2026-10-27', calendarId: 'work' });
    store.setCalendarVisible('work', false);
    expect((await call<List>('list_events', { from: '2026-10-27', to: '2026-10-27' })).events).toEqual([]);
  });

  test('limit kapt af en meldt dat er meer is', async () => {
    const { call, seed } = await setup();
    for (let i = 0; i < 5; i++)
      seed({ title: `A${i}`, date: '2026-10-27', time: `0${i + 1}:00`, endTime: `0${i + 1}:30` });
    const result = await call<List>('list_events', { from: '2026-10-27', to: '2026-10-27', limit: 2 });
    expect(result).toMatchObject({ count: 5, truncated: true });
    expect(result.events.map((e) => e.title)).toEqual(['A0', 'A1']);
  });

  test.each([
    [{ from: '2026-10-28', to: '2026-10-27' }, 'ligt voor'],
    [{ from: '2026-01-01', to: '2027-12-31' }, 'te groot'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'geen geldige datum'],
    [{ from: '26-10-2026', to: '2026-10-27' }, 'geen geldige datum'],
    [{ to: '2026-10-27' }, 'ontbreekt'],
    [{ from: '2026-10-27', to: '2026-10-28', limit: 0 }, 'geheel getal'],
    [{ from: '2026-10-27', to: '2026-10-28', include_holidays: 'ja' }, 'true of false'],
    [null, 'ontbreekt'],
    ['tekst', 'ontbreekt'],
  ])('ongeldige invoer %j wordt netjes afgewezen', async (args, message) => {
    const { call } = await setup();
    await expect(call('list_events', args)).rejects.toThrow(message);
  });
});

describe('search_events', () => {
  async function withEvents() {
    const ctx = await setup();
    ctx.seed({ title: 'Tandarts Utrecht', date: '2026-11-02', time: '14:00', endTime: '15:00' });
    ctx.seed({ title: 'Lunch', date: '2026-11-03', location: 'Café bij de tandarts' });
    ctx.seed({ title: 'Overleg', date: '2026-11-04', notes: 'Over de TANDARTS-rekening', invitees: ['Sam'] });
    ctx.seed({ title: 'Yoga', date: '2026-10-05', repeat: { freq: 'weekly', interval: 1, until: '' } });
    return ctx;
  }

  test('zoekt in titel, locatie, notities en genodigden zonder op hoofdletters te letten', async () => {
    const { call } = await withEvents();
    const result = await call<List>('search_events', { query: 'tandarts' });
    expect(result.events.map((e) => e.title).sort()).toEqual(['Lunch', 'Overleg', 'Tandarts Utrecht']);
    expect((await call<List>('search_events', { query: 'sam' })).events.map((e) => e.title)).toEqual(['Overleg']);
  });

  test('zonder bereik: de eerstvolgende keer van een herhalende afspraak', async () => {
    const { call } = await withEvents();
    const { events } = await call<List>('search_events', { query: 'yoga' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Yoga', date: '2026-10-26', recurring: true });
  });

  test('met een bereik: alle voorkomens daarin', async () => {
    const { call } = await withEvents();
    const { events } = await call<List>('search_events', { query: 'yoga', from: '2026-10-26', to: '2026-11-09' });
    expect(events.map((e) => e.date)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  test('vindt feestdagen en limiteert het aantal', async () => {
    const { call } = await withEvents();
    const hol = await call<{ events: { title: string; holiday?: boolean }[] }>('search_events', { query: 'kerst' });
    expect(hol.events.every((e) => e.holiday)).toBe(true);
    expect(hol.events.map((e) => e.title)).toContain('Eerste Kerstdag');
    expect((await call<List>('search_events', { query: 'a', limit: 2 })).events.length).toBeLessThanOrEqual(2);
  });

  test('een verborgen agenda wordt niet doorzocht', async () => {
    const { call, store } = await withEvents();
    store.setCalendarVisible('home', false);
    expect((await call<List>('search_events', { query: 'tandarts' })).events).toEqual([]);
  });

  test.each([
    [{}, 'ontbreekt'],
    [{ query: '   ' }, 'mag niet leeg'],
    [{ query: 'x'.repeat(201) }, 'te lang'],
    [{ query: 'x', from: '2026-10-26' }, 'samen op'],
    [{ query: 'x', from: '2026-10-28', to: '2026-10-26' }, 'ligt voor'],
  ])('ongeldige invoer %j', async (args, message) => {
    const { call } = await setup();
    await expect(call('search_events', args)).rejects.toThrow(message);
  });
});

describe('get_event', () => {
  test('geeft alle details van één afspraak', async () => {
    const { call, seed } = await setup();
    const ev = seed({
      title: 'Tandarts',
      date: '2026-10-27',
      time: '14:00',
      endTime: '15:00',
      location: 'Utrecht',
      notes: 'Kaartje',
    });
    expect(await call<Ev>('get_event', { id: ev.id })).toMatchObject({
      id: ev.id,
      title: 'Tandarts',
      notes: 'Kaartje',
      date: '2026-10-27',
    });
  });

  test('een voorkomen van een herhaling met occurrence_date', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Yoga', date: '2026-10-05', repeat: { freq: 'weekly', interval: 1, until: '' } });
    expect(await call<Ev>('get_event', { id: ev.id, occurrence_date: '2026-10-19' })).toMatchObject({
      occurrence_date: '2026-10-19',
      date: '2026-10-19',
    });
    await expect(call('get_event', { id: ev.id, occurrence_date: '2026-10-20' })).rejects.toThrow(
      'geen voorkomen op 2026-10-20',
    );
  });

  test('onbekend of ontbrekend id', async () => {
    const { call } = await setup();
    await expect(call('get_event', { id: 'bestaat-niet' })).rejects.toThrow(
      'Geen afspraak gevonden met id "bestaat-niet"',
    );
    await expect(call('get_event', {})).rejects.toThrow('"id" ontbreekt');
    await expect(call('get_event', { id: 5 })).rejects.toThrow('"id" ontbreekt');
  });

  test('ook een afspraak in een verborgen agenda is op te vragen', async () => {
    const { call, seed, store } = await setup();
    const ev = seed({ title: 'Verborgen', date: '2026-10-27', calendarId: 'work' });
    store.setCalendarVisible('work', false);
    expect(await call<Ev>('get_event', { id: ev.id })).toMatchObject({ title: 'Verborgen', calendar: 'Werk' });
  });
});

describe('find_free_time', () => {
  const free = (r: unknown) =>
    (r as { slots: { date: string; start_time: string; end_time: string; minutes: number }[] }).slots;

  test('vindt gaten tussen afspraken binnen het werkvenster', async () => {
    const { call, seed } = await setup();
    seed({ title: 'A', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    seed({ title: 'B', date: '2026-10-27', time: '13:00', endTime: '14:30' });
    const slots = free(await call('find_free_time', { from: '2026-10-27', to: '2026-10-27', duration_minutes: 30 }));
    expect(slots).toEqual([
      { date: '2026-10-27', start_time: '09:00', end_time: '10:00', minutes: 60 },
      { date: '2026-10-27', start_time: '11:00', end_time: '13:00', minutes: 120 },
      { date: '2026-10-27', start_time: '14:30', end_time: '18:00', minutes: 210 },
    ]);
  });

  test('de gewenste lengte filtert te korte gaten', async () => {
    const { call, seed } = await setup();
    seed({ title: 'A', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    seed({ title: 'B', date: '2026-10-27', time: '13:00', endTime: '14:30' });
    const slots = free(await call('find_free_time', { from: '2026-10-27', to: '2026-10-27', duration_minutes: 90 }));
    expect(slots.map((s) => s.start_time)).toEqual(['11:00', '14:30']);
  });

  test('overlappende afspraken tellen als één bezet blok; hele-dag-afspraken blokkeren niet', async () => {
    const { call, seed } = await setup();
    seed({ title: 'A', date: '2026-10-27', time: '10:00', endTime: '12:00' });
    seed({ title: 'B', date: '2026-10-27', time: '11:00', endTime: '13:00' });
    seed({ title: 'Vrij', date: '2026-10-27' });
    const slots = free(await call('find_free_time', { from: '2026-10-27', to: '2026-10-27', duration_minutes: 60 }));
    expect(slots.map((s) => [s.start_time, s.end_time])).toEqual([
      ['09:00', '10:00'],
      ['13:00', '18:00'],
    ]);
  });

  test('een afspraak zonder eindtijd telt als een uur, en een meerdaagse blokkeert tussenliggende dagen helemaal', async () => {
    const { call, seed } = await setup();
    seed({ title: 'Zonder eind', date: '2026-10-27', time: '09:00', endTime: '' });
    seed({ title: 'Reis', date: '2026-10-28', endDate: '2026-10-30', time: '12:00', endTime: '12:00' });
    const slots = free(await call('find_free_time', { from: '2026-10-27', to: '2026-10-30', duration_minutes: 30 }));
    expect(slots.filter((s) => s.date === '2026-10-27')[0].start_time).toBe('10:00');
    expect(slots.filter((s) => s.date === '2026-10-29')).toEqual([]); // midden in de reis: de hele dag bezet
    expect(slots.filter((s) => s.date === '2026-10-28')[0]).toMatchObject({ start_time: '09:00', end_time: '12:00' });
    expect(slots.filter((s) => s.date === '2026-10-30')[0]).toMatchObject({ start_time: '12:00', end_time: '18:00' });
  });

  test('weekenden worden overgeslagen tenzij gevraagd; eigen venster en limiet werken', async () => {
    const { call } = await setup();
    const base = { from: '2026-10-30', to: '2026-11-02', duration_minutes: 60, day_start: '10:00', day_end: '12:00' };
    expect(free(await call('find_free_time', base)).map((s) => s.date)).toEqual(['2026-10-30', '2026-11-02']);
    expect(free(await call('find_free_time', { ...base, include_weekends: true })).map((s) => s.date)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(free(await call('find_free_time', { ...base, include_weekends: true, limit: 2 }))).toHaveLength(2);
    expect(free(await call('find_free_time', base))[0]).toMatchObject({
      start_time: '10:00',
      end_time: '12:00',
      minutes: 120,
    });
  });

  test('een afspraak buiten het venster verandert niets', async () => {
    const { call, seed } = await setup();
    seed({ title: 'Vroeg', date: '2026-10-27', time: '07:00', endTime: '08:00' });
    seed({ title: 'Laat', date: '2026-10-27', time: '19:00', endTime: '20:00' });
    const slots = free(await call('find_free_time', { from: '2026-10-27', to: '2026-10-27', duration_minutes: 60 }));
    expect(slots).toEqual([{ date: '2026-10-27', start_time: '09:00', end_time: '18:00', minutes: 540 }]);
  });

  test.each([
    [{ from: '2026-10-27', to: '2026-10-27' }, 'duration_minutes'],
    [{ from: '2026-10-27', to: '2026-10-27', duration_minutes: 2 }, 'geheel getal'],
    [
      { from: '2026-10-27', to: '2026-10-27', duration_minutes: 30, day_start: '18:00', day_end: '09:00' },
      'na "day_start"',
    ],
    [{ from: '2026-10-27', to: '2026-10-27', duration_minutes: 30, day_start: '9' }, 'geen geldige tijd'],
    [{ from: '2026-01-01', to: '2026-12-31', duration_minutes: 30 }, 'te groot'],
  ])('ongeldige invoer %j', async (args, message) => {
    const { call } = await setup();
    await expect(call('find_free_time', args)).rejects.toThrow(message);
  });
});

describe('create_events', () => {
  type Created = { created: number; events: Ev[] };

  test('een hele-dag-afspraak en een afspraak met tijd (standaard een uur) in de eerste eigen agenda', async () => {
    const { call, state, toast } = await setup();
    const result = await call<Created>('create_events', {
      events: [
        { title: 'Verjaardag oma', date: '2026-11-05' },
        { title: 'Tandarts', date: '2026-11-06', start_time: '14:00' },
      ],
    });
    expect(result.created).toBe(2);
    expect(result.events[0]).toMatchObject({ all_day: true, calendar: 'Privé', start_time: null });
    expect(result.events[1]).toMatchObject({ start_time: '14:00', end_time: '15:00', all_day: false });
    expect(state.data.events).toHaveLength(2);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Claude: 2 afspraken toegevoegd');
  });

  test('alles in één ongedaan-maken-stap', async () => {
    const { call, state, store } = await setup();
    await call('create_events', {
      events: [
        { title: 'A', date: '2026-11-05' },
        { title: 'B', date: '2026-11-06' },
        { title: 'C', date: '2026-11-07' },
      ],
    });
    expect(state.data.events).toHaveLength(3);
    store.undo();
    expect(state.data.events).toHaveLength(0);
  });

  test('kiest de agenda op naam, hoofdletterongevoelig, of op id', async () => {
    const { call } = await setup();
    const r = await call<Created>('create_events', {
      events: [
        { title: 'A', date: '2026-11-05', calendar: 'werk' },
        { title: 'B', date: '2026-11-05', calendar: 'WERK' },
        { title: 'C', date: '2026-11-05', calendar: 'work' },
      ],
    });
    expect(r.events.map((e) => e.calendar)).toEqual(['Werk', 'Werk', 'Werk']);
  });

  test('alle velden: locatie, notities, genodigden, melding en herhaling', async () => {
    const { call, state } = await setup();
    await call('create_events', {
      events: [
        {
          title: '  Yoga  ',
          date: '2026-10-26',
          start_time: '19:00',
          end_time: '20:30',
          location: 'Studio',
          notes: 'Matje meenemen',
          invitees: [' Sam ', '', 'lisa@example.com'],
          alert_minutes_before: 15,
          repeat: { frequency: 'weekly', interval: 2, until: '2026-12-31', weekdays: [1, 4] },
        },
      ],
    });
    expect(state.data.events[0]).toMatchObject({
      title: 'Yoga',
      time: '19:00',
      endTime: '20:30',
      location: 'Studio',
      notes: 'Matje meenemen',
      invitees: ['Sam', 'lisa@example.com'],
      alert: 15,
      repeat: { freq: 'weekly', interval: 2, until: '2026-12-31', byDay: [1, 4] },
    });
  });

  test('weekdagen horen alleen bij een wekelijkse herhaling', async () => {
    const { call, state } = await setup();
    await call('create_events', {
      events: [{ title: 'D', date: '2026-10-26', repeat: { frequency: 'daily', weekdays: [1] } }],
    });
    expect(state.data.events[0].repeat).toEqual({ freq: 'daily', interval: 1, until: '' });
  });

  test('een meerdaagse afspraak', async () => {
    const { call } = await setup();
    const r = await call<Created>('create_events', {
      events: [{ title: 'Vakantie', date: '2026-12-20', end_date: '2026-12-31' }],
    });
    expect(r.events[0]).toMatchObject({ date: '2026-12-20', end_date: '2026-12-31', all_day: true });
  });

  test('bij één foute afspraak wordt er niets gemaakt, met het nummer van de foute', async () => {
    const { call, state, toast } = await setup();
    await expect(
      call('create_events', {
        events: [
          { title: 'Goed', date: '2026-11-05' },
          { title: 'Fout', date: '2026-11-06', start_time: '10:00', end_time: '09:00' },
        ],
      }),
    ).rejects.toThrow('Afspraak 2: "end_time" moet na "start_time" liggen');
    expect(state.data.events).toHaveLength(0);
    expect(toast).not.toHaveBeenCalled();
  });

  test("niet in alleen-lezen agenda's, feestdagen of onbekende agenda's", async () => {
    const { call, store } = await setup();
    const external = store.addCalendar({
      name: 'Google',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
    });
    await expect(
      call('create_events', { events: [{ title: 'A', date: '2026-11-05', calendar: 'Google' }] }),
    ).rejects.toThrow('alleen-lezen');
    await expect(
      call('create_events', { events: [{ title: 'A', date: '2026-11-05', calendar: external.id }] }),
    ).rejects.toThrow('alleen-lezen');
    await expect(
      call('create_events', { events: [{ title: 'A', date: '2026-11-05', calendar: 'Feestdagen NL' }] }),
    ).rejects.toThrow('kunnen geen afspraken');
    await expect(
      call('create_events', { events: [{ title: 'A', date: '2026-11-05', calendar: 'Nergens' }] }),
    ).rejects.toThrow('Geen agenda gevonden');
  });

  test.each([
    [{ date: '2026-11-05' }, 'ontbreekt'],
    [{ title: '  ', date: '2026-11-05' }, 'mag niet leeg'],
    [{ title: 'A' }, '"date" ontbreekt'],
    [{ title: 'A', date: '2026-11-05', end_date: '2026-11-04' }, 'ligt voor'],
    [{ title: 'A', date: '2026-11-05', end_time: '10:00' }, 'kan niet zonder'],
    [{ title: 'A', date: '2026-11-05', start_time: '10:00', end_time: '10:00' }, 'moet na'],
    [{ title: 'A', date: '2026-11-05', start_time: '24:00' }, 'geen geldige tijd'],
    [{ title: 'A', date: '2026-13-05' }, 'geen geldige datum'],
    [{ title: 'x'.repeat(501), date: '2026-11-05' }, 'te lang'],
    [{ title: 'A', date: '2026-11-05', notes: 'x'.repeat(10_001) }, 'te lang'],
    [{ title: 'A', date: '2026-11-05', invitees: 'Sam' }, '"invitees"'],
    [{ title: 'A', date: '2026-11-05', alert_minutes_before: -1 }, 'geheel getal'],
    [{ title: 'A', date: '2026-11-05', repeat: { frequency: 'soms' } }, 'frequency'],
    [{ title: 'A', date: '2026-11-05', repeat: { frequency: 'weekly', weekdays: [9] } }, 'weekdays'],
    [{ title: 'A', date: '2026-11-05', repeat: { frequency: 'daily', until: '2026-02-31' } }, 'geen geldige datum'],
    ['geen object', 'ontbreekt'],
  ])('ongeldige afspraak %j', async (event, message) => {
    const { call } = await setup();
    await expect(call('create_events', { events: [event] })).rejects.toThrow(message);
  });

  test('een lege of te lange lijst', async () => {
    const { call } = await setup();
    await expect(call('create_events', { events: [] })).rejects.toThrow('minstens één');
    await expect(call('create_events', {})).rejects.toThrow('minstens één');
    await expect(
      call('create_events', { events: Array.from({ length: 51 }, () => ({ title: 'x', date: '2026-11-05' })) }),
    ).rejects.toThrow('maximaal 50');
  });

  test('een einde op 23:59 blijft binnen de dag bij een starttijd laat op de avond', async () => {
    const { call } = await setup();
    const r = await call<Created>('create_events', {
      events: [{ title: 'Laat', date: '2026-11-05', start_time: '23:30' }],
    });
    expect(r.events[0].end_time).toBe('23:59');
  });
});

describe('update_event', () => {
  type Updated = { updated: boolean; scope: string; event: Ev | null };

  test('wijzigt alleen wat je opgeeft', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({
      title: 'Tandarts',
      date: '2026-10-27',
      time: '14:00',
      endTime: '15:00',
      location: 'Utrecht',
      notes: 'n',
    });
    const r = await call<Updated>('update_event', { id: ev.id, title: 'Tandarts (verzet)', location: 'Amsterdam' });
    expect(r.event).toMatchObject({
      title: 'Tandarts (verzet)',
      location: 'Amsterdam',
      start_time: '14:00',
      end_time: '15:00',
      notes: 'n',
    });
    expect(state.data.events).toHaveLength(1);
  });

  test('een andere dag behoudt tijd en lengte, ook bij meerdere dagen', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Reis', date: '2026-10-27', endDate: '2026-10-29' });
    const r = await call<Updated>('update_event', { id: ev.id, date: '2026-11-03' });
    expect(r.event).toMatchObject({ date: '2026-11-03', end_date: '2026-11-05' });
  });

  test('een nieuwe starttijd behoudt de duur; een nieuwe eindtijd verandert alleen het einde', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Overleg', date: '2026-10-27', time: '10:00', endTime: '11:30' });
    expect((await call<Updated>('update_event', { id: ev.id, start_time: '15:00' })).event).toMatchObject({
      start_time: '15:00',
      end_time: '16:30',
    });
    expect((await call<Updated>('update_event', { id: ev.id, end_time: '17:00' })).event).toMatchObject({
      start_time: '15:00',
      end_time: '17:00',
    });
  });

  test('een afspraak met tijd wordt hele dag en andersom', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'X', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    expect((await call<Updated>('update_event', { id: ev.id, all_day: true })).event).toMatchObject({
      all_day: true,
      start_time: null,
    });
    expect((await call<Updated>('update_event', { id: ev.id, start_time: '09:00' })).event).toMatchObject({
      all_day: false,
      start_time: '09:00',
      end_time: '10:00',
    });
  });

  test('de agenda wisselen, genodigden, melding en herhaling stoppen', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'X', date: '2026-10-27', repeat: { freq: 'weekly', interval: 1, until: '' }, alert: 10 });
    const r = await call<Updated>('update_event', {
      id: ev.id,
      calendar: 'Werk',
      invitees: ['Sam'],
      alert_minutes_before: 30,
      repeat: null,
    });
    expect(r.event).toMatchObject({
      calendar: 'Werk',
      invitees: ['Sam'],
      alert_minutes_before: 30,
      repeat: null,
      recurring: false,
    });
  });

  test('"alleen deze" van een herhaling maakt een losse afspraak en laat de reeks ongemoeid op die dag', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({
      title: 'Yoga',
      date: '2026-10-26',
      time: '19:00',
      endTime: '20:00',
      repeat: { freq: 'weekly', interval: 1, until: '' },
    });
    const r = await call<Updated>('update_event', {
      id: ev.id,
      occurrence_date: '2026-11-02',
      scope: 'only',
      start_time: '08:00',
    });
    expect(r.scope).toBe('only');
    expect(r.event).toMatchObject({ date: '2026-11-02', start_time: '08:00', recurring: false });
    expect(r.event?.id).not.toBe(ev.id);
    expect(state.data.events.find((e) => e.id === ev.id)?.exceptions).toEqual(['2026-11-02']);
  });

  test('"volgende" kapt de oude reeks af en begint een nieuwe', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({
      title: 'Yoga',
      date: '2026-10-26',
      time: '19:00',
      endTime: '20:00',
      repeat: { freq: 'weekly', interval: 1, until: '' },
    });
    const r = await call<Updated>('update_event', {
      id: ev.id,
      occurrence_date: '2026-11-09',
      scope: 'following',
      title: 'Yoga nieuw',
    });
    expect(r.event).toMatchObject({ title: 'Yoga nieuw', recurring: true });
    expect(state.data.events.find((e) => e.id === ev.id)?.repeat?.until).toBe('2026-11-08');
  });

  test('een scope zonder occurrence_date, een ongeldige scope of de agenda wisselen voor één voorkomen wordt afgewezen', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'weekly', interval: 1, until: '' } });
    await expect(call('update_event', { id: ev.id, scope: 'only', title: 'x' })).rejects.toThrow(
      'is "occurrence_date" nodig',
    );
    await expect(call('update_event', { id: ev.id, scope: 'alles', title: 'x' })).rejects.toThrow('"scope"');
    await expect(
      call('update_event', { id: ev.id, occurrence_date: '2026-11-02', scope: 'only', calendar: 'Werk' }),
    ).rejects.toThrow('hele reeks');
  });

  test('een scope bij een losse afspraak telt als "alle"', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Los', date: '2026-10-27' });
    expect((await call<Updated>('update_event', { id: ev.id, scope: 'only', title: 'Los!' })).scope).toBe('all');
  });

  test('de melding noemt Claude en kan met één klik ongedaan worden gemaakt', async () => {
    const { call, seed, toast, store, state } = await setup();
    const ev = seed({ title: 'Oud', date: '2026-10-27' });
    toast.mockClear();
    await call('update_event', { id: ev.id, title: 'Nieuw' });
    expect(toast).toHaveBeenCalledWith('Claude: Nieuw gewijzigd');
    store.undo();
    expect(state.data.events[0].title).toBe('Oud');
  });

  test("afspraken in alleen-lezen agenda's kunnen niet worden gewijzigd", async () => {
    const { call, store, state } = await setup();
    const external = store.addCalendar({
      name: 'Google',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
    });
    store.applySync(external.id, [{ id: 'u', title: 'Extern', date: '2026-10-27' }]);
    const id = state.data.events.find((e) => e.title === 'Extern')!.id;
    await expect(call('update_event', { id, title: 'Aangepast' })).rejects.toThrow('alleen-lezen agenda "Google"');
    expect(state.data.events.find((e) => e.id === id)?.title).toBe('Extern');
  });

  test.each([
    [{ title: ' ' }, 'mag niet leeg'],
    [{ date: '2026-10-99' }, 'geen geldige datum'],
    [{ end_date: '2026-10-01' }, 'ligt voor'],
    [{ all_day: true, start_time: '10:00' }, 'kan niet'],
    [{ end_time: '09:00' }, 'moet na'],
    [{ calendar: 'Feestdagen NL' }, 'kunnen geen afspraken'],
    [{ repeat: { frequency: 'x' } }, 'frequency'],
  ])('ongeldige wijziging %j', async (patch, message) => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'X', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    await expect(call('update_event', { id: ev.id, ...patch })).rejects.toThrow(message);
  });

  test('een afspraak zonder tijd een eindtijd geven zonder starttijd kan niet', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Dag', date: '2026-10-27' });
    await expect(call('update_event', { id: ev.id, end_time: '12:00' })).rejects.toThrow('"start_time" nodig');
  });

  test('onbekend id', async () => {
    const { call } = await setup();
    await expect(call('update_event', { id: 'nee', title: 'x' })).rejects.toThrow('Geen afspraak gevonden');
  });
});

describe('delete_event', () => {
  test('verwijdert een losse afspraak, met melding en ongedaan maken', async () => {
    const { call, seed, state, toast, store } = await setup();
    const ev = seed({ title: 'Weg', date: '2026-10-27' });
    toast.mockClear();
    expect(await call('delete_event', { id: ev.id })).toEqual({ deleted: true, scope: 'all', title: 'Weg' });
    expect(state.data.events).toEqual([]);
    expect(toast).toHaveBeenCalledWith('Claude: Weg verwijderd');
    store.undo();
    expect(state.data.events).toHaveLength(1);
  });

  test('één voorkomen van een herhaling, of de hele reeks', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'weekly', interval: 1, until: '' } });
    await call('delete_event', { id: ev.id, occurrence_date: '2026-11-02', scope: 'only' });
    expect(state.data.events[0].exceptions).toEqual(['2026-11-02']);
    await call('delete_event', { id: ev.id });
    expect(state.data.events).toEqual([]);
  });

  test('"volgende" laat de eerdere voorkomens staan', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'weekly', interval: 1, until: '' } });
    await call('delete_event', { id: ev.id, occurrence_date: '2026-11-09', scope: 'following' });
    expect(state.data.events[0].repeat?.until).toBe('2026-11-08');
  });

  test('afwijzingen: alleen-lezen, onbekend, scope zonder datum, ongeldige datum van een voorkomen', async () => {
    const { call, seed, store, state } = await setup();
    const external = store.addCalendar({
      name: 'Google',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
    });
    store.applySync(external.id, [{ id: 'u', title: 'Extern', date: '2026-10-27' }]);
    await expect(call('delete_event', { id: state.data.events.find((e) => e.title === 'Extern')!.id })).rejects.toThrow(
      'alleen-lezen',
    );
    await expect(call('delete_event', { id: 'nee' })).rejects.toThrow('Geen afspraak gevonden');
    const ev = seed({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'weekly', interval: 1, until: '' } });
    await expect(call('delete_event', { id: ev.id, scope: 'only' })).rejects.toThrow('is "occurrence_date" nodig');
    await expect(call('delete_event', { id: ev.id, occurrence_date: '2026-11-03', scope: 'only' })).rejects.toThrow(
      'geen voorkomen',
    );
    expect(state.data.events).toHaveLength(2);
  });
});

describe('aanroepen en aansluiten', () => {
  test('een onbekende tool geeft een foutmelding', async () => {
    const { mcp } = await setup();
    await expect(mcp.handleMcpCall('format_c', {})).rejects.toThrow('Onbekende tool: format_c');
    await expect(mcp.handleMcpCall('__proto__', {})).rejects.toThrow('Onbekende tool');
    await expect(mcp.handleMcpCall('toString', {})).rejects.toThrow('Onbekende tool');
  });

  test('initMcp luistert, antwoordt met resultaat of fout, en meldt dat de pagina klaar is', async () => {
    const { mcp } = await setup();
    const agenda = (window as unknown as { agenda: ReturnType<typeof installAgenda> }).agenda;
    mcp.initMcp();
    expect(agenda.mcpReady).toHaveBeenCalledTimes(1);
    const listener = agenda.onMcpCall.mock.calls[0][0] as (call: {
      id: number;
      tool: string;
      args: unknown;
    }) => Promise<void>;
    await listener({ id: 7, tool: 'get_context', args: {} });
    expect(agenda.mcpReply).toHaveBeenLastCalledWith(7, {
      ok: true,
      result: expect.objectContaining({ today: '2026-10-26' }),
    });
    await listener({ id: 8, tool: 'get_event', args: { id: 'nee' } });
    expect(agenda.mcpReply).toHaveBeenLastCalledWith(8, {
      ok: false,
      error: expect.stringContaining('Geen afspraak gevonden'),
    });
  });
});

describe('taken', () => {
  test('create_events maakt een taak en get_event toont task en done', async () => {
    const { call } = await setup();
    const made = await call<{ events: Ev[] }>('create_events', {
      events: [{ title: 'Belasting', date: '2026-11-01', task: true }],
    });
    const { id } = made.events[0];
    expect(await call<Ev & { task: boolean; done: boolean }>('get_event', { id })).toMatchObject({
      task: true,
      done: false,
    });
  });

  test('update_event done:true vinkt af in één ongedaan-stap, en done:false opent weer', async () => {
    const { call, state, toast, store } = await setup();
    const { events } = await call<{ events: Ev[] }>('create_events', {
      events: [{ title: 'Belasting', date: '2026-11-01', task: true }],
    });
    toast.mockClear();
    const r = await call<{ event: { done: boolean } }>('update_event', { id: events[0].id, done: true });
    expect(r.event.done).toBe(true);
    expect(state.data.events[0].doneOn).toEqual(['2026-11-01']);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Claude: Belasting afgevinkt');
    store.undo();
    expect(state.data.events[0].doneOn).toEqual([]);
    await call('update_event', { id: events[0].id, done: true });
    const back = await call<{ event: { done: boolean } }>('update_event', { id: events[0].id, done: false });
    expect(back.event.done).toBe(false);
  });

  test('bij een herhalende taak telt alleen het genoemde voorkomen', async () => {
    const { call, state } = await setup();
    const { events } = await call<{ events: Ev[] }>('create_events', {
      events: [{ title: 'Plant water', date: '2026-10-26', task: true, repeat: { frequency: 'daily' } }],
    });
    await call('update_event', { id: events[0].id, occurrence_date: '2026-10-28', done: true });
    expect(state.data.events[0].doneOn).toEqual(['2026-10-28']);
    const list = await call<{ events: (Ev & { done?: boolean })[] }>('list_events', {
      from: '2026-10-27',
      to: '2026-10-29',
    });
    expect(list.events.map((e) => e.done)).toEqual([false, true, false]);
  });

  test('done bij een gewone afspraak wordt afgewezen', async () => {
    const { call, seed } = await setup();
    const ev = seed({ title: 'Gewoon', date: '2026-10-27' });
    await expect(call('update_event', { id: ev.id, done: true })).rejects.toThrow('alleen bij een taak');
  });

  test('een gewone afspraak veranderen in een taak kan, en done in dezelfde aanroep', async () => {
    const { call, seed, state } = await setup();
    const ev = seed({ title: 'Gewoon', date: '2026-10-27' });
    await call('update_event', { id: ev.id, task: true, done: true });
    expect(state.data.events[0]).toMatchObject({ task: true, doneOn: ['2026-10-27'] });
  });
});
