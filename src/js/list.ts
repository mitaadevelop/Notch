// lijstweergave ("Binnenkort") en zoekresultaten
import type { Occurrence } from '../shared/types.ts';
import { occurrencesBetween } from './occurrences.ts';
import { searchEvents } from './search.ts';
import { calendarOf, colorOfOcc, data, hooks, ui } from './state.ts';
import { COLORS } from './colors.ts';
import { wireOcc } from './occ-ui.ts';
import { timesLabel, dateLabel } from './format.ts';
import { addDays, dayHeading, el, fromKey, todayKey } from './util.ts';

const LIST_DAYS = 60;

export function renderListView(root: HTMLElement) {
  const start = ui.selectedDate;
  const occs = occurrencesBetween(data, start, addDays(start, LIST_DAYS - 1));
  const scroller = el('div', 'min-h-0 flex-1 overflow-y-auto');

  if (!occs.length) {
    scroller.append(el('p', 'p-8 text-center text-sm text-muted', `Geen afspraken in de komende ${LIST_DAYS} dagen.`));
  }

  const byDay = new Map<string, Occurrence[]>();
  for (const occ of occs) {
    // meerdaagse afspraken staan onder elke dag die ze raken (binnen de periode)
    for (
      let key = occ.date < start ? start : occ.date;
      key <= occ.endDate && key <= addDays(start, LIST_DAYS - 1);
      key = addDays(key, 1)
    ) {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(occ);
    }
  }

  for (const [key, items] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const heading = el(
      'button',
      'sticky top-0 z-10 flex w-full items-baseline gap-2 border-b border-line bg-canvas px-5 py-1.5 text-left text-sm font-semibold first-letter:uppercase ' +
        (key === todayKey() ? 'text-today' : ''),
      dayHeading.format(fromKey(key)),
    );
    heading.type = 'button';
    heading.addEventListener('click', () => hooks.setView('day', key));
    scroller.append(heading);
    for (const occ of items) scroller.append(row(occ));
  }
  root.replaceChildren(scroller);
}

function row(occ: Occurrence) {
  const color = colorOfOcc(occ);
  const node = el('div', 'flex items-center gap-3 border-b border-line px-5 py-2 text-sm hover:bg-fill');
  node.append(el('span', `h-8 w-1 shrink-0 rounded-full ${color.dot}`));
  node.append(el('span', 'w-36 shrink-0 text-muted', timesLabel(occ)));
  const text = el('div', 'min-w-0 flex-1');
  text.append(el('div', 'truncate font-medium', occ.title + (occ.recurring ? ' ↻' : '')));
  if (occ.location) text.append(el('div', 'truncate text-xs text-muted', occ.location));
  node.append(text, el('span', 'shrink-0 text-xs text-muted', calendarOf(occ.calendarId)?.name ?? ''));
  if (!occ.holiday) wireOcc(node, occ);
  return node;
}

export function renderSearch(root: HTMLElement) {
  const results = searchEvents(data, ui.query, todayKey());
  const scroller = el('div', 'min-h-0 flex-1 overflow-y-auto');
  scroller.append(
    el(
      'h2',
      'border-b border-line px-5 py-2 text-sm font-semibold',
      `${results.length} ${results.length === 1 ? 'resultaat' : 'resultaten'} voor “${ui.query}”`,
    ),
  );

  if (!results.length) scroller.append(el('p', 'p-8 text-center text-sm text-muted', 'Niets gevonden.'));

  for (const result of results) {
    const color = COLORS[result.calendar.color] ?? COLORS.blue;
    const node = el(
      'button',
      'flex w-full items-center gap-3 border-b border-line px-5 py-2 text-left text-sm hover:bg-fill',
    );
    node.type = 'button';
    node.append(el('span', `h-8 w-1 shrink-0 rounded-full ${color.dot}`));
    node.append(el('span', 'w-32 shrink-0 text-muted', dateLabel(result.date)));
    const text = el('div', 'min-w-0 flex-1');
    const ev = result.ev;
    text.append(el('div', 'truncate font-medium', (ev?.title ?? result.title) + (ev?.repeat ? ' ↻' : '')));
    const detail = ev
      ? [ev.time ? `${ev.time}${ev.endTime ? `–${ev.endTime}` : ''}` : 'hele dag', ev.location]
          .filter(Boolean)
          .join(' · ')
      : '';
    if (detail) text.append(el('div', 'truncate text-xs text-muted', detail));
    node.append(text, el('span', 'shrink-0 text-xs text-muted', result.calendar.name));
    node.addEventListener('click', () => hooks.openSearchResult(result));
    scroller.append(node);
  }
  root.replaceChildren(scroller);
}
