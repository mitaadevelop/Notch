import { beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
});

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Sportclub',
  'BEGIN:VEVENT',
  'UID:a',
  'SUMMARY:Training',
  'DTSTART:20261028T190000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b',
  'SUMMARY:Wedstrijd',
  'DTSTART:20261031T140000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// een DataTransfer-nabootsing met alleen wat de dropzone leest
const transfer = (files: File[] = [], text: Record<string, string> = {}) =>
  ({
    files,
    types: [...(files.length ? ['Files'] : []), ...Object.keys(text)],
    getData: (type: string) => text[type] ?? '',
  }) as unknown as DataTransfer;

async function setup() {
  const ctx = await freshModules();
  await import('../../../src/js/dialogs.ts');
  const sources = await import('../../../src/js/sources.ts');
  const open = vi.spyOn(sources, 'openSourceDialog');
  const drop = await import('../../../src/js/dropzone.ts');
  const toast = vi.fn();
  return { ...ctx, drop, toast, open };
}

describe('looksLikeCalendarUrl', () => {
  test.each([
    ['webcal://calendar.google.com/x/basic.ics', true],
    ['WEBCALS://voorbeeld.nl/agenda', true],
    ['https://voorbeeld.nl/rooster.ics', true],
    ['https://voorbeeld.nl/rooster.ics?token=abc', true],
    ['https://calendar.google.com/calendar/ical/abc/private-xyz/basic.ics', true],
    ['https://calendar.google.com/calendar/ical/abc/public', true],
    ['  https://voorbeeld.nl/a.ics\n', true],
    ['https://voorbeeld.nl/', false],
    ['https://voorbeeld.nl/pagina.html', false],
    ['ftp://voorbeeld.nl/a.ics', false],
    ['file:///etc/passwd.ics', false],
    ['javascript:alert(1)', false],
    ['geen url', false],
    ['', false],
  ])('%j -> %s', async (url, expected) => {
    const { drop } = await setup();
    expect(drop.looksLikeCalendarUrl(url)).toBe(expected);
  });
});

describe('kindForUrl', () => {
  test.each([
    ['https://calendar.google.com/calendar/ical/x/basic.ics', 'google'],
    ['webcal://calendar.google.com/calendar/ical/x/basic.ics', 'google'],
    ['https://outlook.live.com/owa/calendar/x/reachcalendar.ics', 'outlook'],
    ['https://outlook.office365.com/owa/calendar/x/cal.ics', 'outlook'],
    ['https://voorbeeld.nl/rooster.ics', 'feed'],
    ['webcal://p12-caldav.icloud.com/published/2/x', 'feed'],
    ['onzin', 'feed'],
  ])('%s -> %s', async (url, kind) => {
    const { drop } = await setup();
    expect(drop.kindForUrl(url)).toBe(kind);
  });
});

