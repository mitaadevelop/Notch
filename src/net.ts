// netwerk voor externe agenda's; draait in het main-proces (de pagina heeft geen netwerktoegang door de CSP)

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 20 * 1024 * 1024;

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

// webcal(s):// is gewoon https://; verder alleen http(s)
export function parseWebUrl(raw: string): URL {
  const text = String(raw)
    .trim()
    .replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Dit is geen geldige internetadres.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Alleen http(s)- en webcal-adressen kunnen.');
  return url;
}

// inloggegevens gaan alleen over een beveiligde verbinding (of naar de eigen computer, voor tests)
export function parseSecureUrl(raw: string): URL {
  const url = parseWebUrl(raw);
  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    throw new Error('Inloggen kan alleen via een beveiligde (https) verbinding.');
  }
  return url;
}

export interface Reply {
  status: number;
  text: string;
}

export async function request(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new Error(timedOut ? 'De server reageert niet (time-out).' : `Geen verbinding met ${url.hostname}.`, {
      cause: error,
    });
  }
  // lees met een bovengrens, zodat een enorm bestand het geheugen niet vol zet
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Het bestand is te groot (meer dan 20 MB).');
    }
    chunks.push(value);
  }
  return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
}

// haalt een iCalendar-feed op (Google "geheim adres", Outlook-publicatielink, iCloud-gedeelde agenda, enz.)
export async function fetchFeed(raw: string): Promise<string> {
  const { status, text } = await request(parseWebUrl(raw), { headers: { Accept: 'text/calendar, text/plain, */*' } });
  if (status === 404 || status === 410) throw new Error('Deze agenda bestaat niet (meer) op dit adres.');
  if (status === 401 || status === 403) throw new Error('Geen toegang: het adres is verlopen of niet openbaar.');
  if (status < 200 || status >= 300) throw new Error(`De server gaf een fout (${status}).`);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Dit adres geeft geen agenda (iCalendar) terug.');
  return text;
}
