// bepaalt welke meldingen in een periode afgaan
import type { AgendaData, Occurrence } from '../shared/types.ts';
import { isDone } from './model.ts';
import { occurrencesBetween } from './occurrences.ts';
import { addDays, fromKey, keyOf, toMinutes } from './util.ts';

// voor hele-dag-afspraken gaat de melding af om 09:00, min het aantal minuten
export const ALL_DAY_ALERT_HOUR = 9;

export function alertTime(occ: Occurrence) {
  const offset = occ.ev?.alert;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  const day = fromKey(occ.date);
  const minutes = occ.time ? toMinutes(occ.time) : ALL_DAY_ALERT_HOUR * 60;
  day.setMinutes(minutes);
  return day.getTime() - offset * 60000;
}

// Het moment om te vertrekken: het begin min de reistijd. Alleen voor afspraken met een tijd, reistijd én een melding
// (wie een melding wil, wil ook weten wanneer hij weg moet).
export function departureTime(occ: Occurrence) {
  const travel = occ.ev?.travel;
  if (!occ.time || !travel || typeof occ.ev?.alert !== 'number') return null;
  const day = fromKey(occ.date);
  day.setMinutes(toMinutes(occ.time));
  return day.getTime() - travel * 60000;
}

// afspraken waarvoor het vertrekmoment in (fromMs, toMs] valt
export function dueDepartures(data: AgendaData, fromMs: number, toMs: number) {
  const start = keyOf(new Date(fromMs));
  const end = addDays(keyOf(new Date(toMs)), 2);
  return occurrencesBetween(data, start, end).filter((occ) => {
    const at = departureTime(occ);
    return at !== null && at > fromMs && at <= toMs && !(occ.ev && isDone(occ.ev, occ.baseDate));
  });
}

// afspraken met een melding in (fromMs, toMs]
export function dueAlerts(data: AgendaData, fromMs: number, toMs: number) {
  const start = keyOf(new Date(fromMs));
  const end = addDays(keyOf(new Date(toMs)), 15);
  return occurrencesBetween(data, start, end).filter((occ) => {
    const at = alertTime(occ);
    return at !== null && at > fromMs && at <= toMs && !(occ.ev && isDone(occ.ev, occ.baseDate));
  });
}
