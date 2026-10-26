import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;

beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});

const FEED = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Sportclub',
  'BEGIN:VEVENT',
  'UID:t1',
  'SUMMARY:Training',
  'DTSTART:20261028T190000',
  'DTEND:20261028T200000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

async function setup() {
  const ctx = await freshModules();
  const sources = await import('../../../src/js/sources.ts');
  return { ...ctx, sources, user: userEvent.setup() };
}

const dialog = () => document.getElementById('source-dialog') as HTMLDialogElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const error = () => document.getElementById('src-error') as HTMLElement;
const submit = () => document.getElementById('src-submit') as HTMLButtonElement;

describe('agenda toevoegen: link', () => {
  test('toont per soort de juiste uitleg en velden', async () => {
    const { sources } = await setup();
    sources.openSourceDialog('google');
    expect(dialog()).toHaveAttribute('open');
    expect(document.getElementById('src-help')).toHaveTextContent('Geheim adres in iCal-indeling');
    expect(field('src-url-row')).toBeVisible();
    expect(field('src-user-row')).not.toBeVisible();

    const kind = field('src-kind') as unknown as HTMLSelectElement;
    await userEvent.selectOptions(kind, 'icloud');
    expect(document.getElementById('src-help')).toHaveTextContent('app-specifiek wachtwoord');
    expect(field('src-url-row')).not.toBeVisible();
    expect(screen.getByText('Apple ID')).toBeVisible();
    expect(field('src-server-row')).not.toBeVisible();

    await userEvent.selectOptions(kind, 'caldav');
    expect(field('src-server-row')).toBeVisible();
    await userEvent.selectOptions(kind, 'outlook');
    expect(document.getElementById('src-help')).toHaveTextContent('Een agenda publiceren');
  });

  test('een link toevoegen maakt een alleen-lezen agenda met de afspraken erin', async () => {
    agenda.fetchFeed.mockResolvedValue(FEED);
    const { state, sources, user } = await setup();
    sources.openSourceDialog('google');
    await user.type(field('src-url'), 'webcal://calendar.google.com/secret/basic.ics');
    await user.click(submit());

    // webcal:// wordt https://
    await expect.poll(() => agenda.fetchFeed.mock.calls[0]?.[0]).toBe('https://calendar.google.com/secret/basic.ics');
    await expect.poll(() => state.data.events.length).toBe(1);
    const calendar = state.data.calendars.find((c) => c.source)!;
    expect(calendar).toMatchObject({
      name: 'Sportclub', // de naam uit de feed
      source: { kind: 'feed', url: 'https://calendar.google.com/secret/basic.ics', provider: 'google' },
    });
    expect(calendar.syncedAt).toBeTypeOf('number');
    expect(state.data.events[0]).toMatchObject({ title: 'Training', calendarId: calendar.id });
    expect(dialog()).not.toHaveAttribute('open');
  });

  test('een eigen naam gaat voor de naam uit de feed; zonder naam geldt de soort', async () => {
    agenda.fetchFeed.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
    const { state, sources, user } = await setup();
    sources.openSourceDialog('outlook');
    await user.type(field('src-url'), 'https://outlook.live.com/owa/calendar/x/reachcalendar.ics');
    await user.click(submit());
    await expect.poll(() => state.data.calendars.some((c) => c.source)).toBe(true);
    expect(state.data.calendars.find((c) => c.source)?.name).toBe('Outlook');

    sources.openSourceDialog('feed');
    await user.type(field('src-url'), 'https://x/b.ics');
    await user.type(field('src-name'), 'Schoolrooster');
    await user.click(submit());
    await expect.poll(() => state.data.calendars.filter((c) => c.source).length).toBe(2);
    expect(state.data.calendars.filter((c) => c.source).map((c) => c.name)).toContain('Schoolrooster');
  });

  test('een fout van de server blijft in de dialoog staan en voegt niets toe', async () => {
    agenda.fetchFeed.mockRejectedValue(
      new Error("Error invoking remote method 'feed:fetch': Error: Deze agenda bestaat niet (meer) op dit adres."),
    );
    const { state, sources, user } = await setup();
    sources.openSourceDialog('feed');
    await user.type(field('src-url'), 'https://x/weg.ics');
    await user.click(submit());
    await expect.poll(() => error().hidden).toBe(false);
    expect(error()).toHaveTextContent('Deze agenda bestaat niet (meer) op dit adres.');
    expect(error()).not.toHaveTextContent('Error invoking');
    expect(dialog()).toHaveAttribute('open');
    expect(state.data.calendars.some((c) => c.source)).toBe(false);
    expect(submit()).toBeEnabled();
  });

  test('zonder link wordt er niets opgehaald', async () => {
    const { sources, user } = await setup();
    sources.openSourceDialog('google');
    await user.click(submit());
    await expect.poll(() => error().hidden).toBe(false);
    expect(error()).toHaveTextContent('Plak eerst de link');
    expect(agenda.fetchFeed).not.toHaveBeenCalled();
  });
});

