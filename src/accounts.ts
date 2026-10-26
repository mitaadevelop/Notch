// bewaart agenda-accounts: het wachtwoord versleuteld met het sleutelmanagement van het besturingssysteem
// (macOS-sleutelhanger, Windows DPAPI, Linux-sleutelbos). Nooit in events.json en nooit terug naar de pagina.
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discover, fetchEvents } from './caldav.ts';
import type { FoundCalendar } from './caldav.ts';
import { parseSecureUrl } from './net.ts';
import type { AccountRequest, AccountResult } from './shared/types.ts';

interface Stored {
  provider: string;
  serverUrl: string;
  username: string;
  secret: string; // base64 van het versleutelde wachtwoord
  hosts: string[]; // alleen hierheen worden de inloggegevens gestuurd
}

const file = () => path.join(app.getPath('userData'), 'accounts.json');

async function readAll(): Promise<Record<string, Stored>> {
  try {
    const data: unknown = JSON.parse(await fs.readFile(file(), 'utf8'));
    return data && typeof data === 'object' ? (data as Record<string, Stored>) : {};
  } catch {
    return {};
  }
}

async function writeAll(all: Record<string, Stored>) {
  const target = file();
  const tmp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
}

function assertEncryption() {
  const weak = process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text';
  if (!safeStorage.isEncryptionAvailable() || weak) {
    throw new Error('Wachtwoorden veilig opslaan kan op dit systeem niet (geen sleutelhanger beschikbaar).');
  }
}

const SERVERS: Record<AccountRequest['provider'], string> = {
  icloud: 'https://caldav.icloud.com/',
  caldav: '',
};

// logt in, zoekt de agenda's en bewaart het account alleen als dat gelukt is
export async function connect(request: AccountRequest): Promise<AccountResult> {
  const serverUrl = request.provider === 'icloud' ? SERVERS.icloud : String(request.serverUrl ?? '').trim();
  const username = String(request.username ?? '').trim();
  const password = String(request.password ?? '');
  if (!serverUrl) throw new Error('Vul het serveradres in.');
  if (!username || !password) throw new Error('Vul gebruikersnaam en wachtwoord in.');
  assertEncryption();

  const calendars = await discover(serverUrl, { username, password });
  if (!calendars.length) throw new Error('Er zijn geen agenda’s met afspraken gevonden in dit account.');

  const id = randomUUID();
  const hosts = new Set([parseSecureUrl(serverUrl).host, ...calendars.map((c: FoundCalendar) => new URL(c.url).host)]);
  const all = await readAll();
  all[id] = {
    provider: request.provider,
    serverUrl,
    username,
    secret: safeStorage.encryptString(password).toString('base64'),
    hosts: [...hosts],
  };
  await writeAll(all);
  return { accountId: id, calendars };
}

export async function fetchAccountEvents(accountId: string, calendarUrl: string): Promise<string> {
  const stored = (await readAll())[accountId];
  if (!stored) throw new Error('Dit account is niet meer beschikbaar. Voeg het opnieuw toe.');
  // de pagina kan het adres wijzigen: stuur het wachtwoord nooit naar een andere server dan bij het inloggen bekend was
  if (!stored.hosts.includes(new URL(calendarUrl).host))
    throw new Error('Dit agenda-adres hoort niet bij het account.');
  assertEncryption();
  const password = safeStorage.decryptString(Buffer.from(stored.secret, 'base64'));
  return fetchEvents(calendarUrl, { username: stored.username, password });
}

export async function removeAccount(accountId: string) {
  const all = await readAll();
  if (!(accountId in all)) return;
  delete all[accountId];
  await writeAll(all);
}
