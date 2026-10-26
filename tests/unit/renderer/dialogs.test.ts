import { fireEvent, screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;

beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});

async function setup() {
  const modules = await freshModules();
  const dialogs = await import('../../../src/js/dialogs.ts');
  return { ...modules, dialogs, user: userEvent.setup() };
}

const eventDialog = () => document.getElementById('event-dialog') as HTMLDialogElement;

describe('afspraakdialoog', () => {
  test('een nieuwe afspraak invullen en bewaren', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26', time: '09:00', endTime: '10:00' });
    expect(eventDialog()).toHaveAttribute('open');

    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Tandarts');
    await user.type(screen.getByPlaceholderText('Locatie'), 'Utrecht');
    await user.click(screen.getByRole('button', { name: 'Voeg toe' }));

    expect(eventDialog()).not.toHaveAttribute('open');
    expect(state.data.events).toHaveLength(1);
    expect(state.data.events[0]).toMatchObject({
      title: 'Tandarts',
      location: 'Utrecht',
      date: '2026-10-26',
      time: '09:00',
      endTime: '10:00',
      calendarId: 'home',
    });
    expect(agenda.save).toHaveBeenCalledTimes(1);
    expect(state.hooks.render).toHaveBeenCalled();
  });

  test('zonder titel wordt er niets bewaard', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26' });
    await user.click(screen.getByRole('button', { name: 'Voeg toe' }));
    expect(state.data.events).toHaveLength(0);
    expect(agenda.save).not.toHaveBeenCalled();
    expect(eventDialog()).toHaveAttribute('open');
  });

  test('een einde vóór het begin wordt afgewezen met een melding', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26', time: '09:00', endTime: '10:00' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Overleg');
    const endDate = document.getElementById('e-end-date') as HTMLInputElement;
    fireEvent.change(endDate, { target: { value: '2026-10-20' } });

    await user.click(screen.getByRole('button', { name: 'Voeg toe' }));

    expect(state.data.events).toHaveLength(0);
    const field = document.getElementById('e-end-time') as HTMLInputElement;
    expect(field.validationMessage).toBe('Het einde moet na het begin liggen.');
    expect(eventDialog()).toHaveAttribute('open');
  });

  test('hele dag zet de tijdvelden uit en bewaart een afspraak zonder tijd', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Vrij');
    await user.click(document.getElementById('e-allday')!);
    expect(document.getElementById('e-start-time')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Voeg toe' }));
    expect(state.data.events[0]).toMatchObject({ title: 'Vrij', time: '', endTime: '' });
  });

  test('genodigden worden als chips toegevoegd en weer verwijderd', async () => {
    const { dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26' });
    const input = screen.getByPlaceholderText('Naam of e-mail, Enter om toe te voegen');
    await user.type(input, 'Sam{Enter}');
    await user.type(input, 'lisa@example.com{Enter}');
    const list = document.getElementById('e-invitees')!;
    expect(within(list).getByText('Sam')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Sam verwijderen' }));
    expect(within(list).queryByText('Sam')).not.toBeInTheDocument();
    expect(within(list).getByText('lisa@example.com')).toBeInTheDocument();
  });
});

describe('herhalende afspraak: bereik kiezen', () => {
  async function openSeries() {
    const ctx = await setup();
    const series = ctx.store.addEvent({
      title: 'Yoga',
      date: '2026-10-26',
      time: '19:00',
      endTime: '20:00',
      repeat: { freq: 'weekly', interval: 1, until: '' },
    });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(ctx.state.data, '2026-11-02', '2026-11-02').find((o) => o.id === series.id)!;
    if (occ.holiday) throw new Error('verwacht een afspraak');
    ctx.dialogs.openEventDialog({ occ });
    return { ...ctx, occ, series };
  }

  test('wijzigen vraagt eerst om het bereik en past dan alleen deze toe', async () => {
    const { state, user, series } = await openSeries();
    const title = screen.getByPlaceholderText('Nieuwe afspraak');
    await user.clear(title);
    await user.type(title, 'Yoga extra');
    await user.click(screen.getByRole('button', { name: 'Bewaar' }));

    const scope = document.getElementById('scope-dialog') as HTMLDialogElement;
    expect(scope).toHaveAttribute('open');
    await user.click(within(scope).getByRole('button', { name: 'Alleen deze afspraak' }));

    await vi.waitFor(() => expect(state.data.events).toHaveLength(2));
    const original = state.data.events.find((e) => e.id === series.id)!;
    expect(original.exceptions).toEqual(['2026-11-02']);
    expect(state.data.events.find((e) => e.id !== series.id)).toMatchObject({ title: 'Yoga extra', repeat: null });
  });

  test('annuleren in de bereikkeuze laat alles zoals het was', async () => {
    const { state, user } = await openSeries();
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), ' x');
    await user.click(screen.getByRole('button', { name: 'Bewaar' }));
    const scope = document.getElementById('scope-dialog') as HTMLDialogElement;
    await user.click(within(scope).getByRole('button', { name: 'Annuleer' }));
    expect(scope).not.toHaveAttribute('open');
    expect(state.data.events).toHaveLength(1);
    expect(state.data.events[0].title).toBe('Yoga');
    expect(eventDialog()).toHaveAttribute('open');
  });
});

