// dag- en weekweergave met uurraster; afspraken slepen, vergroten en aanmaken door te slepen
import type { Occurrence } from '../shared/types.ts';
import { occurrencesBetween } from './occurrences.ts';
import { defaultCalendarId } from './dialogs.ts';
import { weatherBadge } from './weather.ts';
import { clockIn, zoneName } from './zones.ts';
import { reduceMotion } from './motion.ts';
import { colorOfOcc, data, holdRender, hooks, isReadOnly, releaseRender } from './state.ts';
import * as store from './store.ts';
import {
  assignLanes,
  barChip,
  byLanePriority,
  calendarAt,
  drag,
  dropEffect,
  highlightCalendar,
  isBar,
  attachRangeCreate,
  makeDraggable,
  wireOcc,
} from './occ-ui.ts';
import type { LaneItem } from './occ-ui.ts';
import { fmtTime, timesLabel } from './format.ts';
import { createAutoScroll, dayLabel, durationLabel, hideDragLabel, showDragLabel } from './dragkit.ts';
import { diffDays, el, fromKey, fromMinutes, isoWeek, toMinutes, todayKey, weekdayShort } from './util.ts';

export const DEFAULT_HOUR_PX = 48;
const MIN_HOUR_PX = 28;
const MAX_HOUR_PX = 120;
const STORAGE_KEY = 'agenda.hourPx';

function loadHourHeight() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_HOUR_PX && saved <= MAX_HOUR_PX ? saved : DEFAULT_HOUR_PX;
  } catch {
    return DEFAULT_HOUR_PX; // opslag kan geblokkeerd zijn; dan onthouden we het niet
  }
}

let hourHeight = loadHourHeight();
export const hourPx = () => hourHeight;
const SNAP = 15;
const GUTTER = 'w-14 shrink-0';
const ZONE_GUTTER = 'w-12 shrink-0';
const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

let scrollTop = 7 * hourHeight;

// zet overlappende afspraken naast elkaar
interface DayItem {
  occ: Occurrence;
  start: number;
  end: number;
}

interface Placed extends DayItem {
  col: number;
  cols: number;
}

interface DayColumn {
  column: HTMLElement;
  key: string;
}

export function layoutDay(items: DayItem[]): Placed[] {
  const placed: Placed[] = [];
  let cluster: DayItem[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const ends: number[] = [];
    const cols = cluster.map((item) => {
      let col = ends.findIndex((end) => end <= item.start);
      if (col === -1) col = ends.length;
      ends[col] = item.end;
      return col;
    });
    cluster.forEach((item, i) => placed.push({ ...item, col: cols[i], cols: ends.length }));
    cluster = [];
  };
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) flush();
    clusterEnd = cluster.length ? Math.max(clusterEnd, item.end) : item.end;
    cluster.push(item);
  }
  if (cluster.length) flush();
  return placed;
}

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

export function updateNowLine() {
  for (const line of document.querySelectorAll<HTMLElement>('[data-nowline]')) {
    line.style.top = `${(nowMinutes() * hourPx()) / 60}px`;
  }
}

