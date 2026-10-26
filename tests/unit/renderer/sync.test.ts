import { screen } from '@testing-library/dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CalendarSource } from '../../../src/shared/types.ts';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;

beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});

const feedSource: CalendarSource = { kind: 'feed', url: 'https://voorbeeld.nl/a.ics', provider: 'google' };
const ics = (...events: [string, string, string][]) =>
  [
    'BEGIN:VCALENDAR',
    ...events.flatMap(([uid, title, start]) => [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SUMMARY:${title}`,
      `DTSTART:${start}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');

async function setup(source: CalendarSource = feedSource) {
  const ctx = await freshModules();
  const calendar = ctx.store.addCalendar({ name: 'Extern', color: 'red', source });
  const sync = await import('../../../src/js/sync.ts');
  vi.mocked(ctx.state.hooks.render).mockClear();
  return { ...ctx, calendar, sync };
}

describe('applySync', () => {
  test('vervangt de afspraken van de agenda en laat de rest met rust', async () => {
    const { state, store, calendar } = await setup();
    store.addEvent({ title: 'Eigen', date: '2026-10-26' });
    store.applySync(calendar.id, [{ id: 'u1', title: 'Extern 1', date: '2026-10-27' }]);
    store.applySync(calendar.id, [{ id: 'u2', title: 'Extern 2', date: '2026-10-28' }]);
    expect(state.data.events.map((e) => e.title).sort()).toEqual(['Eigen', 'Extern 2']);
    expect(state.data.calendars.find((c) => c.id === calendar.id)?.syncedAt).toBeTypeOf('number');
  });

  test('de id is stabiel (agenda + UID), zodat selectie en meldingen de synchronisatie overleven', async () => {
    const { state, store, calendar } = await setup();
    store.applySync(calendar.id, [{ id: 'u1', title: 'A', date: '2026-10-27' }]);
    const first = state.data.events[0].id;
    store.applySync(calendar.id, [{ id: 'u1', title: 'A', date: '2026-10-27' }]);
    expect(state.data.events[0].id).toBe(first);
    expect(first).toBe(`${calendar.id}:u1`);
  });

  test("dubbele UID's in een feed botsen niet", async () => {
    const { state, store, calendar } = await setup();
    store.applySync(calendar.id, [
      { id: 'dubbel', title: 'A', date: '2026-10-27' },
      { id: 'dubbel', title: 'B', date: '2026-10-28' },
    ]);
    expect(new Set(state.data.events.map((e) => e.id)).size).toBe(2);
  });

  test('alleen opnieuw tekenen als er iets veranderd is, maar altijd opslaan', async () => {
    const { state, store, calendar } = await setup();
    const events = [{ id: 'u1', title: 'A', date: '2026-10-27' }];
    store.applySync(calendar.id, events);
    expect(state.hooks.render).toHaveBeenCalledTimes(1);
    agenda.save.mockClear();
    store.applySync(calendar.id, events);
    expect(state.hooks.render).toHaveBeenCalledTimes(1);
    expect(agenda.save).toHaveBeenCalledTimes(1);
  });

  test('een fout bewaart de melding maar laat de oude afspraken staan; succes wist de melding', async () => {
    const { state, store, calendar } = await setup();
    store.applySync(calendar.id, [{ id: 'u1', title: 'A', date: '2026-10-27' }]);
    store.applySync(calendar.id, null, 'De server reageert niet.');
    expect(state.data.events).toHaveLength(1);
    expect(state.data.calendars.find((c) => c.id === calendar.id)?.syncError).toBe('De server reageert niet.');
    store.applySync(calendar.id, [{ id: 'u1', title: 'A', date: '2026-10-27' }]);
    expect(state.data.calendars.find((c) => c.id === calendar.id)).not.toHaveProperty('syncError');
    expect(state.hooks.render).toHaveBeenCalledTimes(3);
  });

  test('een onbekende agenda wordt genegeerd', async () => {
    const { state, store } = await setup();
    const before = state.data.events.length;
    store.applySync('bestaat-niet', [{ id: 'x', title: 'X', date: '2026-10-27' }]);
    expect(state.data.events).toHaveLength(before);
  });

  test('synchroniseren zit niet in de undo-geschiedenis', async () => {
    const { store, calendar } = await setup();
    // de enige undo-stap is het aanmaken van de agenda zelf
    store.applySync(calendar.id, [{ id: 'u1', title: 'A', date: '2026-10-27' }]);
    expect(store.undo()).toBe(true);
    expect(store.canUndo()).toBe(false);
  });
});

describe("alleen-lezen agenda's", () => {
  test('nieuwe afspraken komen nooit in een externe agenda terecht', async () => {
    const { state, store, calendar } = await setup();
    const event = store.addEvent({ title: 'Geplakt', date: '2026-10-26', calendarId: calendar.id });
    expect(event.calendarId).toBe('home');
    expect(state.data.events.find((e) => e.id === event.id)?.calendarId).toBe('home');
  });

  test('plakken van een externe afspraak maakt een kopie in een eigen agenda', async () => {
    const { state, store, calendar } = await setup();
    store.applySync(calendar.id, [{ id: 'u1', title: 'Extern', date: '2026-10-27', time: '10:00', endTime: '11:00' }]);
    const copy = store.pasteEvent(state.data.events[0], '2026-10-30');
    expect(copy.calendarId).toBe('home');
    expect(state.data.events.filter((e) => e.calendarId === calendar.id)).toHaveLength(1);
  });

  test('bewerken en verwijderen van een externe afspraak doet niets', async () => {
    const { state, store, calendar } = await setup();
    store.applySync(calendar.id, [{ id: 'u1', title: 'Extern', date: '2026-10-27' }]);
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(state.data, '2026-10-27', '2026-10-27').find((o) => !o.holiday)!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    const undoBefore = store.canUndo();
    store.deleteOccurrence(occ, 'all');
    store.editOccurrence(occ, 'all', { ...occ.ev, title: 'Aangepast' });
    expect(state.data.events[0].title).toBe('Extern');
    expect(store.canUndo()).toBe(undoBefore);
  });

  test('een externe agenda wordt niet aangeboden als plek voor nieuwe afspraken', async () => {
    const { state } = await setup();
    expect(state.writableCalendars().map((c) => c.id)).toEqual(['home', 'work', 'birthdays']);
    expect(state.isReadOnly('home')).toBe(false);
  });
});

describe('account opruimen', () => {
  const caldav = (accountId: string): CalendarSource => ({
    kind: 'caldav',
    accountId,
    calendarUrl: `https://x/${accountId}/`,
    provider: 'icloud',
  });

  test('het wachtwoord verdwijnt pas als de laatste agenda van het account weg is', async () => {
    const { store, calendar } = await setup(caldav('acc'));
    const second = store.addCalendar({ name: 'Tweede', source: caldav('acc') });
    store.deleteCalendar(calendar.id);
    expect(agenda.removeAccount).not.toHaveBeenCalled();
    store.deleteCalendar(second.id);
    expect(agenda.removeAccount).toHaveBeenCalledWith('acc');
  });

  test('een feed-agenda verwijderen raakt geen accounts', async () => {
    const { store, calendar } = await setup();
    store.deleteCalendar(calendar.id);
    expect(agenda.removeAccount).not.toHaveBeenCalled();
  });
});

describe('syncCalendar en syncAll', () => {
  test('haalt een feed op, leest hem in en vervangt de afspraken', async () => {
    agenda.fetchFeed.mockResolvedValue(ics(['a', 'Tandarts', '20261027T100000'], ['b', 'Lunch', '20261028T120000']));
    const { state, calendar, sync } = await setup();
    expect(await sync.syncCalendar(calendar)).toBe(true);
    expect(agenda.fetchFeed).toHaveBeenCalledWith(feedSource.url);
    expect(state.data.events.map((e) => [e.title, e.date, e.time])).toEqual([
      ['Tandarts', '2026-10-27', '10:00'],
      ['Lunch', '2026-10-28', '12:00'],
    ]);
  });

  test('een CalDAV-agenda haalt zijn afspraken via het account op', async () => {
    agenda.fetchAccountCalendar.mockResolvedValue(ics(['a', 'Overleg', '20261027T100000']));
    const { state, calendar, sync } = await setup({
      kind: 'caldav',
      accountId: 'acc',
      calendarUrl: 'https://x/cal/',
      provider: 'icloud',
    });
    expect(await sync.syncCalendar(calendar)).toBe(true);
    expect(agenda.fetchAccountCalendar).toHaveBeenCalledWith('acc', 'https://x/cal/');
    expect(state.data.events.map((e) => e.title)).toEqual(['Overleg']);
  });

  test('een fout wordt als melding bewaard, zonder de technische IPC-voorvoegsel', async () => {
    agenda.fetchFeed.mockRejectedValue(
      new Error("Error invoking remote method 'feed:fetch': Error: De server reageert niet (time-out)."),
    );
    const { state, calendar, sync } = await setup();
    expect(await sync.syncCalendar(calendar)).toBe(false);
    expect(state.data.calendars.find((c) => c.id === calendar.id)?.syncError).toBe(
      'De server reageert niet (time-out).',
    );
  });

  test('onleesbare inhoud wordt een lege agenda, geen crash', async () => {
    agenda.fetchFeed.mockResolvedValue('BEGIN:VCALENDAR\nGARBAGE\nEND:VCALENDAR');
    const { state, calendar, sync } = await setup();
    expect(await sync.syncCalendar(calendar)).toBe(true);
    expect(state.data.events).toEqual([]);
  });

  test("syncAll slaat gewone agenda's over, gaat door na een fout en geeft de mislukte namen", async () => {
    agenda.fetchFeed
      .mockRejectedValueOnce(new Error('kapot'))
      .mockResolvedValueOnce(ics(['a', 'Goed', '20261027T100000']));
    const { state, store, sync } = await setup();
    store.addCalendar({ name: 'Tweede', source: { kind: 'feed', url: 'https://x/b.ics', provider: 'other' } });
    expect(await sync.syncAll()).toEqual(['Extern']);
    expect(agenda.fetchFeed).toHaveBeenCalledTimes(2);
    expect(state.data.events.map((e) => e.title)).toEqual(['Goed']);
  });

  test('twee synchronisaties tegelijk worden niet dubbel gedaan', async () => {
    let release: (text: string) => void = () => {};
    agenda.fetchFeed.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    const { sync } = await setup();
    const first = sync.syncAll();
    expect(await sync.syncAll()).toEqual([]);
    release(ics());
    await first;
    expect(agenda.fetchFeed).toHaveBeenCalledTimes(1);
  });

  test('de timer vernieuwt pas als het ingestelde interval verstreken is', async () => {
    vi.useFakeTimers();
    try {
      agenda.fetchFeed.mockResolvedValue(ics());
      const { state, sync } = await setup();
      state.data.settings.refreshMinutes = 5;
      await sync.syncAll(); // begin van de eerste periode
      agenda.fetchFeed.mockClear();
      const timer = sync.startAutoSync(1000);
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(agenda.fetchFeed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(61_000);
      expect(agenda.fetchFeed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4 * 60_000); // de periode begint opnieuw
      expect(agenda.fetchFeed).toHaveBeenCalledTimes(1);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  test('"Uit" vernieuwt nooit vanzelf, en een gewijzigde instelling geldt meteen', async () => {
    vi.useFakeTimers();
    try {
      agenda.fetchFeed.mockResolvedValue(ics());
      const { state, sync } = await setup();
      await sync.syncAll();
      agenda.fetchFeed.mockClear();
      state.data.settings.refreshMinutes = 0;
      const timer = sync.startAutoSync(1000);
      await vi.advanceTimersByTimeAsync(5 * 3600_000);
      expect(agenda.fetchFeed).not.toHaveBeenCalled();
      state.data.settings.refreshMinutes = 15; // al lang geleden vernieuwd: meteen aan de beurt
      await vi.advanceTimersByTimeAsync(1500);
      expect(agenda.fetchFeed).toHaveBeenCalledTimes(1);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  test('een ronde met de hand telt als vernieuwd', async () => {
    vi.useFakeTimers();
    try {
      agenda.fetchFeed.mockResolvedValue(ics());
      const { state, sync } = await setup();
      state.data.settings.refreshMinutes = 10;
      await sync.syncAll();
      const timer = sync.startAutoSync(1000);
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      await sync.syncAll(); // met de knop, 9 minuten later
      agenda.fetchFeed.mockClear();
      await vi.advanceTimersByTimeAsync(5 * 60_000); // 14 min na de eerste, maar 5 na de laatste
      expect(agenda.fetchFeed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 2000);
      expect(agenda.fetchFeed).toHaveBeenCalledTimes(1);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  test("zonder externe agenda's doet de timer niets", async () => {
    vi.useFakeTimers();
    try {
      const { state, store, sync } = await setup();
      store.deleteCalendar(state.data.calendars.find((c) => c.source)!.id);
      const timer = sync.startAutoSync(1000);
      await vi.advanceTimersByTimeAsync(2 * 3600_000);
      expect(agenda.fetchFeed).not.toHaveBeenCalled();
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  test('syncState wordt gemeld bij begin en einde van een ronde', async () => {
    agenda.fetchFeed.mockResolvedValue(ics());
    const { state, sync } = await setup();
    const seen: boolean[] = [];
    state.hooks.syncState = () => seen.push(sync.isSyncing());
    await sync.syncAll();
    expect(seen).toEqual([true, false]);
  });
});

describe('autoSyncDue', () => {
  test.each([
    [0, 0, 10 ** 12, false],
    [5, 1000, 1000 + 299_999, false],
    [5, 1000, 1000 + 300_000, true],
    [60, 0, 3_599_999, false],
    [60, 0, 3_600_000, true],
  ])('%i min, laatste %i, nu %i -> %s', async (minutes, last, now, expected) => {
    const { autoSyncDue } = await import('../../../src/js/sync.ts');
    expect(autoSyncDue(minutes, last, now)).toBe(expected);
  });
});

describe('voortgang tijdens het verversen', () => {
  test('de agenda staat in ui.syncing zolang hij bezig is, en de zijbalk wordt bijgewerkt', async () => {
    let release: (text: string) => void = () => {};
    agenda.fetchFeed.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    const { state, calendar, sync } = await setup();
    const refresh = vi.fn();
    state.hooks.refreshSidebar = refresh;
    const done = sync.syncCalendar(calendar);
    expect(state.ui.syncing.has(calendar.id)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    release('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
    await done;
    expect(state.ui.syncing.has(calendar.id)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('ook na een fout verdwijnt de indicator', async () => {
    agenda.fetchFeed.mockRejectedValue(new Error('kapot'));
    const { state, calendar, sync } = await setup();
    await sync.syncCalendar(calendar);
    expect(state.ui.syncing.size).toBe(0);
  });

  test("de zijbalk toont een draaiend icoontje voor agenda's die bezig zijn", async () => {
    const { state, calendar } = await setup();
    const { renderSidebar } = await import('../../../src/js/sidebar.ts');
    renderSidebar();
    expect(screen.queryByRole('img', { name: 'Bezig met vernieuwen' })).toBeNull();
    state.ui.syncing.add(calendar.id);
    renderSidebar();
    expect(screen.getByRole('img', { name: 'Bezig met vernieuwen' })).toBeInTheDocument();
    state.ui.syncing.delete(calendar.id);
    renderSidebar();
    expect(screen.queryByRole('img', { name: 'Bezig met vernieuwen' })).toBeNull();
  });
});
