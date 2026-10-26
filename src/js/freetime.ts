// Vrije gaten in de agenda zoeken; gebruikt door Claude (find_free_time) en door "zoek een vrij moment" bij een overlap
import type { AgendaData, Occurrence } from '../shared/types.ts';
import { occurrencesBetween } from './occurrences.ts';
import { addDays, fromKey, toMinutes } from './util.ts';

export interface FreeSlot {
  date: string;
  start: number; // minuten sinds middernacht
  end: number;
}

export interface FreeTimeOptions {
  from: string;
  to: string;
  /** minimale lengte van een gat, in minuten */
  duration: number;
  /** het venster waarin gezocht wordt, in minuten sinds middernacht */
  dayStart: number;
  dayEnd: number;
  weekends?: boolean;
  limit?: number;
  /** afspraken die niet meetellen (bijv. de afspraak die je zelf aan het bewerken bent) */
  ignore?: (occ: Occurrence) => boolean;
  /** op de eerste dag pas zoeken vanaf dit tijdstip */
  notBefore?: number;
}

// Alleen afspraken met een tijd maken iemand bezet; hele-dag-afspraken en feestdagen niet.
export function findFreeSlots(data: AgendaData, options: FreeTimeOptions): FreeSlot[] {
  const { from, to, duration, dayStart, dayEnd } = options;
  const limit = options.limit ?? 20;
  const slots: FreeSlot[] = [];
  for (let day = from; day <= to && slots.length < limit; day = addDays(day, 1)) {
    const dow = fromKey(day).getDay();
    if (!options.weekends && (dow === 0 || dow === 6)) continue;
    // bezette stukken van deze dag, bijgesneden tot het venster en samengevoegd
    const busy = occurrencesBetween(data, day, day)
      .filter((o) => !o.holiday && !o.allDay && !options.ignore?.(o))
      .map((o) => {
        const start = o.date === day ? toMinutes(o.time) : 0;
        const end = o.endDate === day ? (o.endTime ? toMinutes(o.endTime) : start + 60) : 1440;
        return [Math.max(start, dayStart), Math.min(end, dayEnd)] as const;
      })
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    let cursor = day === from && options.notBefore !== undefined ? Math.max(dayStart, options.notBefore) : dayStart;
    const gaps: [number, number][] = [];
    for (const [start, end] of busy) {
      if (start > cursor) gaps.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < dayEnd) gaps.push([cursor, dayEnd]);
    for (const [start, end] of gaps) {
      if (end - start >= duration && slots.length < limit) slots.push({ date: day, start, end });
    }
  }
  return slots;
}
