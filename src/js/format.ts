import type { Slot } from '../shared/types.ts';
import { data } from './state.ts';
import { shortDate, fromKey, pad } from './util.ts';

export function fmtTime(time: string) {
  if (!time || data.settings.clock24) return time;
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

const dayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });

export function timesLabel(occ: Slot & { allDay: boolean }) {
  if (occ.allDay) {
    return occ.endDate > occ.date
      ? `${dayMonth.format(fromKey(occ.date))} – ${dayMonth.format(fromKey(occ.endDate))}`
      : 'hele dag';
  }
  const start = fmtTime(occ.time);
  if (!occ.endTime) return start;
  return occ.endDate > occ.date
    ? `${start} – ${dayMonth.format(fromKey(occ.endDate))} ${fmtTime(occ.endTime)}`
    : `${start}–${fmtTime(occ.endTime)}`;
}

export const dateLabel = (key: string) => shortDate.format(fromKey(key));