describe('snel invoeren', () => {
  test('toont een voorbeeld en maakt de afspraak met Enter', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openQuick();
    expect(dialogs.quickOpen()).toBe(true);
    const preview = document.getElementById('q-preview')!;
    expect(preview).toHaveTextContent('Typ bijvoorbeeld');

    await user.type(document.getElementById('q-input')!, 'Tandarts morgen 14:00{Enter}');

    expect(dialogs.quickOpen()).toBe(false);
    expect(state.data.events).toHaveLength(1);
    expect(state.data.events[0]).toMatchObject({ title: 'Tandarts', time: '14:00', endTime: '15:00' });
  });

  test('een lege invoer maakt niets', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openQuick();
    await user.type(document.getElementById('q-input')!, '   {Enter}');
    expect(state.data.events).toHaveLength(0);
    expect(dialogs.quickOpen()).toBe(true);
  });
});

describe('waarschuwing bij overlap', () => {
  async function withEvents() {
    const ctx = await setup();
    ctx.store.addEvent({ title: 'Tandarts', date: '2026-10-26', time: '09:00', endTime: '10:00' });
    ctx.store.addEvent({ title: 'Lunch', date: '2026-10-26', time: '09:30', endTime: '10:30' });
    ctx.store.addEvent({ title: 'Vrij', date: '2026-10-26' });
    return ctx;
  }
  const note = () => document.getElementById('e-overlap') as HTMLElement;
  const times = (start: string, end: string) => {
    fireEvent.change(document.getElementById('e-end-time')!, { target: { value: end } });
    fireEvent.change(document.getElementById('e-start-time')!, { target: { value: start } });
  };

  test('een nieuwe afspraak die overlapt noemt de afspraken waarmee', async () => {
    const { dialogs } = await withEvents();
    dialogs.openEventDialog({ date: '2026-10-26', time: '09:15', endTime: '09:45' });
    expect(note()).toBeVisible();
    expect(note()).toHaveTextContent('Overlapt met “Tandarts” en “Lunch”');
  });

  test('geen overlap, of alleen een hele-dag-afspraak, geeft geen waarschuwing', async () => {
    const { dialogs } = await withEvents();
    dialogs.openEventDialog({ date: '2026-10-26', time: '11:00', endTime: '12:00' });
    expect(note()).not.toBeVisible();
    dialogs.openEventDialog({ date: '2026-10-26', allDay: true });
    expect(note()).not.toBeVisible();
  });

  test('aansluitende afspraken (einde = begin) overlappen niet', async () => {
    const { dialogs } = await withEvents();
    dialogs.openEventDialog({ date: '2026-10-26', time: '10:30', endTime: '11:00' });
    expect(note()).not.toBeVisible();
  });

  test('de waarschuwing volgt het aanpassen van de tijden', async () => {
    const { dialogs } = await withEvents();
    dialogs.openEventDialog({ date: '2026-10-26', time: '14:00', endTime: '15:00' });
    expect(note()).not.toBeVisible();
    times('09:00', '09:20');
    expect(note()).toBeVisible();
    expect(note()).toHaveTextContent('“Tandarts”');
    expect(note()).not.toHaveTextContent('Lunch'); // begint pas om 09:30
    times('16:00', '17:00');
    expect(note()).not.toBeVisible();
  });

  test('hele dag aanvinken verbergt de waarschuwing', async () => {
    const { dialogs, user } = await withEvents();
    dialogs.openEventDialog({ date: '2026-10-26', time: '09:15', endTime: '09:45' });
    expect(note()).toBeVisible();
    await user.click(document.getElementById('e-allday')!);
    expect(note()).not.toBeVisible();
  });

  test('een bestaande afspraak telt niet met zichzelf mee', async () => {
    const ctx = await withEvents();
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(ctx.state.data, '2026-10-26', '2026-10-26').find((o) => o.title === 'Tandarts')!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    ctx.dialogs.openEventDialog({ occ });
    expect(note()).toHaveTextContent('Overlapt met “Lunch”.');
    expect(note()).not.toHaveTextContent('Tandarts');
  });

  test('bij meer dan twee wordt het aantal overige genoemd', async () => {
    const ctx = await withEvents();
    ctx.store.addEvent({ title: 'Derde', date: '2026-10-26', time: '09:10', endTime: '09:50' });
    ctx.store.addEvent({ title: 'Vierde', date: '2026-10-26', time: '09:10', endTime: '09:50' });
    ctx.dialogs.openEventDialog({ date: '2026-10-26', time: '09:20', endTime: '09:40' });
    expect(note()).toHaveTextContent('en 2 andere');
  });

  test('een verborgen agenda telt niet mee', async () => {
    const ctx = await withEvents();
    ctx.store.setCalendarVisible('home', false);
    ctx.dialogs.openEventDialog({ date: '2026-10-26', time: '09:15', endTime: '09:45' });
    expect(note()).not.toBeVisible();
  });
});

