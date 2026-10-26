import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startCalDav, vevent } from '../../helpers/servers.ts';
import type { FakeCalDav } from '../../helpers/servers.ts';
import { electronMock, electronState, safeStorage } from './electron-mock.ts';

vi.mock('electron', () => electronMock);

const PASSWORD = 'abcd-efgh-ijkl';
let server: FakeCalDav;

beforeEach(async () => {
  electronState.userData = mkdtempSync(path.join(tmpdir(), 'agenda-acc-'));
  safeStorage.available = true;
  server = await startCalDav({
    user: 'sam@voorbeeld.nl',
    password: PASSWORD,
    events: [vevent('a', 'Overleg', '20261027T100000')],
  });
});

afterEach(async () => {
  await server.close();
  rmSync(electronState.userData, { recursive: true, force: true });
});

const load = () => import('../../../src/accounts.ts');
const request = () => ({
  provider: 'caldav' as const,
  serverUrl: server.url,
  username: 'sam@voorbeeld.nl',
  password: PASSWORD,
});
const accountsFile = () => path.join(electronState.userData, 'accounts.json');

describe('accounts', () => {
  test('verbinden bewaart het account met een versleuteld wachtwoord', async () => {
    const { connect } = await load();
    const result = await connect(request());
    expect(result.calendars.map((c) => c.name)).toEqual(['Werk & Co']);
    expect(result.accountId).toMatch(/^[0-9a-f-]{36}$/);
    const raw = readFileSync(accountsFile(), 'utf8');
    expect(raw).not.toContain(PASSWORD);
    expect(raw).toContain('sam@voorbeeld.nl');
    // het resultaat voor de pagina bevat het wachtwoord nooit
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  test('afspraken ophalen gebruikt het opgeslagen wachtwoord', async () => {
    const { connect, fetchAccountEvents } = await load();
    const { accountId, calendars } = await connect(request());
    expect(await fetchAccountEvents(accountId, calendars[0].url)).toContain('SUMMARY:Overleg');
    expect(server.requests.at(-1)!.auth).toBe(
      `Basic ${Buffer.from(`sam@voorbeeld.nl:${PASSWORD}`).toString('base64')}`,
    );
  });

  test('het wachtwoord gaat nooit naar een andere server dan bij het inloggen bekend was', async () => {
    const { connect, fetchAccountEvents } = await load();
    const { accountId } = await connect(request());
    const before = server.requests.length;
    await expect(fetchAccountEvents(accountId, 'https://kwaadaardig.example/dav/')).rejects.toThrow('hoort niet bij');
    expect(server.requests).toHaveLength(before);
  });

  test('een onbekend account geeft een melding', async () => {
    const { fetchAccountEvents } = await load();
    await expect(fetchAccountEvents('bestaat-niet', server.url)).rejects.toThrow('niet meer beschikbaar');
  });

  test('een verkeerd wachtwoord bewaart niets', async () => {
    const { connect } = await load();
    await expect(connect({ ...request(), password: 'fout' })).rejects.toThrow('Inloggen mislukt');
    expect(existsSync(accountsFile())).toBe(false);
  });

  test('zonder veilige opslag wordt er niets bewaard of verstuurd', async () => {
    safeStorage.available = false;
    const { connect } = await load();
    await expect(connect(request())).rejects.toThrow('veilig opslaan');
    expect(existsSync(accountsFile())).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  test('lege velden worden afgevangen voor er iets gebeurt', async () => {
    const { connect } = await load();
    await expect(connect({ ...request(), username: ' ' })).rejects.toThrow('gebruikersnaam');
    await expect(connect({ ...request(), serverUrl: '' })).rejects.toThrow('serveradres');
    expect(server.requests).toHaveLength(0);
  });

  test('verwijderen haalt het account weg', async () => {
    const { connect, fetchAccountEvents, removeAccount } = await load();
    const { accountId, calendars } = await connect(request());
    await removeAccount(accountId);
    await removeAccount(accountId); // tweede keer is geen fout
    await expect(fetchAccountEvents(accountId, calendars[0].url)).rejects.toThrow('niet meer beschikbaar');
  });
});