export function renderTimeGrid(root: HTMLElement, days: string[]) {
  const first = days[0];
  const last = days[days.length - 1];
  const occs = occurrencesBetween(data, first, last);
  const bars = occs.filter(isBar);
  const timed = occs.filter((o) => !isBar(o));

  const children = [header(days)];
  if (bars.length) children.push(allDayRow(days, bars));

  const scroller = el('div', 'min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]');
  const body = el('div', 'flex');
  // extra tijdzones links van de lokale uren
  for (const zone of data.settings.clocks) {
    const column = el('div', ZONE_GUTTER);
    for (let h = 0; h < 24; h++) {
      const label = el('div', 'relative');
      label.style.height = `${hourPx()}px`;
      if (h > 0) {
        const { time, dayShift } = clockIn(zone, first, h);
        const text = el('span', 'absolute -top-2 right-1 text-[10px] text-muted tabular-nums', fmtTime(time));
        if (dayShift) text.title = dayShift > 0 ? 'volgende dag' : 'vorige dag';
        if (dayShift) text.append(el('sup', 'ml-px text-[8px]', dayShift > 0 ? '+1' : '−1'));
        label.append(text);
      }
      column.append(label);
    }
    body.append(column);
  }
  const hours = el('div', GUTTER);
  for (let h = 0; h < 24; h++) {
    const label = el('div', 'relative');
    label.style.height = `${hourPx()}px`;
    if (h > 0) label.append(el('span', 'absolute -top-2 right-2 text-[10px] text-muted', fmtTime(fromMinutes(h * 60))));
    hours.append(label);
  }
  body.append(hours);

  const columns: DayColumn[] = days.map((key) =>
    dayColumn(
      key,
      timed.filter((o) => o.date === key),
      () => columns,
    ),
  );
  for (const { column } of columns) body.append(column);
  scroller.append(body);
  scroller.addEventListener('scroll', () => {
    scrollTop = scroller.scrollTop;
  });
  children.push(scroller);

  root.replaceChildren(...children);
  scroller.scrollTop = scrollTop;
}

function header(days: string[]) {
  const row = el('div', 'flex shrink-0 border-b border-line');
  for (const zone of data.settings.clocks) {
    row.append(
      el('div', `${ZONE_GUTTER} flex items-end justify-end truncate pr-1 pb-1.5 text-[9px] text-muted`, zoneName(zone)),
    );
  }
  const corner = el('div', `${GUTTER} flex items-end justify-end pr-2 pb-1.5 text-[10px] text-muted`);
  if (data.settings.weekNumbers) corner.textContent = `wk ${isoWeek(days[Math.min(3, days.length - 1)])}`;
  row.append(corner);
  for (const key of days) {
    const date = fromKey(key);
    const cell = el('div', 'flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-line py-1.5');
    cell.append(
      el('span', 'text-xs text-muted capitalize', weekdayShort.format(date)),
      el(
        'span',
        'rounded-full px-1.5 text-lg ' + (key === todayKey() ? 'bg-today font-semibold text-white' : ''),
        String(date.getDate()),
      ),
    );
    const weather = weatherBadge(key);
    if (weather) cell.append(weather);
    row.append(cell);
  }
  return row;
}

function allDayRow(days: string[], bars: Occurrence[]) {
  const row = el('div', 'flex shrink-0 border-b border-line');
  for (let i = 0; i < data.settings.clocks.length; i++) row.append(el('div', ZONE_GUTTER));
  row.append(el('div', `${GUTTER} pt-1.5 pr-2 text-right text-[10px] text-muted`, 'hele dag'));
  const area = el('div', 'relative min-w-0 flex-1');
  const dayAt = (e: MouseEvent) => {
    const rect = area.getBoundingClientRect();
    return days[clamp(Math.floor(((e.clientX - rect.left) / rect.width) * days.length), 0, days.length - 1)];
  };

  const lines = el('div', 'absolute inset-0 grid');
  lines.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
  for (const key of days) {
    const cell = el('div', 'border-l border-line select-none');
    cell.dataset.key = key;
    attachRangeCreate(cell, key);
    cell.addEventListener('dblclick', () => hooks.newEvent({ date: key, allDay: true }));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void hooks.dayMenu(key);
    });
    lines.append(cell);
  }
  area.append(lines);

  const items: LaneItem[] = bars
    .map((occ) => ({
      occ,
      sc: Math.max(0, diffDays(days[0], occ.date)),
      ec: Math.min(days.length - 1, diffDays(days[0], occ.endDate)),
      lane: 0,
    }))
    .sort(byLanePriority);
  assignLanes(items);

  // de laag met balken laat klikken door naar de dagcellen eronder (dubbelklik en slepen om te maken); alleen de balken vangen ze op
  const layer = el('div', 'pointer-events-none relative grid gap-y-px py-0.5');
  layer.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
  layer.style.gridAutoRows = '20px';
  layer.style.minHeight = '24px';
  for (const { occ, sc, ec, lane } of items) {
    const wrapper = el('div', 'pointer-events-auto min-w-0 px-px');
    wrapper.style.gridColumn = `${sc + 1} / ${ec + 2}`;
    wrapper.style.gridRow = String(lane + 1);
    const node = barChip(occ, { startsHere: occ.date >= days[0], endsHere: occ.endDate <= days[days.length - 1] });
    makeDraggable(node, occ, dayAt);
    wrapper.append(node);
    layer.append(wrapper);
  }
  area.append(layer);

  area.addEventListener('dragover', (e) => {
    if (!drag.occ) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = dropEffect(e);
    showDragLabel(e.clientX, e.clientY, `${e.altKey ? 'Kopiëren' : 'Verplaatsen'} naar ${dayLabel(dayAt(e))}`);
  });
  area.addEventListener('dragleave', (e) => {
    if (!area.contains(e.relatedTarget as Node | null)) hideDragLabel();
  });
  area.addEventListener('drop', (e) => {
    if (!drag.occ) return;
    e.preventDefault();
    hideDragLabel();
    const occ = drag.occ;
    drag.occ = null;
    const delta = diffDays(drag.grabKey, dayAt(e));
    if (delta || e.altKey) void hooks.moveOcc(occ, { days: delta, copy: e.altKey });
  });

  row.append(area);
  return row;
}

