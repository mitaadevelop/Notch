// Wat er in de menubalk komt: de eerstvolgende afspraken en een korte tekst naast het icoon
import type { AgendaData, Occurrence, TrayState } from '../shared/types.ts';
import { isDone } from './model.ts';
import { occurrencesBetween } from './occurrences.ts';
import { addDays, fromKey, keyOf, toMinutes } from './util.ts';

const MAX_ITEMS = 6;
const TITLE_MAX = 26;

const short = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

export function dayWord(date: string, today: string) {
  if (date === today) return 'Vandaag';
  if (date === addDays(today, 1)) return 'Morgen';
  return short.format(fromKey(date));
}

const startMs = (occ: Occurrence) => {
  const d = fromKey(occ.date);
  d.setMinutes(occ.time ? toMinutes(occ.time) : 0);
  return d.getTime();
};
const endMs = (occ: Occurrence) => {
  const d = fromKey(occ.endDate);
  d.setMinutes(occ.endTime ? toMinutes(occ.endTime) : occ.time ? toMinutes(occ.time) + 60 : 24 * 60);
  return d.getTime();
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Afspraken die nog bezig of op komst zijn (de komende week), op tijd gesorteerd. Hele-dag-afspraken tellen alleen vandaag.
export function upcoming(data: AgendaData, now: Date): Occurrence[] {
  const today = keyOf(now);
  const nowMs = now.getTime();
  return occurrencesBetween(data, today, addDays(today, 7))
    .filter((occ) => {
      if (occ.holiday || (occ.ev && isDone(occ.ev, occ.baseDate))) return false;
      if (occ.allDay) return occ.date <= today && occ.endDate >= today;
      return endMs(occ) > nowMs;
    })
    .sort((a, b) => startMs(a) - startMs(b) || a.title.localeCompare(b.title))
    .slice(0, MAX_ITEMS);
}

export function trayState(data: AgendaData, now: Date, enabled: boolean): TrayState {
  if (!enabled) return { enabled: false, title: '', tooltip: '', items: [] };
  const today = keyOf(now);
  const list = upcoming(data, now);
  const items = list.map((occ) => ({
    label: `${dayWord(occ.date < today ? today : occ.date, today)}${occ.time ? ` ${occ.time}` : ''} · ${clip(occ.title || 'Afspraak', 40)}`,
    date: occ.date,
    id: occ.id,
  }));

  const next = list.find((occ) => !occ.allDay);
  let title = '';
  let tooltip = 'Agenda: geen afspraken de komende dagen';
  if (next) {
    const minutes = Math.round((startMs(next) - now.getTime()) / 60000);
    const name = clip(next.title || 'Afspraak', TITLE_MAX);
    if (minutes <= 0) title = `${name} · nu`;
    else if (minutes < 60) title = `${name} · over ${minutes} min`;
    else if (next.date === today) title = `${name} · ${next.time}`;
    tooltip = `Volgende: ${next.title || 'Afspraak'} · ${dayWord(next.date, today).toLowerCase()} ${next.time}`;
  } else if (list.length) {
    tooltip = `Vandaag: ${list[0].title || 'Afspraak'}`;
  }
  return { enabled: true, title, tooltip, items };
}
