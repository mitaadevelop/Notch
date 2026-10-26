// dialoog "Agenda toevoegen": Google, Outlook, iCloud, een willekeurige link of een CalDAV-server
import type { Calendar, CalendarSource, ColorName, RemoteCalendar } from '../shared/types.ts';
import { parseICS } from './ics.ts';
import { COLOR_NAMES } from './model.ts';
import { data } from './state.ts';
import * as store from './store.ts';
import { errorMessage, syncCalendar } from './sync.ts';
import { $, el } from './util.ts';

export type Kind = 'google' | 'outlook' | 'icloud' | 'feed' | 'caldav';

const HELP: Record<Kind, string> = {
  google:
    'Open Google Agenda op de computer → Instellingen → kies de agenda → “Geheim adres in iCal-indeling” en plak die link hieronder. De agenda is alleen-lezen en ververst zichzelf.',
  outlook:
    'Open Outlook op het web → Instellingen → Agenda → Gedeelde agenda’s → “Een agenda publiceren”, kies de agenda en “ICS”, en plak de link hieronder. De agenda is alleen-lezen en ververst zichzelf.',
  icloud:
    'Log in met uw Apple ID en een app-specifiek wachtwoord (maak er een op appleid.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden). Uw gewone wachtwoord werkt hier niet. Het wachtwoord wordt versleuteld bewaard.',
  feed: 'Plak de link naar een .ics-bestand of webcal-adres (schoolrooster, sportclub, gedeelde agenda, …). De agenda is alleen-lezen en ververst zichzelf.',
  caldav:
    'Voor Nextcloud, Fastmail, Synology en andere CalDAV-servers. Vul het adres van de server, uw gebruikersnaam en wachtwoord in. Het wachtwoord wordt versleuteld bewaard.',
};

const LABEL: Record<Kind, string> = {
  google: 'Google Agenda',
  outlook: 'Outlook',
  icloud: 'iCloud',
  feed: 'Agenda',
  caldav: 'CalDAV',
};

const f = {
  dialog: $<HTMLDialogElement>('source-dialog'),
  form: $<HTMLFormElement>('source-form'),
  kind: $<HTMLSelectElement>('src-kind'),
  help: $('src-help'),
  urlRow: $('src-url-row'),
  url: $<HTMLInputElement>('src-url'),
  serverRow: $('src-server-row'),
  server: $<HTMLInputElement>('src-server'),
  userRow: $('src-user-row'),
  userLabel: $('src-user-label'),
  user: $<HTMLInputElement>('src-user'),
  passRow: $('src-pass-row'),
  pass: $<HTMLInputElement>('src-pass'),
  name: $<HTMLInputElement>('src-name'),
  nameRow: $('src-name-row'),
  calendars: $<HTMLFieldSetElement>('src-calendars'),
  error: $('src-error'),
  cancel: $<HTMLButtonElement>('src-cancel'),
  submit: $<HTMLButtonElement>('src-submit'),
};

// na het inloggen: de gevonden agenda's om uit te kiezen
let pending: { accountId: string; provider: 'icloud' | 'caldav'; found: RemoteCalendar[] } | null = null;

const kind = () => f.kind.value as Kind;
const isAccount = () => kind() === 'icloud' || kind() === 'caldav';
const nextColor = (): ColorName => COLOR_NAMES[data.calendars.length % COLOR_NAMES.length];

function showError(message: string) {
  f.error.textContent = message;
  f.error.hidden = !message;
}

function syncFields() {
  const k = kind();
  f.help.textContent = HELP[k];
  f.urlRow.hidden = isAccount();
  f.serverRow.hidden = k !== 'caldav';
  f.userRow.hidden = f.passRow.hidden = !isAccount();
  f.userLabel.textContent = k === 'icloud' ? 'Apple ID' : 'Gebruikersnaam';
  $('src-pass-label').textContent = k === 'icloud' ? 'App-specifiek wachtwoord' : 'Wachtwoord';
  const listing = pending !== null;
  f.calendars.hidden = !listing;
  for (const row of [f.serverRow, f.userRow, f.passRow]) row.hidden = row.hidden || listing;
  f.nameRow.hidden = isAccount();
  f.kind.disabled = listing;
  f.submit.textContent = listing ? 'Voeg toe' : isAccount() ? 'Verbind' : 'Voeg toe';
}

