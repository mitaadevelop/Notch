// zijbalk: mini-maand, agenda's en de afspraken van de geselecteerde dag
import { occurrencesBetween } from './occurrences.ts';
import { COLORS } from './colors.ts';
import { DURATION, EASE, play } from './motion.ts';
import { drag, dropEffect, highlightCalendar } from './occ-ui.ts';
import { hideDragLabel, showDragLabel } from './dragkit.ts';
import { colorOfOcc, data, hooks, ui } from './state.ts';
import { timesLabel } from './format.ts';
import {
  $,
  addDays,
  dayHeading,
  daysInMonth,
  diffDays,
  el,
  fromKey,
  isoWeek,
  makeKey,
  monthLong,
  todayKey,
  weekdayNarrow,
  weekStartOf,
} from './util.ts';

export function renderSidebar() {
  renderMini();
  renderCalendars();
  renderDayList();
}

function renderMini() {
  const first = fromKey(ui.miniKey);
  first.setDate(1);
  const firstKey = makeKey(first.getFullYear(), first.getMonth(), 1);
  const start = weekStartOf(firstKey, data.settings.weekStart);
  const offset = (first.getDay() - data.settings.weekStart + 7) % 7;
  const weeks = Math.ceil((offset + daysInMonth(first.getFullYear(), first.getMonth())) / 7);
  const showWeeks = data.settings.weekNumbers;
  const gridClass = showWeeks ? 'grid grid-cols-[1.25rem_repeat(7,1fr)]' : 'grid grid-cols-7';

  $('mini-title').textContent = `${monthLong.format(first)} ${first.getFullYear()}`;

  const weekdays = $('mini-weekdays');
  weekdays.className = `${gridClass} text-center text-[10px] text-muted uppercase`;
  const names = Array.from({ length: 7 }, (_, i) => el('span', '', weekdayNarrow.format(fromKey(addDays(start, i)))));
  weekdays.replaceChildren(...(showWeeks ? [el('span')] : []), ...names);

  const events = new Set<string>();
  for (const occ of occurrencesBetween(data, start, addDays(start, weeks * 7 - 1))) {
    for (let key = occ.date; key <= occ.endDate; key = addDays(key, 1)) events.add(key);
  }

  const cells: HTMLElement[] = [];
  let selected: HTMLElement | null = null;
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(start, i);
    if (showWeeks && i % 7 === 0)
      cells.push(el('span', 'self-center text-center text-[10px] text-muted', String(isoWeek(addDays(key, 3)))));
    const date = fromKey(key);
    const inMonth = date.getMonth() === first.getMonth();
    const isToday = key === todayKey();
    const button = el(
      'button',
      'relative mx-auto flex size-6 items-center justify-center rounded-full text-xs ' +
        (isToday
          ? 'bg-today font-semibold text-white'
          : key === ui.selectedDate
            ? 'font-semibold'
            : inMonth
              ? 'hover:bg-fill'
              : 'text-muted hover:bg-fill'),
      String(date.getDate()),
    );
    button.type = 'button';
    if (key === ui.selectedDate && !isToday) selected = button;
    if (events.has(key) && !isToday)
      button.append(el('span', 'pointer-events-none absolute bottom-0.5 size-0.5 rounded-full bg-muted'));
    button.addEventListener('click', () => hooks.selectDate(key));
    // een afspraak op een dag in de minikalender neerzetten verplaatst hem (met Alt: kopieert)
    button.addEventListener('dragover', (e) => {
      if (!drag.occ) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = dropEffect(e);
      button.classList.add('ring-2', 'ring-accent');
    });
    button.addEventListener('dragleave', () => button.classList.remove('ring-2', 'ring-accent'));
    button.addEventListener('drop', (e) => {
      if (!drag.occ) return;
      e.preventDefault();
      button.classList.remove('ring-2', 'ring-accent');
      const occ = drag.occ;
      drag.occ = null;
      const days = diffDays(occ.date, key);
      if (days || e.altKey) void hooks.moveOcc(occ, { days, copy: e.altKey });
    });
    cells.push(button);
  }
  const grid = $('mini-grid');
  grid.className = `${gridClass} relative gap-y-0.5`;
  grid.replaceChildren(...cells);
  glideSelection(grid, selected, first.getFullYear() * 12 + first.getMonth());
}

// De cirkel om de gekozen dag is een eigen element dat van de vorige naar de nieuwe dag glijdt (binnen dezelfde maand).
let lastSelection: { x: number; y: number; month: number } | null = null;