describe('voorkeuren: automatisch vernieuwen', () => {
  const select = () => document.getElementById('s-refresh') as HTMLSelectElement;

  test('toont de huidige keuze en bewaart een nieuwe', async () => {
    const { state, dialogs } = await setup();
    dialogs.openSettings();
    expect(select().value).toBe('30');
    expect([...select().options].map((o) => o.value)).toEqual(['0', '5', '15', '30', '60', '180']);
    fireEvent.change(select(), { target: { value: '5' } });
    expect(state.data.settings.refreshMinutes).toBe(5);
    fireEvent.change(select(), { target: { value: '0' } });
    expect(state.data.settings.refreshMinutes).toBe(0);
  });

  test('een waarde uit het bestand die niet in de lijst staat blijft zichtbaar', async () => {
    const { state, dialogs } = await setup();
    state.data.settings.refreshMinutes = 7;
    dialogs.openSettings();
    expect(select().value).toBe('7');
    expect(select().selectedOptions[0].textContent).toBe('Elke 7 minuten');
  });

  test('de keuze kan met ongedaan maken worden teruggezet', async () => {
    const { state, store, dialogs } = await setup();
    dialogs.openSettings();
    fireEvent.change(select(), { target: { value: '60' } });
    store.undo();
    expect(state.data.settings.refreshMinutes).toBe(30);
  });
});

