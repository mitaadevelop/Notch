import { afterEach, describe, expect, test } from 'vitest';
import { blocks, discover, fetchEvents, nearestColor, text } from '../../../src/caldav.ts';
import { startCalDav, vevent } from '../../helpers/servers.ts';
import type { FakeCalDav } from '../../helpers/servers.ts';

const auth = { username: 'sam@voorbeeld.nl', password: 'abcd-efgh-ijkl' };
let server: FakeCalDav | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});
const start = async () =>
  (server = await startCalDav({
    user: auth.username,
    password: auth.password,
    events: [vevent('a', 'Overleg & planning', '20261027T100000'), vevent('b', 'Lunch', '20261028T120000')],
  }));

describe('xml-hulpjes', () => {
  test('blocks en text negeren namespaceprefixen en decoderen entiteiten', () => {
    const xml = '<D:a><D:name>Werk &amp; Co</D:name></D:a><x:name>tweede</x:name><name>derde</name>';
    expect(blocks(xml, 'name')).toEqual(['Werk &amp; Co', 'tweede', 'derde']);
    expect(text(xml, 'name')).toBe('Werk & Co');
    expect(text(xml, 'ontbreekt')).toBe('');
  });

  test('CDATA blijft letterlijk', () => {
    expect(text('<c:data><![CDATA[A & B <x>]]></c:data>', 'data')).toBe('A & B <x>');
  });
});

describe('nearestColor', () => {
  test.each([
    ['#FF9500FF', 'orange'],
    ['#34C759', 'green'],
    ['#007AFF', 'blue'],
    ['#8E8E93', 'gray'],
    ['#FF3B30FF', 'red'],
    ['onzin', 'blue'],
    ['', 'blue'],
  ])('%s -> %s', (hex, name) => {
    expect(nearestColor(hex)).toBe(name);
  });
});

describe('discover', () => {
  test("vindt alleen agenda's met afspraken, met naam en kleur", async () => {
    const s = await start();
    const found = await discover(s.url, auth);
    expect(found).toEqual([{ url: `${s.url}/calendars/me/work/`, name: 'Werk & Co', color: 'orange' }]);
  });

  test('stuurt inloggegevens mee en doorloopt de stappen in volgorde', async () => {
    const s = await start();
    await discover(s.url, auth);
    expect(s.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'PROPFIND /',
      'PROPFIND /principals/me/',
      'PROPFIND /calendars/me/',
    ]);
    expect(s.requests.every((r) => r.auth?.startsWith('Basic '))).toBe(true);
  });

  test('een verkeerd wachtwoord geeft een begrijpelijke melding', async () => {
    const s = await start();
    await expect(discover(s.url, { ...auth, password: 'fout' })).rejects.toThrow('Inloggen mislukt');
  });

  test('een onbereikbare server geeft een melding', async () => {
    await expect(discover('http://127.0.0.1:1/', auth)).rejects.toThrow(/verbinding/);
  });

  test('een niet-beveiligd adres wordt geweigerd voordat er iets verstuurd wordt', async () => {
    await expect(discover('http://voorbeeld.nl/dav', auth)).rejects.toThrow('beveiligde');
  });
});

describe('fetchEvents', () => {
  test('geeft alle afspraken terug als één iCalendar-tekst, ook uit CDATA en met entiteiten', async () => {
    const s = await start();
    const data = await fetchEvents(s.workUrl, auth);
    expect(data.match(/BEGIN:VCALENDAR/g)).toHaveLength(2);
    expect(data).toContain('SUMMARY:Overleg & planning');
    expect(data).toContain('SUMMARY:Lunch');
  });

  test('vraagt een tijdsbereik van een jaar terug tot drie jaar vooruit', async () => {
    const s = await start();
    await fetchEvents(s.workUrl, auth, new Date('2026-10-26T12:00:00Z'));
    const report = s.requests.at(-1)!;
    expect(report.method).toBe('REPORT');
    expect(report.body).toContain('time-range start="20251026T120000Z" end="20291026T120000Z"');
  });

  test('verkeerd wachtwoord of onbekende agenda geeft een melding', async () => {
    const s = await start();
    await expect(fetchEvents(s.workUrl, { ...auth, password: 'x' })).rejects.toThrow('Inloggen mislukt');
    await expect(fetchEvents(`${s.url}/calendars/me/bestaat-niet/`, auth)).rejects.toThrow(/adres|fout/);
  });
});