function glideSelection(grid: HTMLElement, button: HTMLElement | null, month: number) {
  if (!button) {
    lastSelection = null;
    return;
  }
  const ring = el('span', 'pointer-events-none absolute size-6 rounded-full bg-fg/15');
  ring.style.left = `${button.offsetLeft}px`;
  ring.style.top = `${button.offsetTop}px`;
  grid.prepend(ring);
  const previous = lastSelection;
  lastSelection = { x: button.offsetLeft, y: button.offsetTop, month };
  if (previous && previous.month === month && (previous.x !== button.offsetLeft || previous.y !== button.offsetTop)) {
    void play(
      ring,
      [
        { transform: `translate(${previous.x - button.offsetLeft}px, ${previous.y - button.offsetTop}px)` },
        { transform: 'none' },
      ],
      { duration: DURATION.slow, easing: EASE.spring },
    );
  } else if (!previous || previous.month !== month) {
    void play(
      ring,
      [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: DURATION.base,
        easing: EASE.out,
      },
    );
  }
}

function renderCalendars() {
  $('cal-list').replaceChildren(
    ...data.calendars.map((calendar) => {
      const color = COLORS[calendar.color] ?? COLORS.blue;
      const li = el('li');
      const row = el('div', 'group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-fill');
      const toggle = el(
        'button',
        `flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${color.bar} ` +
          (calendar.visible ? color.dot : ''),
      );
      toggle.type = 'button';
      toggle.setAttribute('aria-label', `${calendar.name} ${calendar.visible ? 'verbergen' : 'tonen'}`);
      toggle.setAttribute('aria-pressed', String(calendar.visible));
      toggle.addEventListener('click', () => hooks.toggleCalendar(calendar));
      // tijdens het vernieuwen "ademt" de naam zacht (de laadstand van een externe agenda)
      const name = el(
        'span',
        'min-w-0 flex-1 truncate ' +
          (calendar.visible ? '' : 'text-muted') +
          (ui.syncing.has(calendar.id) ? ' animate-pulse' : ''),
        calendar.name,
      );
      row.append(toggle, name);
      // een afspraak op een eigen agenda neerzetten verplaatst hem naar die agenda
      if (calendar.type !== 'holidays' && !calendar.source) {
        row.dataset.calid = calendar.id;
        row.addEventListener('dragover', (e) => {
          if (!drag.occ) return;
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'move';
          highlightCalendar(calendar.id);
          showDragLabel(e.clientX, e.clientY, `Verplaatsen naar “${calendar.name}”`);
        });
        row.addEventListener('dragleave', (e) => {
          if (row.contains(e.relatedTarget as Node | null)) return;
          highlightCalendar(null);
          hideDragLabel();
        });
        row.addEventListener('drop', (e) => {
          if (!drag.occ) return;
          e.preventDefault();
          const occ = drag.occ;
          drag.occ = null;
          highlightCalendar(null);
          hideDragLabel();
          hooks.changeCalendar(occ, calendar.id);
        });
      }
      if (calendar.source) {
        if (ui.syncing.has(calendar.id)) {
          const spinner = el('span', 'shrink-0 animate-spin text-xs text-muted', '⟳');
          spinner.setAttribute('role', 'img');
          spinner.setAttribute('aria-label', 'Bezig met vernieuwen');
          row.append(spinner);
        }
        const synced = calendar.syncedAt
          ? `bijgewerkt om ${new Date(calendar.syncedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
          : 'nog niet bijgewerkt';
        row.title = `Externe agenda (alleen-lezen), ${synced}`;
        if (calendar.syncError) {
          const warning = el('span', 'shrink-0 text-xs text-today', '⚠');
          warning.title = `Vernieuwen mislukt: ${calendar.syncError}`;
          warning.setAttribute('role', 'img');
          warning.setAttribute('aria-label', `Vernieuwen mislukt: ${calendar.syncError}`);
          row.append(warning);
        }
      }
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        hooks.calendarMenu(calendar);
      });
      row.addEventListener('dblclick', () => hooks.editCalendar(calendar));
      li.append(row);
      return li;
    }),
  );
}

function renderDayList() {
  $('day-title').textContent = dayHeading.format(fromKey(ui.selectedDate));
  const list = $('day-list');
  const items = occurrencesBetween(data, ui.selectedDate, ui.selectedDate);
  if (!items.length) {
    list.replaceChildren(el('li', 'px-1 text-sm text-muted', 'Geen afspraken'));
    return;
  }
  list.replaceChildren(
    ...items.map((occ) => {
      const color = colorOfOcc(occ);
      const li = el('li');
      const button = el('button', 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill');
      button.type = 'button';
      const text = el('span', 'min-w-0');
      text.append(
        el('span', 'block truncate text-sm font-medium', occ.title),
        el('span', 'block text-xs text-muted', timesLabel(occ)),
      );
      button.append(el('span', `size-2 shrink-0 rounded-full ${color.dot}`), text);
      if (!occ.holiday) button.addEventListener('click', () => hooks.openOcc(occ));
      li.append(button);
      return li;
    }),
  );
}
