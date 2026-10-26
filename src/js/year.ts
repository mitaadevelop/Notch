import { occurrencesBetween } from './occurrences.ts';
import { data, hooks, ui } from './state.ts';
import { addDays, daysInMonth, el, fromKey, makeKey, monthLong, todayKey, weekdayNarrow, weekStartOf } from './util.ts';

export function renderYearView(root: HTMLElement) {
  const year = fromKey(ui.selectedDate).getFullYear();
  const withEvents = new Set<string>();
  for (const occ of occurrencesBetween(data, makeKey(year, 0, 1), makeKey(year, 11, 31))) {
    for (let key = occ.date; key <= occ.endDate; key = addDays(key, 1)) withEvents.add(key);
  }

  const grid = el('div', 'grid min-h-0 flex-1 grid-cols-4 gap-x-6 gap-y-4 overflow-y-auto p-5');
  for (let month = 0; month < 12; month++) grid.append(monthCard(year, month, withEvents));
  root.replaceChildren(grid);
}

function monthCard(year: number, month: number, withEvents: Set<string>) {
  const first = makeKey(year, month, 1);
  const start = weekStartOf(first, data.settings.weekStart);
  const offset = (fromKey(first).getDay() - data.settings.weekStart + 7) % 7;
  const weeks = Math.ceil((offset + daysInMonth(year, month)) / 7);

  const card = el('div', 'flex flex-col');
  const title = el(
    'button',
    'mb-1 self-start text-left text-base font-semibold capitalize ' +
      (month === new Date().getMonth() && year === new Date().getFullYear() ? 'text-today' : ''),
    monthLong.format(fromKey(first)),
  );
  title.type = 'button';
  title.addEventListener('click', () => hooks.setView('month', first));
  card.append(title);

  const names = el('div', 'grid grid-cols-7 text-center text-[10px] text-muted uppercase');
  for (let i = 0; i < 7; i++) names.append(el('span', '', weekdayNarrow.format(fromKey(addDays(start, i)))));
  card.append(names);

  const days = el('div', 'grid grid-cols-7 gap-y-0.5');
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(start, i);
    if (fromKey(key).getMonth() !== month) {
      days.append(el('span'));
      continue;
    }
    const isToday = key === todayKey();
    const button = el(
      'button',
      'mx-auto flex size-6 flex-col items-center justify-center rounded-full text-xs ' +
        (isToday
          ? 'bg-today font-semibold text-white'
          : withEvents.has(key)
            ? 'font-semibold hover:bg-fill'
            : 'hover:bg-fill'),
      String(fromKey(key).getDate()),
    );
    button.type = 'button';
    if (withEvents.has(key) && !isToday) button.append(el('span', 'absolute mt-4 size-0.5 rounded-full bg-muted'));
    button.addEventListener('click', () => hooks.setView('day', key));
    days.append(button);
  }
  card.append(days);
  return card;
}