function dayColumn(key: string, occs: Occurrence[], getColumns: () => DayColumn[]): DayColumn {
  const column = el('div', 'relative min-w-0 flex-1 border-l border-line');
  column.dataset.col = key;
  for (let h = 0; h < 24; h++) {
    const hour = el('div', 'border-b border-line');
    hour.style.height = `${hourPx()}px`;
    column.append(hour);
  }

  const items = occs.map((occ) => {
    const start = toMinutes(occ.time);
    const end = occ.endTime ? toMinutes(occ.endTime) : start + 60;
    return { occ, start, end: clamp(Math.max(end, start + 15), 0, 24 * 60) };
  });

  for (const item of layoutDay(items)) {
    if (item.occ.ev?.travel) column.append(travelBlock(item));
  }
  for (const item of layoutDay(items)) column.append(timedBlock(item, getColumns));

  if (key === todayKey()) {
    const line = el('div', 'pointer-events-none absolute inset-x-0 z-10 h-px bg-today');
    line.dataset.nowline = '1';
    line.style.top = `${(nowMinutes() * hourPx()) / 60}px`;
    // het bolletje pulseert zacht (zie .now-dot in input.css)
    line.append(el('div', 'now-dot absolute -top-[3px] -left-1 size-2 rounded-full bg-today'));
    column.append(line);
  }

  column.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('[data-okey], [data-inline]')) return;
    const minutes = clamp(Math.floor(minutesAt(e.clientY, column) / 30) * 30, 0, 23 * 60);
    startInlineCreate(column, key, minutes, Math.min(minutes + 60, 24 * 60 - 1));
  });
  column.addEventListener('contextmenu', (e) => {
    if ((e.target as Element).closest('[data-okey]')) return;
    e.preventDefault();
    const minutes = clamp(Math.floor(minutesAt(e.clientY, column) / 30) * 30, 0, 23 * 60);
    void hooks.dayMenu(key, fromMinutes(minutes));
  });
  attachCreateDrag(column, key);
  return { column, key };
}

const minutesAt = (clientY: number, column: HTMLElement) =>
  ((clientY - column.getBoundingClientRect().top) / hourPx()) * 60;

function travelBlock({ occ, start }: Placed) {
  const travel = occ.ev?.travel ?? 0;
  const minutes = Math.min(travel, start);
  const block = el(
    'div',
    'pointer-events-none absolute inset-x-0.5 flex items-start overflow-hidden rounded-md bg-fill px-1.5 text-[10px] text-muted',
  );
  block.style.top = `${((start - minutes) * hourPx()) / 60}px`;
  block.style.height = `${(minutes * hourPx()) / 60}px`;
  if (minutes >= 20) block.textContent = `Reistijd ${travel} min`;
  return block;
}

