// breidt afspraken (ook herhalende, met tijdzone) uit tot voorkomens binnen een periode
import type { AgendaData, CalEvent, EventOcc, HolidayOcc, Occurrence, Slot } from '../shared/types.ts';
import { holidaysForYear, yearOf } from './holidays.ts';
import { addDays, daysInMonth, diffDays, fromKey, fromMinutes, keyOf, makeKey, weekStartOf } from './util.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

function tzOffsetMinutes(instantMs: number, tz: string) {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  const p = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instantMs) / 60000;
}

// wandklok-tijd in een tijdzone -> tijdstip in ms
export function wallToInstant(date: string, time: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let instant = guess - tzOffsetMinutes(guess, tz) * 60000;
  instant = guess - tzOffsetMinutes(instant, tz) * 60000;
  return instant;
}

const localParts = (instant: number) => {
  const d = new Date(instant);
  return { date: keyOf(d), time: fromMinutes(d.getHours() * 60 + d.getMinutes()) };
};

function toLocal(base: Slot, tz: string): Slot {
  const start = localParts(wallToInstant(base.date, base.time, tz));
  if (!base.endTime) return { date: start.date, endDate: start.date, time: start.time, endTime: '' };
  const end = localParts(wallToInstant(base.endDate, base.endTime, tz));
  return { date: start.date, endDate: end.date, time: start.time, endTime: end.time };
}

const isWeekend = (key: string) => [0, 6].includes(fromKey(key).getDay());

// alle begindatums (in de tijdzone van de afspraak) die de periode raken
export function* baseDates(ev: CalEvent, startKey: string, endKey: string): Generator<string, void> {
  const span = diffDays(ev.date, ev.endDate);
  const lower = addDays(startKey, -span);
  if (!ev.repeat) {
    if (ev.date <= endKey && ev.endDate >= startKey) yield ev.date;
    return;
  }
  const { freq, interval, until, byDay } = ev.repeat;
  const limit = until && until < endKey ? until : endKey;
  const skip = new Set(ev.exceptions);
  let guard = 0;

  // wekelijks op meerdere dagen (bijv. ma, wo en vr): dag voor dag langslopen, elke `interval` weken
  if (freq === 'weekly' && byDay?.length) {
    const anchor = weekStartOf(ev.date, 1);
    for (let d = lower > ev.date ? lower : ev.date; d <= limit && guard++ < 20000; d = addDays(d, 1)) {
      if (Math.floor(diffDays(anchor, d) / 7) % interval !== 0) continue;
      if (!byDay.includes(fromKey(d).getDay()) || skip.has(d)) continue;
      yield d;
    }
    return;
  }

  if (freq === 'daily' || freq === 'weekly' || freq === 'weekdays') {
    const step = freq === 'weekly' ? 7 * interval : freq === 'daily' ? interval : 1;
    let d = ev.date;
    if (d < lower) d = addDays(d, Math.floor(diffDays(d, lower) / step) * step);
    for (; d <= limit && guard++ < 5000; d = addDays(d, step)) {
      if (d < lower || skip.has(d)) continue;
      if (freq === 'weekdays' && isWeekend(d)) continue;
      yield d;
    }
    return;
  }

  const start = fromKey(ev.date);
  const day = start.getDate();
  const step = freq === 'yearly' ? 12 * interval : interval;
  const lowerDate = fromKey(lower);
  const monthsBetween = (lowerDate.getFullYear() - start.getFullYear()) * 12 + lowerDate.getMonth() - start.getMonth();
  let k = Math.max(0, Math.floor(monthsBetween / step) - 1) * step;
  for (; guard++ < 5000; k += step) {
    const total = start.getMonth() + k;
    const year = start.getFullYear() + Math.floor(total / 12);
    const month = total % 12;
    const d = makeKey(year, month, Math.min(day, daysInMonth(year, month)));
    if (d > limit) break;
    if (d >= lower && !skip.has(d)) yield d;
  }
}

function makeOccurrence(ev: CalEvent, baseDate: string): EventOcc {
  const span = diffDays(ev.date, ev.endDate);
  const base: Slot = { date: baseDate, endDate: addDays(baseDate, span), time: ev.time, endTime: ev.endTime };
  const local = ev.tz && ev.time ? toLocal(base, ev.tz) : base;
  return {
    key: `${ev.id}@${baseDate}`,
    id: ev.id,
    ev,
    calendarId: ev.calendarId,
    title: ev.title,
    location: ev.location,
    allDay: !ev.time,
    recurring: Boolean(ev.repeat),
    holiday: false,
    baseDate,
    base,
    ...local,
  };
}

export const compareOcc = (a: Occurrence, b: Occurrence) =>
  a.date.localeCompare(b.date) ||
  Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
  a.time.localeCompare(b.time) ||
  a.title.localeCompare(b.title);

export function occurrencesBetween(data: AgendaData, startKey: string, endKey: string): Occurrence[] {
  const visible = new Map(data.calendars.filter((c) => c.visible).map((c) => [c.id, c]));
  const out: Occurrence[] = [];
  // een dag marge, want een tijdzone kan een afspraak naar een andere lokale dag verschuiven
  const from = addDays(startKey, -1);
  const to = addDays(endKey, 1);

  for (const ev of data.events) {
    if (!visible.has(ev.calendarId)) continue;
    for (const baseDate of baseDates(ev, from, to)) out.push(makeOccurrence(ev, baseDate));
  }

  for (const cal of visible.values()) {
    if (cal.type !== 'holidays') continue;
    for (let y = yearOf(startKey); y <= yearOf(endKey); y++) {
      for (const h of holidaysForYear(y)) {
        if (h.date < startKey || h.date > endKey) continue;
        const holiday: HolidayOcc = {
          key: `h:${cal.id}:${h.date}`,
          id: null,
          ev: null,
          calendarId: cal.id,
          title: h.title,
          location: '',
          allDay: true,
          recurring: false,
          holiday: true,
          baseDate: h.date,
          base: { date: h.date, endDate: h.date, time: '', endTime: '' },
          date: h.date,
          endDate: h.date,
          time: '',
          endTime: '',
        };
        out.push(holiday);
      }
    }
  }

  return out.filter((o) => o.endDate >= startKey && o.date <= endKey).sort(compareOcc);
}
