import type { Occurrence } from '../shared/types.ts';
import { dayLabel, hideDragLabel, showDragLabel } from './dragkit.ts';
import { occurrencesBetween } from './occurrences.ts';
import { weatherBadge } from './weather.ts';
import { showDayList } from './popover.ts';
import { data, hooks, ui } from './state.ts';
import {
  assignLanes,
  attachRangeCreate,
  barChip,
  byLanePriority,
  drag,
  dotRow,
  dropEffect,
  highlightDrop,
  makeDraggable,
} from './occ-ui.ts';
import type { LaneItem } from './occ-ui.ts';
import {
  addDays,
  diffDays,
  el,
  fromKey,
  isoWeek,
  makeKey,
  monthShort,
  todayKey,
  weekdayShort,
  weekStartOf,
} from './util.ts';

const LANE_HEIGHT = 21;
const NUMBER_ROW = 24;

export function monthGridStart(key: string) {
  const first = fromKey(key);
  return weekStartOf(makeKey(first.getFullYear(), first.getMonth(), 1), data.settings.weekStart);
}

function weekCount(key: string) {
  const first = fromKey(key);
  const start = monthGridStart(key);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = diffDays(start, makeKey(first.getFullYear(), first.getMonth(), 1));
  return Math.ceil((offset + daysInMonth) / 7);
}

export function renderMonthView(root: HTMLElement) {
  const first = fromKey(ui.selectedDate);
  const gridStart = monthGridStart(ui.selectedDate);
  const weeks = weekCount(ui.selectedDate);
  const showWeeks = data.settings.weekNumbers;
  const occs = occurrencesBetween(data, gridStart, addDays(gridStart, weeks * 7 - 1));

  const header = el('div', 'flex shrink-0 border-b border-line');
  if (showWeeks) header.append(el('div', 'w-8 shrink-0'));
  const names = el('div', 'grid min-w-0 flex-1 grid-cols-7');
  for (let i = 0; i < 7; i++) {
    names.append(
      el(
        'span',
        'px-2 py-1 text-right text-xs text-muted capitalize',
        weekdayShort.format(fromKey(addDays(gridStart, i))),
      ),
    );
  }
  header.append(names);

  const body = el('div', 'flex min-h-0 flex-1 flex-col');
  root.replaceChildren(header, body);
  const capacity = Math.max(1, Math.floor((body.clientHeight / weeks - NUMBER_ROW) / LANE_HEIGHT));

  for (let w = 0; w < weeks; w++) {
    body.append(weekRow(addDays(gridStart, w * 7), occs, capacity, first.getMonth(), showWeeks));
  }
}

function weekRow(weekStart: string, occs: Occurrence[], capacity: number, month: number, showWeeks: boolean) {
  const row = el('div', 'flex min-h-0 flex-1 border-b border-line');
  if (showWeeks) {
    row.append(
      el(
        'div',
        'w-8 shrink-0 border-r border-line pt-1.5 text-center text-[10px] text-muted',
        String(isoWeek(addDays(weekStart, 3))),
      ),
    );
  }
  const area = el('div', 'relative min-w-0 flex-1');
  area.dataset.weekarea = weekStart;
  const dayAt = (e: MouseEvent) => {
    const rect = area.getBoundingClientRect();
    const col = Math.min(6, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
    return addDays(weekStart, col);
  };

  // achtergrondcellen met daggetallen
  const background = el('div', 'absolute inset-0 grid grid-cols-7');
  for (let i = 0; i < 7; i++) {
    const key = addDays(weekStart, i);
    const date = fromKey(key);
    const cell = el(
      'div',
      'flex justify-end border-r border-line p-1 select-none ' + (key === ui.selectedDate ? 'bg-fill' : ''),
    );
    cell.dataset.key = key;
    const weather = weatherBadge(key, 'mr-auto self-center pl-1');
    if (weather) cell.append(weather);
    cell.append(
      el(
        'span',
        'h-5 rounded-full px-1.5 text-sm/5 ' +
          (key === todayKey() ? 'bg-today font-semibold text-white' : date.getMonth() === month ? '' : 'text-muted'),
        date.getDate() === 1 ? `1 ${monthShort.format(date)}` : String(date.getDate()),
      ),
    );
    cell.addEventListener('click', () => hooks.selectDate(key));
    cell.addEventListener('dblclick', () => hooks.newEvent({ date: key, allDay: true }));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void hooks.dayMenu(key);
    });
    attachRangeCreate(cell, key);
    background.append(cell);
  }
  area.append(background);

  // afspraken in banen
  const weekEnd = addDays(weekStart, 6);
  const items: LaneItem[] = occs
    .filter((o) => o.date <= weekEnd && o.endDate >= weekStart)
    .map((occ) => ({
      occ,
      sc: Math.max(0, diffDays(weekStart, occ.date)),
      ec: Math.min(6, diffDays(weekStart, occ.endDate)),
      lane: 0,
    }))
    .sort(byLanePriority);
  const laneCount = assignLanes(items);
  const visibleLanes = laneCount > capacity ? capacity - 1 : capacity;
  const hidden: number[] = Array(7).fill(0);

  const layer = el('div', 'pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-y-px');
  layer.style.top = `${NUMBER_ROW}px`;
  layer.style.gridAutoRows = `${LANE_HEIGHT - 1}px`;

  for (const item of items) {
    if (item.lane >= visibleLanes) {
      for (let d = item.sc; d <= item.ec; d++) hidden[d]++;
      continue;
    }
    const { occ } = item;
    const wrapper = el('div', 'pointer-events-auto min-w-0 px-px');
    wrapper.style.gridColumn = `${item.sc + 1} / ${item.ec + 2}`;
    wrapper.style.gridRow = String(item.lane + 1);
    const startsHere = occ.date >= weekStart;
    const endsHere = occ.endDate <= weekEnd;
    const node = occ.time && occ.date === occ.endDate ? dotRow(occ) : barChip(occ, { startsHere, endsHere });
    makeDraggable(node, occ, dayAt);
    wrapper.append(node);
    layer.append(wrapper);
  }

  hidden.forEach((count, d) => {
    if (!count) return;
    const key = addDays(weekStart, d);
    const more = el(
      'button',
      'pointer-events-auto px-1.5 text-left text-xs/5 text-muted hover:text-fg',
      `${count} meer…`,
    );
    more.type = 'button';
    more.style.gridColumn = String(d + 1);
    more.style.gridRow = String(visibleLanes + 1);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      showDayList(more, key);
    });
    layer.append(more);
  });
  area.append(layer);

  // slepen van afspraken naar een andere dag
  area.addEventListener('dragover', (e) => {
    if (!drag.occ) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = dropEffect(e);
    highlightDrop(dayAt(e));
    showDragLabel(e.clientX, e.clientY, `${e.altKey ? 'Kopiëren' : 'Verplaatsen'} naar ${dayLabel(dayAt(e))}`);
  });
  area.addEventListener('dragleave', (e) => {
    if (area.contains(e.relatedTarget as Node | null)) return;
    highlightDrop(null);
    hideDragLabel();
  });
  area.addEventListener('drop', (e) => {
    if (!drag.occ) return;
    e.preventDefault();
    highlightDrop(null);
    hideDragLabel();
    const days = diffDays(drag.grabKey, dayAt(e));
    const occ = drag.occ;
    drag.occ = null;
    // zelfde dag met Alt = een kopie op dezelfde plek
    if (days || e.altKey) void hooks.moveOcc(occ, { days, copy: e.altKey });
  });

  row.append(area);
  return row;
}
