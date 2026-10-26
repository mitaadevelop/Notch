import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventOcc } from '../../../src/shared/types.ts';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;

beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});

const newEvent = { title: 'Tandarts', date: '2026-10-26', time: '14:00', endTime: '15:00' };

describe('store: wijzigen, opslaan en ongedaan maken', () => {
  test('een nieuwe afspraak wordt bewaard, opgeslagen en getekend', async () => {
    const { state, store } = await freshModules();
    const event = store.addEvent(newEvent);
    expect(state.data.events).toEqual([event]);
    expect(event).toMatchObject({ title: 'Tandarts', calendarId: 'home', endDate: '2026-10-26' });
    expect(agenda.save).toHaveBeenCalledWith(state.data);
    expect(state.hooks.render).toHaveBeenCalledTimes(1);
  });

  test('undo en redo zetten de afspraak weg en terug', async () => {
    const { state, store } = await freshModules();
    expect(store.undo()).toBe(false); // niets om ongedaan te maken
    store.addEvent(newEvent);
    expect(store.canUndo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(state.data.events).toHaveLength(0);
    expect(store.redo()).toBe(true);
    expect(state.data.events.map((e) => e.title)).toEqual(['Tandarts']);
    expect(store.redo()).toBe(false);
  });

  test('een nieuwe wijziging na undo wist de redo-geschiedenis', async () => {
    const { store } = await freshModules();
    store.addEvent(newEvent);
    store.undo();
    store.addEvent({ ...newEvent, title: 'Anders' });
    expect(store.canRedo()).toBe(false);
  });

  test('"alleen deze" bij een herhalende afspraak voegt een uitzondering toe', async () => {
    const { state, store } = await freshModules();
    const series = store.addEvent({ ...newEvent, repeat: { freq: 'daily', interval: 1, until: '' } });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(state.data, '2026-10-27', '2026-10-27').find((o) => o.id === series.id)!;
    if (occ.holiday) throw new Error('verwacht een afspraak');
    store.deleteOccurrence(occ, 'only');
    expect(state.data.events[0].exceptions).toEqual(['2026-10-27']);
  });

  test('een agenda verwijderen neemt de afspraken mee', async () => {
    const { state, store } = await freshModules();
    store.addEvent(newEvent);
    store.deleteCalendar('home');
    expect(state.data.calendars.some((c) => c.id === 'home')).toBe(false);
    expect(state.data.events).toHaveLength(0);
    store.undo();
    expect(state.data.events).toHaveLength(1);
  });
});

describe('store: melding met "Ongedaan maken"', () => {
  async function withToast() {
    const ctx = await freshModules();
    const toast = vi.fn();
    ctx.state.hooks.undoToast = toast;
    return { ...ctx, toast };
  }

  test('elke wijziging van de gebruiker meldt wat er gebeurde', async () => {
    const { state, store, toast } = await withToast();
    const event = store.addEvent(newEvent);
    expect(toast).toHaveBeenLastCalledWith('Afspraak toegevoegd');
    store.pasteEvent(event, '2026-10-30');
    expect(toast).toHaveBeenLastCalledWith('Afspraak geplakt');

    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(state.data, '2026-10-26', '2026-10-26').find((o) => o.id === event.id)!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    store.editOccurrence(occ, 'all', { ...event, date: '2026-10-27', endDate: '2026-10-27' }, 'Afspraak verplaatst');
    expect(toast).toHaveBeenLastCalledWith('Afspraak verplaatst');
    store.deleteOccurrence(occ, 'all');
    expect(toast).toHaveBeenLastCalledWith('Afspraak verwijderd');
    store.deleteCalendar('work');
    expect(toast).toHaveBeenLastCalledWith('Agenda verwijderd');
  });

  test('undo, redo en instellingen tonen geen melding (dat zou een lus van meldingen geven)', async () => {
    const { store, toast } = await withToast();
    store.addEvent(newEvent);
    toast.mockClear();
    store.undo();
    store.redo();
    store.updateSettings({ weekNumbers: true });
    expect(toast).not.toHaveBeenCalled();
  });

  test('zonder melding-functie (tests, kale omgeving) werkt alles gewoon', async () => {
    const { store, state } = await freshModules();
    expect(state.hooks.undoToast).toBeUndefined();
    expect(() => store.addEvent(newEvent)).not.toThrow();
  });

  test('een geweigerde wijziging aan een alleen-lezen agenda meldt niets', async () => {
    const { store, toast } = await withToast();
    const calendar = store.addCalendar({
      name: 'X',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'other' },
    });
    store.applySync(calendar.id, [{ id: 'u', title: 'Extern', date: '2026-10-27' }]);
    toast.mockClear();
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const { data } = await import('../../../src/js/state.ts');
    const occ = occurrencesBetween(data, '2026-10-27', '2026-10-27').find((o) => !o.holiday)!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    store.deleteOccurrence(occ, 'all');
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('store: plakken', () => {
  test('plakken op een andere dag behoudt tijd en duur', async () => {
    const { state, store } = await freshModules();
    const original = store.addEvent({ ...newEvent, endTime: '15:30' });
    const copy = store.pasteEvent(original, '2026-10-30');
    expect(copy.id).not.toBe(original.id);
    expect(state.data.events.map((e) => [e.date, e.time, e.endTime])).toEqual([
      ['2026-10-26', '14:00', '15:30'],
      ['2026-10-30', '14:00', '15:30'],
    ]);
  });

  test('plakken op een tijdstip (uurraster) schuift de afspraak mee en behoudt de duur', async () => {
    const { store } = await freshModules();
    const original = store.addEvent({ ...newEvent, endTime: '15:30' });
    const copy = store.pasteEvent(original, '2026-10-28', '09:00');
    expect([copy.date, copy.time, copy.endTime]).toEqual(['2026-10-28', '09:00', '10:30']);
  });

  test('een hele-dag-afspraak blijft hele dag, ook met een tijdstip', async () => {
    const { store } = await freshModules();
    const original = store.addEvent({ title: 'Vrij', date: '2026-10-26' });
    const copy = store.pasteEvent(original, '2026-10-28', '09:00');
    expect([copy.time, copy.endTime]).toEqual(['', '']);
  });

  test('plakken zonder tijd aan het einde van de dag knipt af op 23:59', async () => {
    const { store } = await freshModules();
    const original = store.addEvent({ ...newEvent, endTime: '15:30' });
    expect(store.pasteEvent(original, '2026-10-28', '23:30').endTime).toBe('23:59');
  });

  test('een plak is een losse kopie: uitzonderingen worden niet meegenomen', async () => {
    const { store } = await freshModules();
    const series = store.addEvent({
      ...newEvent,
      repeat: { freq: 'daily', interval: 1, until: '' },
      exceptions: ['2026-10-27'],
    });
    expect(store.pasteEvent(series, '2026-11-02').exceptions).toEqual([]);
  });
});

describe('store: meerdere afspraken in één stap', () => {
  const at = async (state: Awaited<ReturnType<typeof freshModules>>['state'], date: string) => {
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    return occurrencesBetween(state.data, date, date).filter((o): o is EventOcc => !o.holiday);
  };

  test('meerdere afspraken plakken behoudt hun onderlinge afstand, in één undo-stap', async () => {
    const { state, store } = await freshModules();
    const toast = vi.fn();
    state.hooks.undoToast = toast;
    const a = store.addEvent({ title: 'A', date: '2026-10-26' });
    const b = store.addEvent({ title: 'B', date: '2026-10-28', time: '09:00', endTime: '10:00' });
    toast.mockClear();
    const copies = store.pasteEvents([b, a], '2026-11-02');
    expect(copies.map((c) => [c.title, c.date])).toEqual([
      ['B', '2026-11-04'],
      ['A', '2026-11-02'],
    ]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('2 afspraken geplakt');
    store.undo();
    expect(state.data.events).toHaveLength(2);
  });

  test('een tijdstip bij plakken geldt alleen voor één afspraak', async () => {
    const { store } = await freshModules();
    const a = store.addEvent({ title: 'A', date: '2026-10-26', time: '09:00', endTime: '10:00' });
    const b = store.addEvent({ title: 'B', date: '2026-10-26', time: '11:00', endTime: '12:00' });
    const copies = store.pasteEvents([a, b], '2026-10-30', '15:00');
    expect(copies.map((c) => c.time)).toEqual(['09:00', '11:00']);
  });

  test('meerdere verwijderen: één stap, één melding, ook bij verschillende reeksen', async () => {
    const { state, store } = await freshModules();
    const toast = vi.fn();
    state.hooks.undoToast = toast;
    store.addEvent({ title: 'A', date: '2026-10-26' });
    store.addEvent({ title: 'B', date: '2026-10-26' });
    store.addEvent({ title: 'C', date: '2026-10-26' });
    const occs = (await at(state, '2026-10-26')).filter((o) => o.title !== 'C');
    toast.mockClear();
    store.deleteOccurrences(occs, 'all');
    expect(state.data.events.map((e) => e.title)).toEqual(['C']);
    expect(toast).toHaveBeenCalledWith('2 afspraken verwijderd');
    store.undo();
    expect(state.data.events).toHaveLength(3);
  });

  test('meerdere voorkomens van dezelfde reeks met "alleen deze" krijgen elk hun uitzondering', async () => {
    const { state, store } = await freshModules();
    store.addEvent({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'daily', interval: 1, until: '' } });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occs = occurrencesBetween(state.data, '2026-10-27', '2026-10-29').filter((o): o is EventOcc => !o.holiday);
    store.deleteOccurrences(occs, 'only');
    expect(state.data.events[0].exceptions.sort()).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
  });

  test('meerdere voorkomens met "alle" bewerken de reeks maar één keer', async () => {
    const { state, store } = await freshModules();
    store.addEvent({ title: 'Yoga', date: '2026-10-26', repeat: { freq: 'daily', interval: 1, until: '' } });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occs = occurrencesBetween(state.data, '2026-10-27', '2026-10-28').filter((o): o is EventOcc => !o.holiday);
    store.editOccurrences(
      occs.map((occ) => ({ occ, values: { ...store.moveValues(occ, { days: 1 }), title: 'Yoga!' } })),
      'all',
    );
    expect(state.data.events).toHaveLength(1);
    expect(state.data.events[0].title).toBe('Yoga!');
  });

  test('alleen-lezen afspraken in een groep worden overgeslagen, de rest niet', async () => {
    const { state, store } = await freshModules();
    const external = store.addCalendar({
      name: 'X',
      source: { kind: 'feed', url: 'https://x/a.ics', provider: 'other' },
    });
    store.applySync(external.id, [{ id: 'u', title: 'Extern', date: '2026-10-26' }]);
    store.addEvent({ title: 'Eigen', date: '2026-10-26' });
    store.deleteOccurrences(await at(state, '2026-10-26'), 'all');
    expect(state.data.events.map((e) => e.title)).toEqual(['Extern']);
  });

  test('addEvents zonder afspraken doet niets zinnigs maar gaat ook niet kapot', async () => {
    const { state, store } = await freshModules();
    expect(store.addEvents([], 'niets')).toEqual([]);
    expect(state.data.events).toEqual([]);
  });
});

describe('store: foutgevallen', () => {
  test('opslaan dat mislukt wordt gelogd en breekt de pagina niet', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    agenda.save.mockRejectedValue(new Error('schijf vol'));
    const { state, store } = await freshModules();
    expect(() => store.addEvent(newEvent)).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('opslaan mislukt', expect.any(Error)));
    // de afspraak blijft in het geheugen staan
    expect(state.data.events).toHaveLength(1);
    error.mockRestore();
  });

  test.each([
    ['ontbrekend bestand', null],
    ['onzin als inhoud', 'geen object'],
    ['leeg object', {}],
  ])("laden met %s geeft de standaardagenda's", async (_name, raw) => {
    agenda.load.mockResolvedValue(raw);
    const { state, store } = await freshModules();
    await store.load();
    expect(state.data.events).toEqual([]);
    expect(state.data.calendars.map((c) => c.id)).toEqual(['home', 'work', 'birthdays', 'holidays']);
    expect(state.data.settings.weekStart).toBe(1);
  });

  test('laden zet het oude formaat om en filtert kapotte afspraken weg', async () => {
    agenda.load.mockResolvedValue([
      { id: '1', title: 'Oud', date: '2026-10-25', color: 'orange' },
      { id: '2', title: 'Zonder datum' },
      null,
    ]);
    const { state, store } = await freshModules();
    await store.load();
    expect(state.data.events.map((e) => [e.title, e.calendarId])).toEqual([['Oud', 'work']]);
  });
});

describe('sjablonen in de store', () => {
  const tpl = (name: string, id = name) => ({
    id,
    name,
    title: name,
    calendarId: 'home',
    location: '',
    notes: '',
    invitees: [],
    time: '09:00',
    duration: 60,
    alert: null,
    travel: 0,
    repeat: null,
  });

  test('toevoegen, dezelfde naam vervangt, verwijderen en ongedaan maken', async () => {
    const { state, store } = await freshModules();
    store.addTemplate(tpl('Sport'));
    store.addTemplate(tpl('Lunch'));
    store.addTemplate({ ...tpl('Sport', 'nieuw'), time: '07:00' });
    expect(state.data.settings.templates.map((t) => [t.name, t.id])).toEqual([
      ['Lunch', 'Lunch'],
      ['Sport', 'nieuw'],
    ]);
    store.removeTemplate('Lunch');
    expect(state.data.settings.templates).toHaveLength(1);
    store.undo();
    expect(state.data.settings.templates).toHaveLength(2);
    store.removeTemplate('bestaat-niet');
    expect(state.data.settings.templates).toHaveLength(2);
  });

  test('het aantal blijft begrensd en er komt een melding met ongedaan maken', async () => {
    const { state, store } = await freshModules();
    const toast = vi.fn();
    state.hooks.undoToast = toast;
    for (let i = 0; i < 55; i++) store.addTemplate(tpl(`T${i}`));
    expect(state.data.settings.templates).toHaveLength(50);
    expect(toast).toHaveBeenLastCalledWith('Sjabloon “T54” bewaard');
  });
});

describe('taken afvinken', () => {
  const addTask = async (extra: Record<string, unknown> = {}) => {
    const ctx = await freshModules();
    const ev = ctx.store.addEvent({ title: 'Belasting', date: '2026-10-27', task: true, ...extra } as never);
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = (date = '2026-10-27') =>
      occurrencesBetween(ctx.state.data, date, date).find((o) => o.id === ev.id) as EventOcc;
    return { ...ctx, ev, occ };
  };

  test('afvinken en weer openen, elk met een melding en ongedaan maken', async () => {
    const { state, store, occ } = await addTask();
    const toast = vi.fn();
    state.hooks.undoToast = toast;
    store.toggleTaskDone(occ());
    expect(state.data.events[0].doneOn).toEqual(['2026-10-27']);
    expect(toast).toHaveBeenLastCalledWith('Taak afgevinkt');
    store.toggleTaskDone(occ());
    expect(state.data.events[0].doneOn).toEqual([]);
    expect(toast).toHaveBeenLastCalledWith('Taak weer open');
    store.undo();
    expect(state.data.events[0].doneOn).toEqual(['2026-10-27']);
  });

  test('bij een herhaling telt elk voorkomen apart', async () => {
    const { state, store, occ } = await addTask({
      date: '2026-10-26',
      repeat: { freq: 'daily', interval: 1, until: '' },
    });
    store.toggleTaskDone(occ('2026-10-28'));
    expect(state.data.events[0].doneOn).toEqual(['2026-10-28']);
    store.toggleTaskDone(occ('2026-10-27'));
    expect(state.data.events[0].doneOn).toEqual(['2026-10-27', '2026-10-28']);
  });

  test("setTaskDone doet niets als de stand al klopt; gewone afspraken en alleen-lezen agenda's zijn geen taak", async () => {
    const { state, store, occ } = await addTask();
    const toast = vi.fn();
    state.hooks.undoToast = toast;
    store.setTaskDone(occ(), false);
    expect(toast).not.toHaveBeenCalled();
    const plain = store.addEvent({ title: 'Gewoon', date: '2026-10-27' });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    store.toggleTaskDone(
      occurrencesBetween(state.data, '2026-10-27', '2026-10-27').find((o) => o.id === plain.id) as EventOcc,
    );
    expect(state.data.events.find((e) => e.id === plain.id)!.doneOn).toEqual([]);
  });
});