describe('handleDrop', () => {
  test('een .ics-bestand wordt een eigen agenda met zijn afspraken', async () => {
    const { drop, state, toast } = await setup();
    await drop.handleDrop(transfer([new File([ICS], 'rooster.ics', { type: 'text/calendar' })]), toast);
    expect(state.data.events.map((e) => e.title)).toEqual(['Training', 'Wedstrijd']);
    expect(state.data.calendars.some((c) => c.name === 'Sportclub')).toBe(true);
    expect(toast).toHaveBeenCalledWith('2 afspraken geïmporteerd.');
  });

  test('zonder naam in het bestand wordt de bestandsnaam de agendanaam', async () => {
    const { drop, state, toast } = await setup();
    const text = ICS.replace('X-WR-CALNAME:Sportclub\r\n', '');
    await drop.handleDrop(transfer([new File([text], 'Schoolrooster.ics')]), toast);
    expect(state.data.calendars.some((c) => c.name === 'Schoolrooster')).toBe(true);
  });

  test('meerdere bestanden: elk een eigen agenda, het totaal in de melding', async () => {
    const { drop, state, toast } = await setup();
    await drop.handleDrop(
      transfer([new File([ICS], 'een.ics'), new File([ICS.replace('Sportclub', 'Muziek')], 'twee.ics')]),
      toast,
    );
    expect(state.data.events).toHaveLength(4);
    expect(toast).toHaveBeenCalledWith('4 afspraken geïmporteerd.');
  });

  test('een bestand zonder afspraken geeft een duidelijke melding', async () => {
    const { drop, state, toast } = await setup();
    await drop.handleDrop(transfer([new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR'], 'leeg.ics')]), toast);
    expect(state.data.events).toEqual([]);
    expect(toast).toHaveBeenCalledWith('Geen afspraken gevonden in het bestand.');
  });

  test('een ander soort bestand wordt geweigerd', async () => {
    const { drop, state, toast } = await setup();
    await drop.handleDrop(transfer([new File(['x'], 'foto.png', { type: 'image/png' })]), toast);
    expect(toast).toHaveBeenCalledWith('Alleen .ics-bestanden kunnen worden geïmporteerd.');
    expect(state.data.events).toEqual([]);
  });

  test('een te groot bestand wordt niet gelezen', async () => {
    const { drop, state, toast } = await setup();
    const big = new File([ICS], 'groot.ics');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    const text = vi.spyOn(big, 'text');
    await drop.handleDrop(transfer([big]), toast);
    expect(text).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Dit bestand is te groot (meer dan 5 MB).');
    expect(state.data.events).toEqual([]);
  });

  test('een mix: de goede bestanden worden gelezen, het te grote overgeslagen', async () => {
    const { drop, state, toast } = await setup();
    const big = new File([ICS], 'groot.ics');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await drop.handleDrop(transfer([big, new File([ICS], 'goed.ics')]), toast);
    expect(state.data.events).toHaveLength(2);
  });

  test('een webcal-link opent de dialoog met het adres alvast ingevuld', async () => {
    const { drop, open, toast } = await setup();
    await drop.handleDrop(
      transfer([], { 'text/uri-list': 'webcal://calendar.google.com/calendar/ical/x/basic.ics' }),
      toast,
    );
    expect(open).toHaveBeenCalledWith('google', 'webcal://calendar.google.com/calendar/ical/x/basic.ics');
    expect((document.getElementById('src-url') as HTMLInputElement).value).toBe(
      'webcal://calendar.google.com/calendar/ical/x/basic.ics',
    );
    expect(document.getElementById('source-dialog')).toHaveAttribute('open');
  });

  test('een link als gewone tekst werkt ook, en commentaar in een uri-list wordt overgeslagen', async () => {
    const { drop, open, toast } = await setup();
    await drop.handleDrop(
      transfer([], { 'text/uri-list': '# een commentaar\r\nhttps://voorbeeld.nl/rooster.ics' }),
      toast,
    );
    expect(open).toHaveBeenLastCalledWith('feed', 'https://voorbeeld.nl/rooster.ics');
    await drop.handleDrop(transfer([], { 'text/plain': 'https://voorbeeld.nl/ander.ics' }), toast);
    expect(open).toHaveBeenLastCalledWith('feed', 'https://voorbeeld.nl/ander.ics');
  });

  test('een link die geen agenda is, of gewone tekst, geeft een melding en opent niets', async () => {
    const { drop, open, toast } = await setup();
    await drop.handleDrop(transfer([], { 'text/uri-list': 'https://voorbeeld.nl/nieuws.html' }), toast);
    expect(toast).toHaveBeenCalledWith('Dit is geen agenda-link (.ics of webcal://).');
    expect(open).not.toHaveBeenCalled();
  });

  test('een lege drop (of geen dataTransfer) doet niets', async () => {
    const { drop, toast } = await setup();
    await drop.handleDrop(null, toast);
    await drop.handleDrop(transfer(), toast);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('initDropzone: eigen en vreemde sleepacties', () => {
  const dropEvent = (types: string[], text = 'x') => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    event.dataTransfer = { types, files: [], getData: () => text };
    return event;
  };

  test('een versleepte eigen afspraak wordt genegeerd (niet tegengehouden, geen melding)', async () => {
    const { drop, toast } = await setup();
    const { INTERNAL_DRAG } = await import('../../../src/js/occ-ui.ts');
    drop.initDropzone(toast);
    const event = dropEvent(['text/plain', INTERNAL_DRAG], 'abc@2026-10-26');
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    expect(document.getElementById('drop-overlay')).toBeNull();
  });

  test('een link van buiten wordt wel afgehandeld en nooit door de browser geopend', async () => {
    const { drop, toast } = await setup();
    drop.initDropzone(toast);
    const event = dropEvent(['text/plain'], 'https://voorbeeld.nl/nieuws');
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(toast).toHaveBeenCalledWith('Dit is geen agenda-link (.ics of webcal://).');
  });
});
