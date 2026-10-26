import { afterEach, describe, expect, test } from 'vitest';
import { fetchFeed, parseSecureUrl, parseWebUrl } from '../../../src/net.ts';
import { calendarText, startFeed, vevent } from '../../helpers/servers.ts';

describe('adressen', () => {
  test('webcal:// wordt https://', () => {
    expect(parseWebUrl('webcal://voorbeeld.nl/a.ics').toString()).toBe('https://voorbeeld.nl/a.ics');
    expect(parseWebUrl('WEBCALS://voorbeeld.nl/a.ics').protocol).toBe('https:');
    expect(parseWebUrl('  https://voorbeeld.nl/a.ics  ').hostname).toBe('voorbeeld.nl');
  });

  test.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y.ics', 'geen url', ''])(
    '%j wordt geweigerd',
    (raw) => {
      expect(() => parseWebUrl(raw)).toThrow();
    },
  );

  test('inloggen mag alleen via https, of naar de eigen computer', () => {
    expect(() => parseSecureUrl('http://voorbeeld.nl/dav')).toThrow('beveiligde');
    expect(parseSecureUrl('https://voorbeeld.nl/dav').protocol).toBe('https:');
    expect(parseSecureUrl('http://127.0.0.1:8080/dav').hostname).toBe('127.0.0.1');
    expect(parseSecureUrl('http://localhost:8080/dav').hostname).toBe('localhost');
  });
});

describe('fetchFeed', () => {
  const servers: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });
  const feed = async (init: Parameters<typeof startFeed>[0]) => {
    const server = await startFeed(init);
    servers.push(server);
    return server;
  };

  test('haalt de tekst van een agenda op', async () => {
    const body = calendarText('Test', vevent('1', 'Tandarts', '20261026T100000'));
    const server = await feed({ body });
    expect(await fetchFeed(server.calendarUrl)).toBe(body);
  });

  test('een webcal-adres werkt ook (via https, dus hier geen server)', async () => {
    await expect(fetchFeed('webcal://127.0.0.1:1/x.ics')).rejects.toThrow(/verbinding/);
  });

  test.each([
    [404, 'bestaat niet'],
    [410, 'bestaat niet'],
    [403, 'Geen toegang'],
    [500, 'fout (500)'],
  ])('status %i geeft een duidelijke melding', async (status, message) => {
    const server = await feed({ status, body: 'x' });
    await expect(fetchFeed(server.calendarUrl)).rejects.toThrow(message);
  });

  test('een pagina die geen agenda is wordt herkend', async () => {
    const server = await feed({ body: '<html>Inloggen</html>' });
    await expect(fetchFeed(server.calendarUrl)).rejects.toThrow('geen agenda');
  });

  test('een ongeldig adres geeft een foutmelding in plaats van een crash', async () => {
    await expect(fetchFeed('geen adres')).rejects.toThrow('geldige');
    await expect(fetchFeed('file:///etc/passwd')).rejects.toThrow('http');
  });
});
