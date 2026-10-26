// minimale CalDAV-client (alleen lezen): agenda's zoeken en afspraken ophalen, bijv. iCloud, Nextcloud, Fastmail
import { parseSecureUrl, request } from './net.ts';

export interface Auth {
  username: string;
  password: string;
}

export interface FoundCalendar {
  url: string;
  name: string;
  color: string;
}

// --- piepkleine XML-hulpjes: de antwoorden zijn regelmatig genoeg, en namespaceprefixen verschillen per server ---

const tag = (name: string) => `(?:[\\w-]+:)?${name}`;

export function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${tag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag(name)}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner: string) => inner.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#13;|&#xD;/gi, '\r')
    .replace(/&#10;|&#xA;/gi, '\n')
    .replace(/&amp;/g, '&');

export const text = (xml: string, name: string) => {
  const found = blocks(xml, name)[0];
  return found === undefined ? '' : decode(found).trim();
};

// href: pad of volledige url; los op ten opzichte van de pagina waar hij vandaan kwam
const resolve = (href: string, base: URL) => new URL(href, base).toString();

const basic = (a: Auth) => `Basic ${Buffer.from(`${a.username}:${a.password}`).toString('base64')}`;

async function dav(url: URL, method: string, body: string, auth: Auth, depth: '0' | '1') {
  const reply = await request(url, {
    method,
    headers: { Authorization: basic(auth), Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (reply.status === 401 || reply.status === 403) {
    throw new Error('Inloggen mislukt: controleer de gebruikersnaam en het (app-specifieke) wachtwoord.');
  }
  if (reply.status === 404) throw new Error('De server kent dit adres niet. Controleer het serveradres.');
  if (reply.status >= 400) throw new Error(`De server gaf een fout (${reply.status}).`);
  return reply.text;
}

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"';
const propfind = (props: string) => `<?xml version="1.0"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;

// kleurnamen van de app, met hun (lichte) hexwaarde, om een serverkleur op te vertalen
const PALETTE: Record<string, [number, number, number]> = {
  red: [0xff, 0x3b, 0x30],
  orange: [0xff, 0x95, 0x00],
  yellow: [0xff, 0xcc, 0x00],
  green: [0x34, 0xc7, 0x59],
  blue: [0x00, 0x7a, 0xff],
  purple: [0xaf, 0x52, 0xde],
  brown: [0xa2, 0x84, 0x5e],
  gray: [0x8e, 0x8e, 0x93],
};

export function nearestColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return 'blue';
  const rgb = [m[1], m[2], m[3]].map((v) => parseInt(v, 16));
  let best = 'blue';
  let bestDistance = Infinity;
  for (const [name, c] of Object.entries(PALETTE)) {
    const distance = c.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (distance < bestDistance) [best, bestDistance] = [name, distance];
  }
  return best;
}

// 1) wie ben ik, 2) waar staan mijn agenda's, 3) welke agenda's zijn er
export async function discover(serverUrl: string, auth: Auth): Promise<FoundCalendar[]> {
  const server = parseSecureUrl(serverUrl);

  const principalXml = await dav(server, 'PROPFIND', propfind('<d:current-user-principal/>'), auth, '0');
  const principalHref = text(blocks(principalXml, 'current-user-principal')[0] ?? '', 'href');
  const principal = principalHref ? new URL(resolve(principalHref, server)) : server;

  const homeXml = await dav(principal, 'PROPFIND', propfind('<c:calendar-home-set/>'), auth, '0');
  const homeHref = text(blocks(homeXml, 'calendar-home-set')[0] ?? '', 'href');
  if (!homeHref) throw new Error('Geen agenda-account gevonden op deze server.');
  const home = new URL(resolve(homeHref, principal));
  parseSecureUrl(home.toString()); // ook de agenda-host moet beveiligd zijn

  const listXml = await dav(
    home,
    'PROPFIND',
    propfind('<d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/>'),
    auth,
    '1',
  );

  const found: FoundCalendar[] = [];
  for (const response of blocks(listXml, 'response')) {
    const href = text(response, 'href');
    const type = blocks(response, 'resourcetype')[0] ?? '';
    if (!href || !new RegExp(`<${tag('calendar')}\\s*/?>`, 'i').test(type)) continue;
    const components = blocks(response, 'supported-calendar-component-set')[0];
    if (components !== undefined && !/name=["']VEVENT["']/i.test(components)) continue;
    const url = resolve(href, home);
    found.push({
      url,
      name: text(response, 'displayname') || decodeURIComponent(url.split('/').filter(Boolean).pop() ?? 'Agenda'),
      color: nearestColor(text(response, 'calendar-color')),
    });
  }
  return found;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

// alle afspraken van een agenda, van een jaar terug tot drie jaar vooruit, als één groot iCalendar-bestand
export async function fetchEvents(calendarUrl: string, auth: Auth, now = new Date()): Promise<string> {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + 3);
  const body =
    `<?xml version="1.0"?><c:calendar-query ${NS}><d:prop><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const xml = await dav(parseSecureUrl(calendarUrl), 'REPORT', body, auth, '1');
  return blocks(xml, 'calendar-data')
    .map(decode)
    .filter((data) => /BEGIN:VCALENDAR/i.test(data))
    .join('\r\n');
}