describe('voorkeuren: back-ups', () => {
  const list = () => document.getElementById('bak-list') as HTMLSelectElement;
  const restore = () => document.getElementById('bak-restore') as HTMLButtonElement;
  const status = () => document.getElementById('bak-status')!.textContent;
  const info = (name: string, events: number, at = Date.UTC(2026, 9, 26, 12, 0), beforeRestore = false) => ({
    name,
    at,
    bytes: 100,
    events,
    beforeRestore,
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('zonder back-ups: uitleg en een uitgeschakelde knop', async () => {
    const { dialogs } = await setup();
    dialogs.openSettings();
    await flush();
    expect(restore()).toBeDisabled();
    expect(list()).toBeDisabled();
    expect(status()).toContain('eerste back-up');
  });

  test('toont de back-ups met aantal afspraken en markeert die van voor een herstel', async () => {
    agenda.listBackups.mockResolvedValue([info('a.json', 1), info('b.json', 12, Date.UTC(2026, 9, 25, 9, 0), true)]);
    const { dialogs } = await setup();
    dialogs.openSettings();
    await flush();
    const labels = [...list().options].map((o) => o.textContent);
    expect(labels[0]).toContain('1 afspraak');
    expect(labels[0]).not.toContain('afspraken');
    expect(labels[1]).toContain('12 afspraken');
    expect(labels[1]).toContain('vóór een herstel');
    expect(restore()).toBeEnabled();
  });

  test('herstel stuurt de gekozen naam mee en herlaadt daarna de pagina', async () => {
    agenda.listBackups.mockResolvedValue([info('a.json', 1), info('b.json', 2)]);
    const { dialogs } = await setup();
    const { initBackups } = await import('../../../src/js/backups.ts');
    const reload = vi.fn();
    initBackups(reload);
    dialogs.openSettings();
    await flush();
    list().value = 'b.json';
    fireEvent.click(restore());
    await flush();
    expect(agenda.restoreBackup).toHaveBeenCalledWith('b.json');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('geannuleerd of mislukt: melding, geen herlaad, knop weer bruikbaar', async () => {
    agenda.listBackups.mockResolvedValue([info('a.json', 1)]);
    const { dialogs } = await setup();
    const { initBackups } = await import('../../../src/js/backups.ts');
    const reload = vi.fn();
    initBackups(reload);
    dialogs.openSettings();
    await flush();
    agenda.restoreBackup.mockResolvedValueOnce(false);
    fireEvent.click(restore());
    await flush();
    expect(status()).toBe('Niet teruggezet.');
    expect(restore()).toBeEnabled();
    agenda.restoreBackup.mockRejectedValueOnce(
      new Error("Error invoking remote method 'backups:restore': Error: Deze back-up is beschadigd."),
    );
    fireEvent.click(restore());
    await flush();
    expect(status()).toBe('Terugzetten mislukt: Deze back-up is beschadigd.');
    expect(reload).not.toHaveBeenCalled();
    expect(restore()).toBeEnabled();
  });

  test('als de lijst niet gelezen kan worden, staat dat er', async () => {
    agenda.listBackups.mockRejectedValue(new Error('kapot'));
    const { dialogs } = await setup();
    dialogs.openSettings();
    await flush();
    expect(status()).toContain('konden niet worden gelezen');
  });
});

describe('sjablonen vanuit de dialoog en de voorkeuren', () => {
  test('"Bewaar als sjabloon" bewaart de ingevulde afspraak zonder de dialoog te sluiten', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26', time: '18:00', endTime: '19:30' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Sporten');
    await user.type(screen.getByPlaceholderText('Locatie'), 'Sportschool');
    await user.click(screen.getByRole('button', { name: 'Bewaar als sjabloon' }));
    expect(state.data.settings.templates).toHaveLength(1);
    expect(state.data.settings.templates[0]).toMatchObject({
      name: 'Sporten',
      title: 'Sporten',
      location: 'Sportschool',
      time: '18:00',
      duration: 90,
    });
    expect(eventDialog()).toHaveAttribute('open');
    expect(state.data.events).toHaveLength(0);
  });

  test('zonder titel gebeurt er niets', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26' });
    await user.click(screen.getByRole('button', { name: 'Bewaar als sjabloon' }));
    expect(state.data.settings.templates).toHaveLength(0);
  });

  test('de voorkeuren tonen de sjablonen en laten ze verwijderen', async () => {
    const { state, dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-26', time: '09:00', endTime: '10:00' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Stand-up');
    await user.click(screen.getByRole('button', { name: 'Bewaar als sjabloon' }));
    eventDialog().close();
    dialogs.openSettings();
    const list = document.getElementById('tpl-list')!;
    expect(list).toHaveTextContent('Stand-up');
    expect(list).toHaveTextContent('09:00');
    await user.click(screen.getByRole('button', { name: 'Sjabloon Stand-up verwijderen' }));
    expect(state.data.settings.templates).toHaveLength(0);
    expect(list).toHaveTextContent('Nog geen sjablonen.');
  });
});

describe('overlap: zoek een vrij moment', () => {
  const overlap = () => document.getElementById('e-overlap')!;
  const field = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

  test('verplaatst naar het eerstvolgende gat met dezelfde lengte', async () => {
    const { store, dialogs, user } = await setup();
    store.addEvent({ title: 'Bezet', date: '2026-10-26', time: '10:00', endTime: '11:30' });
    store.addEvent({ title: 'Ook bezet', date: '2026-10-26', time: '11:30', endTime: '12:00' });
    dialogs.openEventDialog({ date: '2026-10-26', time: '10:30', endTime: '11:30' });
    expect(overlap()).toHaveTextContent('Overlapt met');
    await user.click(screen.getByRole('button', { name: 'Zoek een vrij moment' }));
    expect(field('e-start-date')).toBe('2026-10-26');
    expect(field('e-start-time')).toBe('12:00');
    expect(field('e-end-time')).toBe('13:00'); // zelfde lengte van een uur
    expect(overlap().hidden).toBe(true);
  });

  test('als de dag vol is, gaat het naar een volgende dag', async () => {
    const { store, dialogs, user } = await setup();
    store.addEvent({ title: 'Hele werkdag', date: '2026-10-26', time: '08:00', endTime: '21:00' });
    dialogs.openEventDialog({ date: '2026-10-26', time: '10:00', endTime: '11:00' });
    await user.click(screen.getByRole('button', { name: 'Zoek een vrij moment' }));
    expect(field('e-start-date')).toBe('2026-10-27');
    expect(field('e-start-time')).toBe('08:00');
  });

  test('de afspraak die je bewerkt blokkeert zichzelf niet', async () => {
    const { store, state, dialogs, user } = await setup();
    store.addEvent({ title: 'Ander', date: '2026-10-26', time: '09:00', endTime: '10:00' });
    const mine = store.addEvent({ title: 'Mijn afspraak', date: '2026-10-26', time: '09:30', endTime: '10:30' });
    const occ = (await import('../../../src/js/occurrences.ts'))
      .occurrencesBetween(state.data, '2026-10-26', '2026-10-26')
      .find((o) => o.id === mine.id)!;
    dialogs.openEventDialog({ occ: occ as never });
    await user.click(screen.getByRole('button', { name: 'Zoek een vrij moment' }));
    expect(field('e-start-time')).toBe('10:00'); // direct na het blok van "Ander"; niet na zichzelf
  });
});

describe('voorkeuren: extra tijdzones', () => {
  const selects = () =>
    [document.getElementById('s-clock1'), document.getElementById('s-clock2')] as HTMLSelectElement[];

  test('toont de keuzes en bewaart een of twee zones, zonder dubbelen of lege', async () => {
    const { state, dialogs } = await setup();
    dialogs.openSettings();
    expect(selects()[0].value).toBe('');
    expect(selects()[0].options[0].textContent).toBe('Geen');
    expect([...selects()[0].options].some((o) => o.value === 'America/New_York')).toBe(true);
    expect([...selects()[0].options].some((o) => o.textContent?.startsWith('Zwevend'))).toBe(false);
    fireEvent.change(selects()[0], { target: { value: 'America/New_York' } });
    expect(state.data.settings.clocks).toEqual(['America/New_York']);
    fireEvent.change(selects()[1], { target: { value: 'America/New_York' } });
    expect(state.data.settings.clocks).toEqual(['America/New_York']);
    fireEvent.change(selects()[1], { target: { value: 'Asia/Tokyo' } });
    expect(state.data.settings.clocks).toEqual(['America/New_York', 'Asia/Tokyo']);
    fireEvent.change(selects()[0], { target: { value: '' } });
    expect(state.data.settings.clocks).toEqual(['Asia/Tokyo']);
  });

  test('bij het openen staan de bewaarde zones geselecteerd', async () => {
    const { state, dialogs } = await setup();
    state.data.settings.clocks = ['Asia/Tokyo', 'America/New_York'];
    dialogs.openSettings();
    expect(selects().map((s) => s.value)).toEqual(['Asia/Tokyo', 'America/New_York']);
  });
});

describe('uitnodigen', () => {
  const mail = () => screen.getByRole('button', { name: 'Uitnodiging mailen…' });

  test('de mailknop werkt pas met een e-mailadres onder de genodigden', async () => {
    const { dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-28', time: '12:00', endTime: '13:00' });
    expect(mail()).toBeDisabled();
    const input = screen.getByPlaceholderText(/Naam of e-mail/);
    await user.type(input, 'Sam{Enter}');
    expect(mail()).toBeDisabled();
    await user.type(input, 'sam@example.com{Enter}');
    expect(mail()).toBeEnabled();
  });

  test('klikken stuurt de uitnodiging naar de mail-app', async () => {
    const { dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-28', time: '12:00', endTime: '13:00' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Lunch');
    await user.type(screen.getByPlaceholderText(/Naam of e-mail/), 'sam@example.com{Enter}');
    await user.click(mail());
    expect(agenda.composeMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['sam@example.com'], subject: 'Uitnodiging: Lunch' }),
    );
  });

  test('"Bewaar als .ics…" exporteert deze ene afspraak', async () => {
    const { dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-28', time: '12:00', endTime: '13:00' });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Bewaar als .ics…' }));
    expect(agenda.exportICS).toHaveBeenCalledTimes(1);
    const [text, name] = agenda.exportICS.mock.calls[0];
    expect(name).toBe('Lunch');
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('SUMMARY:Lunch');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  test('zonder titel exporteert de .ics-knop niets', async () => {
    const { dialogs, user } = await setup();
    dialogs.openEventDialog({ date: '2026-10-28' });
    await user.click(screen.getByRole('button', { name: 'Bewaar als .ics…' }));
    expect(agenda.exportICS).not.toHaveBeenCalled();
  });
});