function place(block: HTMLElement, { start, end, col, cols }: Pick<Placed, 'start' | 'end' | 'col' | 'cols'>) {
  const height = Math.max(((end - start) * hourPx()) / 60 - 1, 18);
  block.style.top = `${(start * hourPx()) / 60}px`;
  block.style.height = `${height}px`;
  block.style.left = `calc(${(col / cols) * 100}% + 1px)`;
  block.style.width = `calc(${100 / cols}% - 3px)`;
  return height;
}

function timedBlock(item: Placed, getColumns: () => DayColumn[]) {
  const { occ } = item;
  const color = colorOfOcc(occ);
  const block = el(
    'div',
    `absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs hover:brightness-95 ${color.chip} ${color.bar}`,
  );
  const height = place(block, item);
  if (!isReadOnly(occ.calendarId)) block.dataset.movable = '1'; // krijgt de grab-cursor (zie input.css)
  if (height < 36) {
    const line = el('div', 'flex items-baseline gap-1');
    line.append(
      el('span', 'truncate font-semibold', occ.title),
      el('span', 'shrink-0 text-[11px] text-muted', fmtTime(occ.time)),
    );
    block.append(line);
  } else {
    block.append(el('div', 'truncate font-semibold', occ.title));
    if (occ.location) block.append(el('div', 'truncate text-[11px] text-muted', occ.location));
    block.append(el('div', 'truncate text-[11px] text-muted', timesLabel(occ)));
  }
  if (!isReadOnly(occ.calendarId)) {
    const handle = el('div', 'absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize');
    handle.dataset.resize = '1';
    block.append(handle);
  }

  wireOcc(block, occ);
  attachBlockDrag(block, item, getColumns);
  return block;
}

