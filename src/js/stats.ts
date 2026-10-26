// Statistieken over een periode: hoeveel uur aan afspraken, per agenda en per weekdag, en hoeveel taken er open staan
import type { AgendaData, ColorName } from '../shared/types.ts';
import { isDone } from './model.ts';
import { occurrencesBetween } from './occurrences.ts';
import { addDays, diffDays, fromKey, toMinutes } from './util.ts';

export interface CalendarStat {
  calendarId: string;
  name: string;
  color: ColorName;
  minutes: number;
  count: number;
}

export interface Stats {
  from: string;
  to: string;
  totalMinutes: number;
  /** afspraken met een tijd */
  timedCount: number;
  /** hele-dag-afspraken en meerdaagse (tellen niet mee in de uren) */
  allDayCount: number;
  perCalendar: CalendarStat[];
  /** minuten per weekdag, 0 = zondag … 6 = zaterdag */
  perWeekday: number[];
  busiest: { date: string; minutes: number } | null;
  tasks: { open: number; done: number };
}

// de minuten die een afspraak op `day` in beslag neemt (een afspraak over middernacht telt op beide dagen mee)
function minutesOn(occ: { date: string; endDate: string; time: string; endTime: string }, day: string) {
  const start = occ.date === day ? toMinutes(occ.time) : 0;
  const end = occ.endDate === day ? (occ.endTime ? toMinutes(occ.endTime) : start + 60) : 24 * 60;
  return Math.max(0, end - start);
}

export function computeStats(data: AgendaData, from: string, to: string): Stats {
  const perCalendar = new Map<string, CalendarStat>();
  const perDay = new Map<string, number>();
  const perWeekday = Array<number>(7).fill(0);
  let timedCount = 0;
  let allDayCount = 0;
  const tasks = { open: 0, done: 0 };

  for (const occ of occurrencesBetween(data, from, to)) {
    if (occ.holiday) continue;
    if (occ.ev?.task) tasks[isDone(occ.ev, occ.baseDate) ? 'done' : 'open']++;
    if (occ.ev?.task) continue; // taken zijn geen tijd in je agenda
    const calendar = data.calendars.find((c) => c.id === occ.calendarId);
    const stat = perCalendar.get(occ.calendarId) ?? {
      calendarId: occ.calendarId,
      name: calendar?.name ?? 'Onbekend',
      color: calendar?.color ?? 'gray',
      minutes: 0,
      count: 0,
    };
    perCalendar.set(occ.calendarId, stat);
    stat.count++;
    if (occ.allDay) {
      allDayCount++;
      continue;
    }
    timedCount++;
    for (let day = occ.date; day <= occ.endDate; day = addDays(day, 1)) {
      if (day < from || day > to) continue;
      const minutes = minutesOn(occ, day);
      stat.minutes += minutes;
      perDay.set(day, (perDay.get(day) ?? 0) + minutes);
      perWeekday[fromKey(day).getDay()] += minutes;
    }
  }

  let busiest: Stats['busiest'] = null;
  for (const [date, minutes] of perDay) {
    if (
      minutes > 0 &&
      (!busiest || minutes > busiest.minutes || (minutes === busiest.minutes && date < busiest.date))
    ) {
      busiest = { date, minutes };
    }
  }
  const list = [...perCalendar.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count);
  return {
    from,
    to,
    totalMinutes: list.reduce((sum, c) => sum + c.minutes, 0),
    timedCount,
    allDayCount,
    perCalendar: list,
    perWeekday,
    busiest,
    tasks,
  };
}

export type Period = 'week' | 'last-week' | 'month' | 'last-month';

// de eerste en laatste dag van een periode ten opzichte van `today`
export function periodRange(period: Period, today: string, weekStart: number): { from: string; to: string } {
  const startOfWeek = (key: string) => addDays(key, -((fromKey(key).getDay() - weekStart + 7) % 7));
  if (period === 'week' || period === 'last-week') {
    const from = period === 'week' ? startOfWeek(today) : addDays(startOfWeek(today), -7);
    return { from, to: addDays(from, 6) };
  }
  const d = fromKey(today);
  const first = new Date(d.getFullYear(), d.getMonth() + (period === 'month' ? 0 : -1), 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const key = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: key(first), to: key(last) };
}

export const daysIn = (from: string, to: string) => diffDays(from, to) + 1;

// 90 -> "1u 30m", 120 -> "2u", 45 -> "45m"
export function hoursLabel(minutes: number) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h}u` : '', m || !h ? `${m}m` : ''].filter(Boolean).join(' ');
}
