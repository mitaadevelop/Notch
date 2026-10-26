// kleine lokale servers voor de tests: een ics-feed en een (heel simpele) CalDAV-server
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface Running {
  url: string;
  requests: { method: string; path: string; auth: string | undefined; body: string }[];
  close(): Promise<void>;
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const requests: Running['requests'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
  return { url, requests, close };
}

export const vevent = (uid: string, summary: string, start: string, extra: string[] = []) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${start}`, ...extra, 'END:VEVENT'].join('\r\n');

export const calendarText = (name: string, ...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', `X-WR-CALNAME:${name}`, ...events, 'END:VCALENDAR'].join('\r\n');

// Open-Meteo in het klein: zoekt plaatsen en geeft een voorspelling van 14 dagen vanaf `from`; alles is aan te passen
export async function startWeather(options: { from?: string } = {}) {
  const state = {
    geoStatus: 200,
    forecastStatus: 200,
    places: {
      utrecht: { name: 'Utrecht', admin1: 'Utrecht', country: 'Nederland', latitude: 52.0908, longitude: 5.1222 },
    } as Record<string, Record<string, unknown>>,
    days: undefined as Record<string, unknown> | undefined,
  };
  const from = options.from ?? '2026-10-26';
  const server = await listen((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/v1/search') {
      const hit = state.places[(url.searchParams.get('name') ?? '').toLowerCase()];
      return json(state.geoStatus, hit ? { results: [hit] } : {});
    }
    if (url.pathname === '/v1/forecast') {
      const time = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(`${from}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
      });
      return json(
        state.forecastStatus,
        state.days ?? {
          daily: {
            time,
            weather_code: time.map((_, i) => (i === 0 ? 0 : i === 1 ? 61 : 3)),
            temperature_2m_max: time.map((_, i) => 14 - i),
            temperature_2m_min: time.map((_, i) => 6 - i),
            precipitation_probability_max: time.map((_, i) => (i === 1 ? 80 : 10)),
          },
        },
      );
    }
    json(404, {});
  });
  return { ...server, state };
}

// Een nep-Anthropic: antwoordt op POST /v1/messages met wat de test per verzoek bepaalt en onthoudt alle verzoeken
export interface AnthropicRequest {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export async function startAnthropic(
  respond: (request: AnthropicRequest, n: number) => { status?: number; body: unknown },
) {
  const seen: AnthropicRequest[] = [];
  const server = await listen((req, res, body) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return void res.end('{}');
    }
    const request = { headers: req.headers, body: JSON.parse(body || '{}') };
    seen.push(request);
    const { status = 200, body: out } = respond(request, seen.length);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  return { ...server, seen };
}

// het antwoord van de API zoals de SDK het verwacht
export const apiMessage = (
  content: unknown[],
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' = 'end_turn',
) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});
export const apiText = (text: string) => ({ type: 'text', text });
export const apiToolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

// een ics-feed waarvan de inhoud of statuscode tijdens de test te wijzigen is
export async function startFeed(initial: { status?: number; body: string; delayMs?: number }) {
  const state = { ...initial, status: initial.status ?? 200, delayMs: initial.delayMs ?? 0 };
  const server = await listen((_req, res) => {
    setTimeout(() => {
      res.writeHead(state.status, { 'Content-Type': 'text/calendar' });
      res.end(state.body);
    }, state.delayMs);
  });
  return { ...server, state, calendarUrl: `${server.url}/agenda.ics` };
}