// verplaatsen (hele blok) en vergroten (onderrand) met de muis; luisteraars staan op window zodat het slepen doorloopt buiten het blok
function attachBlockDrag(block: HTMLElement, item: Placed, getColumns: () => DayColumn[]) {
  const { occ } = item;
  // afspraken uit een externe agenda zijn alleen-lezen: niet verplaatsen of vergroten
  if (isReadOnly(occ.calendarId)) return;
  block.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    holdRender();
    const resize = (e.target as HTMLElement).dataset.resize === '1';
    const columns = getColumns();
    const srcIdx = columns.findIndex((c) => c.column === block.parentElement);
    const scroller = block.closest<HTMLElement>('.overflow-y-auto');
    const startScroll = scroller?.scrollTop ?? 0;
    const length = item.end - item.start;
    const startX = e.clientX;
    const startY = e.clientY;
    let last: PointerEvent = e;
    let moved = false;
    let overCalendar: string | null = null;
    let idx = srcIdx;
    let start = item.start;
    let end = item.end;

    const update = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      if (!moved) {
        moved = true;
        block.classList.add('z-20', 'opacity-80', 'shadow-lg');
      }
      const copying = ev.altKey && !resize;
      // Alt/Option ingedrukt: dit wordt een kopie, aangegeven met een streeprand
      block.classList.toggle('outline-2', copying);
      block.classList.toggle('outline-dashed', copying);
      block.classList.toggle('outline-accent', copying);
      // scrollen tijdens het slepen verschuift de muis ten opzichte van het raster
      const scrolled = (scroller?.scrollTop ?? 0) - startScroll;
      const delta = snap(((ev.clientY - startY + scrolled) / hourPx()) * 60);
      if (resize) {
        end = clamp(item.end + delta, item.start + SNAP, 24 * 60);
      } else {
        start = clamp(item.start + delta, 0, 24 * 60 - length);
        end = start + length;
        const rects = columns.map((c) => c.column.getBoundingClientRect());
        const hit = rects.findIndex((r) => ev.clientX >= r.left && ev.clientX < r.right);
        if (hit !== -1) idx = hit;
        // schuiven met een transform: het blok verplaatsen in de DOM zou de pointer-capture verliezen
        block.style.transform = `translateX(${rects[idx].left - rects[srcIdx].left}px)`;
      }
      place(block, { start, end, col: 0, cols: 1 });
      const when = resize
        ? `${fmtTime(fromMinutes(start))}–${fmtTime(fromMinutes(end))} (${durationLabel(end - start)})`
        : `${dayLabel(columns[idx].key)} · ${fmtTime(fromMinutes(start))}–${fmtTime(fromMinutes(end))}`;
      // boven een agenda in de zijbalk: loslaten verplaatst naar die agenda
      overCalendar = resize ? null : calendarAt(ev.clientX, ev.clientY);
      highlightCalendar(overCalendar);
      if (overCalendar) {
        const name = data.calendars.find((c) => c.id === overCalendar)?.name ?? '';
        showDragLabel(ev.clientX, ev.clientY, `Verplaatsen naar “${name}”`);
      } else showDragLabel(ev.clientX, ev.clientY, (copying ? 'Kopie · ' : '') + when);
    };

    const auto = scroller ? createAutoScroll(scroller, () => update(last)) : null;

    const onMove = (ev: PointerEvent) => {
      last = ev;
      update(ev);
      if (moved) auto?.update(ev.clientY);
    };

    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      auto?.stop();
      hideDragLabel();
      releaseRender();
      highlightCalendar(null);
      if (!moved) return;
      if (overCalendar) {
        hooks.render(); // het blok terug op zijn plek; de afspraak zelf blijft op zijn tijd staan
        hooks.changeCalendar(occ, overCalendar);
      } else if (resize) {
        const base = occ.base;
        const baseStart = toMinutes(base.time);
        const baseEnd = base.endTime ? toMinutes(base.endTime) : baseStart + 60;
        const newEnd = clamp(baseEnd + (end - item.end), baseStart + SNAP, 24 * 60 - 1);
        void hooks.moveOcc(occ, { toTimed: { time: base.time, endTime: fromMinutes(newEnd) } });
      } else if (idx !== srcIdx || start !== item.start) {
        void hooks.moveOcc(occ, {
          days: idx - srcIdx,
          startMinutes: start - item.start,
          copy: up.type === 'pointerup' && up.altKey,
        });
      } else {
        hooks.render();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// een leeg stuk van de kolom slepen maakt een nieuwe afspraak
function attachCreateDrag(column: HTMLElement, key: string) {
  column.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('[data-okey], [data-inline]')) return;
    holdRender();
    const from = clamp(snap(minutesAt(e.clientY, column) - SNAP / 2), 0, 24 * 60 - SNAP);
    const scroller = column.closest<HTMLElement>('.overflow-y-auto');
    const startY = e.clientY;
    let last: PointerEvent = e;
    let ghost: HTMLElement | null = null;
    let to = from + 60;

    const update = (ev: PointerEvent) => {
      if (!ghost && Math.abs(ev.clientY - startY) < 6) return;
      if (!ghost) {
        ghost = el(
          'div',
          'pointer-events-none absolute inset-x-0.5 rounded-md border-l-[3px] border-accent bg-accent/25 px-1.5 text-xs font-semibold',
        );
        column.append(ghost);
      }
      to = clamp(snap(minutesAt(ev.clientY, column)), from + SNAP, 24 * 60 - 1);
      ghost.style.top = `${(from * hourPx()) / 60}px`;
      ghost.style.height = `${((to - from) * hourPx()) / 60}px`;
      ghost.textContent = `${fmtTime(fromMinutes(from))}–${fmtTime(fromMinutes(to))}`;
      showDragLabel(
        ev.clientX,
        ev.clientY,
        `${dayLabel(key)} · ${fmtTime(fromMinutes(from))}–${fmtTime(fromMinutes(to))} (${durationLabel(to - from)})`,
      );
    };
    const auto = scroller ? createAutoScroll(scroller, () => update(last)) : null;
    const onMove = (ev: PointerEvent) => {
      last = ev;
      update(ev);
      if (ghost) auto?.update(ev.clientY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      auto?.stop();
      hideDragLabel();
      if (!ghost) return releaseRender();
      ghost.remove();
      startInlineCreate(column, key, from, to);
      releaseRender(); // de eigen hold van het slepen; het invoerveld houdt zijn eigen hold vast
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// Een nieuwe afspraak maken door de titel meteen in het raster te typen (zoals Apple Agenda):
// Enter bewaart, Escape annuleert, ⌘/Ctrl+Enter opent het volledige formulier; wegklikken bewaart als er een titel is.
function startInlineCreate(column: HTMLElement, key: string, from: number, to: number) {
  holdRender();
  const block = el(
    'div',
    'absolute z-30 flex flex-col overflow-hidden rounded-md border-l-[3px] border-accent bg-accent/25 px-1.5 py-0.5 text-xs shadow-md',
  );
  block.dataset.inline = '1';
  place(block, { start: from, end: to, col: 0, cols: 1 });
  const input = el('input', 'w-full bg-transparent font-semibold outline-none placeholder:text-fg/50');
  input.type = 'text';
  input.placeholder = 'Nieuwe afspraak';
  input.setAttribute('aria-label', 'Titel van de nieuwe afspraak');
  const range = `${fmtTime(fromMinutes(from))}–${fmtTime(fromMinutes(to))}`;
  block.append(input, el('div', 'truncate text-[11px] text-muted', `${dayLabel(key)} · ${range}`));
  column.append(block);
  input.focus();

  let finished = false;
  const finish = (mode: 'save' | 'cancel' | 'more') => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    block.remove();
    const times = { date: key, time: fromMinutes(from), endTime: fromMinutes(to) };
    if (mode === 'more') hooks.newEvent({ ...times, prefill: { title } });
    else if (mode === 'save' && title) {
      store.addEvent({
        ...times,
        endDate: key,
        title,
        calendarId: defaultCalendarId(),
        alert: data.settings.defaultAlert,
      });
    }
    // een tekenronde die tijdens het typen werd uitgesteld (bijv. door een synchronisatie) volgt nu
    releaseRender();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // sneltoetsen van de app (bijv. Delete, pijltjes) horen hier niet te werken
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(e.metaKey || e.ctrlKey ? 'more' : 'save');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish('cancel');
    }
  });
  input.addEventListener('blur', () => finish(input.value.trim() ? 'save' : 'cancel'));
  // klikken in het blok zelf mag geen nieuw blok starten
  block.addEventListener('pointerdown', (e) => e.stopPropagation());
}

