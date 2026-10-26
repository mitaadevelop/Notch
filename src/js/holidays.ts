// Nederlandse feestdagen en andere vaste datums, berekend per jaar
import type { Holiday } from '../shared/types.ts';
import { addDays, daysInMonth, fromKey, makeKey } from './util.ts';

// Paasdatum volgens het anonieme Gregoriaanse algoritme
export function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = maart, 4 = april
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeKey(year, month - 1, day);
}

// n-de weekdag (0 = zondag) van een maand; month is 0-based
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(year, month, 1).getDay();
  return makeKey(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = daysInMonth(year, month);
  const lastDow = new Date(year, month, last).getDay();
  return makeKey(year, month, last - ((lastDow - weekday + 7) % 7));
}

const cache = new Map<number, Holiday[]>();

export function holidaysForYear(year: number): Holiday[] {
  const cached = cache.get(year);
  if (cached) return cached;
  const easterDay = easter(year);
  const koningsdag = new Date(year, 3, 27).getDay() === 0 ? makeKey(year, 3, 26) : makeKey(year, 3, 27);
  const list = [
    [makeKey(year, 0, 1), 'Nieuwjaarsdag'],
    [makeKey(year, 1, 14), 'Valentijnsdag'],
    [lastWeekday(year, 2, 0), 'Begin zomertijd'],
    [addDays(easterDay, -2), 'Goede Vrijdag'],
    [easterDay, 'Eerste Paasdag'],
    [addDays(easterDay, 1), 'Tweede Paasdag'],
    [koningsdag, 'Koningsdag'],
    [makeKey(year, 4, 4), 'Dodenherdenking'],
    [makeKey(year, 4, 5), 'Bevrijdingsdag'],
    [nthWeekday(year, 4, 0, 2), 'Moederdag'],
    [addDays(easterDay, 39), 'Hemelvaartsdag'],
    [addDays(easterDay, 49), 'Eerste Pinksterdag'],
    [addDays(easterDay, 50), 'Tweede Pinksterdag'],
    [nthWeekday(year, 5, 0, 3), 'Vaderdag'],
    [nthWeekday(year, 8, 2, 3), 'Prinsjesdag'],
    [lastWeekday(year, 9, 0), 'Einde zomertijd'],
    [makeKey(year, 11, 5), 'Sinterklaasavond'],
    [makeKey(year, 11, 25), 'Eerste Kerstdag'],
    [makeKey(year, 11, 26), 'Tweede Kerstdag'],
    [makeKey(year, 11, 31), 'Oudejaarsavond'],
  ].map(([date, title]) => ({ date, title }));
  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

export const yearOf = (key: string) => fromKey(key).getFullYear();