const xml = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${body}</d:multistatus>`;

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface FakeCalDav extends Running {
  workUrl: string;
}

// Gedraagt zich als een server met één account: een agenda "Werk" met afspraken, een taken-agenda en een inbox.
export async function startCalDav(options: { user: string; password: string; events: string[] }): Promise<FakeCalDav> {
  const expected = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString('base64')}`;
  let base = '';
  const server = await listen((req, res, body) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fake"' }).end();
      return;
    }
    const path = (req.url ?? '').split('?')[0];
    const reply = (content: string) => res.writeHead(207, { 'Content-Type': 'application/xml' }).end(content);
    if (req.method === 'PROPFIND' && path === '/') {
      return reply(
        xml(
          '<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principals/me/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>',
        ),
      );
    }
    if (req.method === 'PROPFIND' && path === '/principals/me/') {
      // absolute url, zoals iCloud dat doet
      return reply(
        xml(
          `<d:response><d:href>/principals/me/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>${base}/calendars/me/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
        ),
      );
    }
    if (req.method === 'PROPFIND' && path === '/calendars/me/') {
      return reply(
        xml(
          `<d:response><d:href>/calendars/me/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
            `<d:response><d:href>/calendars/me/work/</d:href><d:propstat><d:prop><d:displayname>Werk &amp; Co</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><a:calendar-color>#FF9500FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>` +
            `<d:response><d:href>/calendars/me/tasks/</d:href><d:propstat><d:prop><d:displayname>Taken</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>` +
            `<d:response><d:href>/calendars/me/inbox/</d:href><d:propstat><d:prop><d:displayname>Inbox</d:displayname><d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype></d:prop></d:propstat></d:response>`,
        ),
      );
    }
    if (req.method === 'REPORT' && path === '/calendars/me/work/' && body.includes('calendar-query')) {
      const [first, ...rest] = options.events;
      const items = [
        first &&
          `<d:response><d:href>/calendars/me/work/1.ics</d:href><d:propstat><d:prop><c:calendar-data>${escapeXml(calendarText('Werk', first))}</c:calendar-data></d:prop></d:propstat></d:response>`,
        ...rest.map(
          (event, i) =>
            `<d:response><d:href>/calendars/me/work/${i + 2}.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${calendarText('Werk', event)}]]></c:calendar-data></d:prop></d:propstat></d:response>`,
        ),
      ].filter(Boolean);
      return reply(xml(items.join('')));
    }
    res.writeHead(404).end();
  });
  base = server.url;
  return { ...server, workUrl: `${server.url}/calendars/me/work/` };
}

// Een updateserver zoals electron-updater die verwacht (generic): latest-*.yml met versie en bestand, plus het bestand zelf.
// Het "installatiebestand" is nepdata met de juiste checksum; de bestandsnaam volgt wat het platform verwacht.
export async function startUpdateServer(initial: { version: string; status?: number; delayMs?: number }) {
  const state = { ...initial, status: initial.status ?? 200, delayMs: initial.delayMs ?? 0 };
  const payload = Buffer.from('Dit is geen echte app maar nepdata voor een test.'.repeat(2000));
  const sha512 = createHash('sha512').update(payload).digest('base64');
  const fileName = () =>
    process.platform === 'win32'
      ? `Agenda-Setup-${state.version}.exe`
      : process.platform === 'linux'
        ? `Agenda-${state.version}.AppImage`
        : `Agenda-${state.version}${process.arch === 'arm64' ? '-arm64' : ''}-mac.zip`;
  const yml = () =>
    [
      `version: ${state.version}`,
      'files:',
      `  - url: ${fileName()}`,
      `    sha512: ${sha512}`,
      `    size: ${payload.length}`,
      `path: ${fileName()}`,
      `sha512: ${sha512}`,
      `releaseDate: '2026-10-26T10:00:00.000Z'`,
      '',
    ].join('\n');
  const server = await listen((req, res) => {
    setTimeout(() => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (state.status !== 200) return void res.writeHead(state.status).end();
      if (/\/latest(-mac|-linux)?\.yml$/.test(path))
        return void res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(yml());
      if (path.endsWith(fileName())) {
        return void res
          .writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length })
          .end(payload);
      }
      res.writeHead(404).end();
    }, state.delayMs);
  });
  return { ...server, state, feed: `${server.url}/updates` };
}
