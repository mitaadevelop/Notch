// zoeken in titel, locatie, notitie en genodigden
import type { AgendaData, CalEvent, SearchResult } from '../shared/types.ts';
import { holidaysForYear } from './holidays.ts';
import { baseDates } from './occurrences.ts';
import { addDays, fromKey } from './util.ts';

const matches = (ev: CalEvent, q: string) =>
  [ev.title, ev.location, ev.notes, ev.url, ...ev.invitees].some((s) => s?.toLowerCase().includes(q));

// geeft per afspraak één resultaat: de eerstvolgende datum vanaf vandaag, anders de laatste
export function searchEvents(data: AgendaData, query: string, today: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const calendars = new Map(data.calendars.map((c) => [c.id, c]));
  const results: SearchResult[] = [];

  for (const ev of data.events) {
    if (!calendars.has(ev.calendarId) || !matches(ev, q)) continue;
    let date = ev.date;
    if (ev.repeat) {
      const next = baseDates(ev, today, addDays(today, 365 * 5)).next();
      if (!next.done) date = next.value;
    }
    results.push({ ev, date, calendar: calendars.get(ev.calendarId)! });
  }

  const year = fromKey(today).getFullYear();
  for (const cal of data.calendars.filter((c) => c.type === 'holidays')) {
    for (const y of [year - 1, year, year + 1]) {
      for (const h of holidaysForYear(y)) {
        if (h.title.toLowerCase().includes(q)) {
          results.push({ ev: null, title: h.title, date: h.date, calendar: cal });
        }
      }
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}
