// het scherm "Statistieken": cijfers en staafjes voor een gekozen periode
import { COLORS } from './colors.ts';
import { computeStats, daysIn, hoursLabel, periodRange } from './stats.ts';
import type { Period } from './stats.ts';
import { data } from './state.ts';
import { $, el, fromKey, todayKey } from './util.ts';

const f = {
  dialog: $<HTMLDialogElement>('stats-dialog'),
  period: $<HTMLSelectElement>('st-period'),
  body: $('st-body'),
};

const dayName = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

function bar(label: string, minutes: number, max: number, fill: string, extra = '') {
  const row = el('div', 'grid grid-cols-[110px_1fr_auto] items-center gap-2 text-sm');
  row.append(el('span', 'truncate', label));
  const track = el('div', 'h-2 overflow-hidden rounded-full bg-fill');
  const inner = el('div', `h-full rounded-full ${fill}`);
  inner.style.width = `${max ? Math.max((minutes / max) * 100, minutes ? 3 : 0) : 0}%`;
  track.append(inner);
  row.append(track, el('span', 'text-xs text-muted tabular-nums', extra || hoursLabel(minutes)));
  return row;
}

export function renderStats() {
  const { from, to } = periodRange(f.period.value as Period, todayKey(), data.settings.weekStart);
  const stats = computeStats(data, from, to);
  const days = daysIn(from, to);
  const children: HTMLElement[] = [];

  const summary = el('div', 'grid grid-cols-3 gap-2');
  for (const [value, label] of [
    [hoursLabel(stats.totalMinutes), 'in afspraken'],
    [String(stats.timedCount), 'met een tijd'],
    [String(stats.allDayCount), 'hele dag'],
  ]) {
    const card = el('div', 'rounded-lg bg-fill px-3 py-2');
    card.append(el('div', 'text-lg font-semibold tabular-nums', value), el('div', 'text-xs text-muted', label));
    summary.append(card);
  }
  children.push(summary);

  if (stats.busiest) {
    const day = dayName.format(fromKey(stats.busiest.date));
    children.push(
      el(
        'p',
        'text-sm text-muted',
        `Drukste dag: ${day} (${hoursLabel(stats.busiest.minutes)}). Gemiddeld ${hoursLabel(stats.totalMinutes / days)} per dag.`,
      ),
    );
  }

  if (stats.perCalendar.length) {
    const max = Math.max(...stats.perCalendar.map((c) => c.minutes));
    const section = el('div', 'flex flex-col gap-1.5');
    section.append(el('h3', 'text-xs font-semibold text-muted uppercase', 'Per agenda'));
    for (const c of stats.perCalendar) {
      section.append(bar(c.name, c.minutes, max, COLORS[c.color].dot, `${hoursLabel(c.minutes)} · ${c.count}×`));
    }
    children.push(section);
  }

  if (stats.totalMinutes) {
    const max = Math.max(...stats.perWeekday);
    const section = el('div', 'flex flex-col gap-1.5');
    section.append(el('h3', 'text-xs font-semibold text-muted uppercase', 'Per weekdag'));
    // beginnend bij de dag waarop jouw week begint
    for (let i = 0; i < 7; i++) {
      const dow = (data.settings.weekStart + i) % 7;
      const name = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(fromKey(`2026-11-0${dow + 1}`));
      section.append(bar(name, stats.perWeekday[dow], max, 'bg-accent'));
    }
    children.push(section);
  }

  if (stats.tasks.open + stats.tasks.done) {
    children.push(el('p', 'text-sm', `Taken: ${stats.tasks.done} afgevinkt, ${stats.tasks.open} open.`));
  }
  if (!stats.timedCount && !stats.allDayCount && !stats.tasks.open && !stats.tasks.done) {
    children.push(el('p', 'text-sm text-muted', 'Geen afspraken in deze periode.'));
  }
  f.body.replaceChildren(...children);
}

export function openStats() {
  renderStats();
  f.dialog.showModal();
}

f.period.addEventListener('change', renderStats);
$('st-close').addEventListener('click', () => f.dialog.close());
f.dialog.addEventListener('click', (e) => {
  if (e.target === f.dialog) f.dialog.close();
});