async function forgetPending() {
  if (!pending) return;
  const { accountId } = pending;
  pending = null;
  await window.agenda.removeAccount(accountId).catch(() => {});
}

// `url` vult het adres alvast in (bijv. bij het loslaten van een agenda-link op het venster)
export function openSourceDialog(initial: Kind = 'google', url = '') {
  pending = null;
  f.kind.value = initial;
  for (const input of [f.url, f.server, f.user, f.pass, f.name]) input.value = '';
  f.url.value = url;
  f.calendars.replaceChildren(f.calendars.querySelector('legend')!);
  f.submit.disabled = false;
  showError('');
  syncFields();
  f.dialog.showModal();
  (isAccount() ? f.user : f.url).focus();
}

function listFound(found: RemoteCalendar[]) {
  const legend = f.calendars.querySelector('legend')!;
  f.calendars.replaceChildren(legend);
  found.forEach((calendar, index) => {
    const label = el('label', 'flex items-center gap-2 text-sm');
    const box = el('input', 'size-4 accent-accent');
    box.type = 'checkbox';
    box.checked = true;
    box.value = String(index);
    label.append(box, el('span', 'min-w-0 truncate', calendar.name));
    f.calendars.append(label);
  });
}

async function addFeed() {
  const k = kind();
  const url = f.url.value.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!url) throw new Error('Plak eerst de link van de agenda.');
  const text = await window.agenda.fetchFeed(url);
  const parsed = parseICS(text);
  const provider = k === 'google' || k === 'outlook' || k === 'icloud' ? k : 'other';
  const source: CalendarSource = { kind: 'feed', url, provider };
  const calendar = store.addCalendar({
    name: f.name.value.trim() || parsed.name || LABEL[k],
    color: nextColor(),
    source,
  });
  store.applySync(calendar.id, parsed.events);
}

async function connect() {
  const k = kind() as 'icloud' | 'caldav';
  const result = await window.agenda.connectAccount({
    provider: k,
    serverUrl: f.server.value,
    username: f.user.value,
    password: f.pass.value,
  });
  pending = { accountId: result.accountId, provider: k, found: result.calendars };
  listFound(result.calendars);
  f.pass.value = ''; // het wachtwoord ligt nu versleuteld in main; hier hoeft het niet te blijven staan
  syncFields();
}

async function addChosen() {
  const chosen = pending;
  if (!chosen) return;
  const picked = [...f.calendars.querySelectorAll<HTMLInputElement>('input:checked')].map(
    (box) => chosen.found[Number(box.value)],
  );
  if (!picked.length) throw new Error('Kies minstens één agenda.');
  const added: Calendar[] = picked.map((remote) =>
    store.addCalendar({
      name: remote.name,
      color: (COLOR_NAMES as string[]).includes(remote.color) ? (remote.color as ColorName) : nextColor(),
      source: { kind: 'caldav', accountId: chosen.accountId, calendarUrl: remote.url, provider: chosen.provider },
    }),
  );
  pending = null; // het account blijft bewaard: er hangen nu agenda's aan
  for (const calendar of added) await syncCalendar(calendar);
}

f.kind.addEventListener('change', () => {
  showError('');
  syncFields();
});

f.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  f.submit.disabled = true;
  const label = f.submit.textContent;
  f.submit.textContent = 'Bezig…';
  try {
    if (pending) await addChosen();
    else if (isAccount()) await connect();
    else await addFeed();
    if (!pending) f.dialog.close();
  } catch (error) {
    showError(errorMessage(error));
    f.submit.textContent = label;
  } finally {
    f.submit.disabled = false;
    syncFields();
  }
});

// annuleren (knop, Escape of buiten klikken) ruimt een half voltooid account op
f.dialog.addEventListener('close', () => void forgetPending());
f.cancel.addEventListener('click', () => f.dialog.close());
f.dialog.addEventListener('click', (e) => {
  if (e.target === f.dialog) f.dialog.close();
});