// Zoomt het uurraster met `factor` (bijv. 1,1 = 10% groter) en houdt het tijdstip onder de cursor op zijn plek.
// `factor` null zet de standaardhoogte terug. `redraw` tekent de weergave opnieuw (zonder glij-animatie).
export function zoomTimeGrid(root: HTMLElement, factor: number | null, clientY: number | null, redraw: () => void) {
  const scroller = root.querySelector<HTMLElement>('.overflow-y-auto');
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const offset = (clientY ?? rect.top + rect.height / 2) - rect.top;
  const minutes = ((scroller.scrollTop + offset) / hourHeight) * 60;
  const next = factor === null ? DEFAULT_HOUR_PX : clamp(Math.round(hourHeight * factor), MIN_HOUR_PX, MAX_HOUR_PX);
  if (next === hourHeight) return;
  hourHeight = next;
  try {
    if (next === DEFAULT_HOUR_PX) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // niet onthouden is geen ramp
  }
  scrollTop = Math.max(0, (minutes / 60) * next - offset);
  redraw();
}

// Scrolt het uurraster naar het huidige tijdstip (iets onder de bovenkant), zacht tenzij beweging verminderd is.
export function scrollToNow(root: HTMLElement) {
  const scroller = root.querySelector<HTMLElement>('.overflow-y-auto');
  if (!scroller) return;
  const target = Math.max(0, (nowMinutes() * hourPx()) / 60 - scroller.clientHeight / 3);
  const reduced = reduceMotion();
  scroller.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
}