describe('agenda toevoegen: account (iCloud, CalDAV)', () => {
  const found = [
    { url: 'https://p1.icloud.com/cal/werk/', name: 'Werk', color: 'orange' },
    { url: 'https://p1.icloud.com/cal/prive/', name: 'Privé', color: 'onbekend' },
  ];

  async function connectIcloud() {
    agenda.connectAccount.mockResolvedValue({ accountId: 'acc-1', calendars: found });
    agenda.fetchAccountCalendar.mockResolvedValue(FEED);
    const ctx = await setup();
    ctx.sources.openSourceDialog('icloud');
    await ctx.user.type(field('src-user'), 'sam@icloud.com');
    await ctx.user.type(field('src-pass'), 'abcd-efgh-ijkl-mnop');
    await ctx.user.click(submit());
    await expect.poll(() => field('src-calendars').hidden).toBe(false);
    return ctx;
  }

  test("verbinden toont de gevonden agenda's en wist het wachtwoord uit het formulier", async () => {
    await connectIcloud();
    expect(agenda.connectAccount).toHaveBeenCalledWith({
      provider: 'icloud',
      serverUrl: '',
      username: 'sam@icloud.com',
      password: 'abcd-efgh-ijkl-mnop',
    });
    expect(field('src-pass').value).toBe('');
    expect(screen.getByRole('checkbox', { name: 'Werk' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Privé' })).toBeChecked();
    expect(submit()).toHaveTextContent('Voeg toe');
    expect(field('src-user-row')).not.toBeVisible();
  });

  test("de gekozen agenda's worden toegevoegd en gevuld; het account blijft bewaard", async () => {
    const { state, user } = await connectIcloud();
    await user.click(screen.getByRole('checkbox', { name: 'Privé' })); // uitzetten
    await user.click(submit());
    await expect.poll(() => state.data.events.length).toBe(1);

    const added = state.data.calendars.filter((c) => c.source);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name: 'Werk',
      color: 'orange',
      source: {
        kind: 'caldav',
        accountId: 'acc-1',
        calendarUrl: 'https://p1.icloud.com/cal/werk/',
        provider: 'icloud',
      },
    });
    expect(agenda.fetchAccountCalendar).toHaveBeenCalledWith('acc-1', 'https://p1.icloud.com/cal/werk/');
    expect(agenda.removeAccount).not.toHaveBeenCalled();
    expect(dialog()).not.toHaveAttribute('open');
  });

  test('een onbekende serverkleur valt terug op een kleur uit de app', async () => {
    const { state, user } = await connectIcloud();
    await user.click(screen.getByRole('checkbox', { name: 'Werk' }));
    await user.click(submit());
    await expect.poll(() => state.data.calendars.some((c) => c.name === 'Privé')).toBe(true);
    const color = state.data.calendars.find((c) => c.name === 'Privé' && c.source)!.color;
    expect(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'gray']).toContain(color);
  });

  test('niets aanvinken geeft een melding', async () => {
    const { user } = await connectIcloud();
    await user.click(screen.getByRole('checkbox', { name: 'Werk' }));
    await user.click(screen.getByRole('checkbox', { name: 'Privé' }));
    await user.click(submit());
    await expect.poll(() => error().hidden).toBe(false);
    expect(error()).toHaveTextContent('Kies minstens één agenda');
  });

  test('annuleren na het verbinden verwijdert het opgeslagen account weer', async () => {
    const { user } = await connectIcloud();
    await user.click(document.getElementById('src-cancel')!);
    await expect.poll(() => agenda.removeAccount.mock.calls.length).toBe(1);
    expect(agenda.removeAccount).toHaveBeenCalledWith('acc-1');
  });

  test('een verkeerd wachtwoord blijft op het inlogscherm met een melding', async () => {
    agenda.connectAccount.mockRejectedValue(
      new Error(
        "Error invoking remote method 'account:connect': Error: Inloggen mislukt: controleer de gebruikersnaam en het (app-specifieke) wachtwoord.",
      ),
    );
    const { state, sources, user } = await setup();
    sources.openSourceDialog('icloud');
    await user.type(field('src-user'), 'sam@icloud.com');
    await user.type(field('src-pass'), 'fout');
    await user.click(submit());
    await expect.poll(() => error().hidden).toBe(false);
    expect(error()).toHaveTextContent('Inloggen mislukt');
    expect(field('src-calendars').hidden).toBe(true);
    expect(state.data.calendars.some((c) => c.source)).toBe(false);
    expect(submit()).toHaveTextContent('Verbind');
  });

  test('CalDAV geeft het ingevulde serveradres door', async () => {
    agenda.connectAccount.mockResolvedValue({ accountId: 'acc-2', calendars: found });
    const { sources, user } = await setup();
    sources.openSourceDialog('caldav');
    await user.type(field('src-server'), 'https://cloud.voorbeeld.nl/dav');
    await user.type(field('src-user'), 'sam');
    await user.type(field('src-pass'), 'geheim');
    await user.click(submit());
    await expect.poll(() => agenda.connectAccount.mock.calls.length).toBe(1);
    expect(agenda.connectAccount.mock.calls[0][0]).toMatchObject({
      provider: 'caldav',
      serverUrl: 'https://cloud.voorbeeld.nl/dav',
    });
  });
});
