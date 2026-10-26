const $ = (id) => document.getElementById(id);

if (window.agenda.platform === 'darwin') document.documentElement.classList.add('vibrancy');

const viewRoot = $('view');
const titleEl = $('title');
const miniTitle = $('mini-title');
const miniWeekdays = $('mini-weekdays');
const miniGrid = $('mini-grid');
const dayTitle = $('day-title');
const dayList = $('day-list');
const viewSwitch = $('view-switch');

const dialog = $('event-dialog');
const form = $('event-form');
const fTitle = $('f-title');
const fAllDay = $('f-allday');
const fDate = $('f-date');
const fFrom = $('f-from');
const fTo = $('f-to');
const fColors = $('f-colors');
const fNotes = $('f-notes');
const fSave = $('f-save');
const fDelete = $('f-delete');
const fCancel = $('f-cancel');

const HOUR_PX = 48;
const MAX_CHIPS = 3;
const DEFAULT_COLOR = 'blue';

// volledige klassenamen als literals, zodat Tailwind ze in dit bestand vindt
const COLORS = {
  red: { label: 'Rood', bar: 'border-cal-red', chip: 'bg-cal-red/20', dot: 'bg-cal-red' },
  orange: { label: 'Oranje', bar: 'border-cal-orange', chip: 'bg-cal-orange/20', dot: 'bg-cal-orange' },
  yellow: { label: 'Geel', bar: 'border-cal-yellow', chip: 'bg-cal-yellow/20', dot: 'bg-cal-yellow' },
  green: { label: 'Groen', bar: 'border-cal-green', chip: 'bg-cal-green/20', dot: 'bg-cal-green' },
  blue: { label: 'Blauw', bar: 'border-cal-blue', chip: 'bg-cal-blue/20', dot: 'bg-cal-blue' },
  purple: { label: 'Paars', bar: 'border-cal-purple', chip: 'bg-cal-purple/20', dot: 'bg-cal-purple' },
  brown: { label: 'Bruin', bar: 'border-cal-brown', chip: 'bg-cal-brown/20', dot: 'bg-cal-brown' },
  gray: { label: 'Grijs', bar: 'border-cal-gray', chip: 'bg-cal-gray/20', dot: 'bg-cal-gray' },
};
const colorOf = (event) => COLORS[event.color] ?? COLORS[DEFAULT_COLOR];

const SEGMENT_BASE = 'rounded-md px-3 py-0.5 text-sm ';
const SEGMENT_ACTIVE = 'bg-seg font-medium shadow-sm';
const SEGMENT_IDLE = 'text-fg/70';

// --- datums: 'YYYY-MM-DD' strings, zodat tijdzones nergens meespelen ---

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (key, n) => {
  const date = fromKey(key);
  date.setDate(date.getDate() + n);
  return keyOf(date);
};
const addMonths = (key, n) => {
  const date = fromKey(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + n);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return keyOf(date);
};
// week begint op maandag: zondag (0) wordt 6
const mondayOf = (key) => addDays(key, -((fromKey(key).getDay() + 6) % 7));
const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

const fmt = (options) => new Intl.DateTimeFormat('nl-NL', options);
const monthLong = fmt({ month: 'long' });
const monthShort = fmt({ month: 'short' });
const weekdayShort = fmt({ weekday: 'short' });
const weekdayNarrow = fmt({ weekday: 'narrow' });
const dayHeading = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

const todayKey = keyOf(new Date());

// --- state ---

let events = [];
let view = 'month';
let selectedDate = todayKey;
let miniKey = todayKey;
let editingId = null;
let timeScroll = 7 * HOUR_PX;

const byDateTime = (a, b) =>
  a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');

const eventsOn = (key) => events.filter((e) => e.date === key).sort(byDateTime);

const timesLabel = (event) =>
  event.time ? (event.endTime ? `${event.time}–${event.endTime}` : event.time) : 'hele dag';

async function persist() {
  await window.agenda.save(events);
}

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- afspraak-blokjes ---

function chip(event, showTime = true) {
  const color = colorOf(event);
  const node = el(
    'button',
    `flex w-full min-w-0 items-center gap-1 rounded-[5px] border-l-[3px] px-1.5 py-px text-left text-xs/5 hover:brightness-95 ${color.chip} ${color.bar}`,
  );
  node.type = 'button';
  if (showTime && event.time) node.append(el('span', 'shrink-0 text-muted', event.time));
  node.append(el('span', 'truncate font-medium', event.title));
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    openDialog({ event });
  });
  return node;
}

// --- titel en weergave-knoppen ---

function renderToolbar() {
  const date = fromKey(selectedDate);
  let main;
  let sub = String(date.getFullYear());

  if (view === 'month') {
    main = monthLong.format(date);
  } else if (view === 'week') {
    const start = fromKey(mondayOf(selectedDate));
    const end = fromKey(addDays(mondayOf(selectedDate), 6));
    main =
      start.getMonth() === end.getMonth()
        ? monthLong.format(start)
        : `${monthShort.format(start)} – ${monthShort.format(end)}`;
    sub = String(end.getFullYear());
  } else {
    main = `${date.getDate()} ${monthLong.format(date)}`;
  }

  titleEl.replaceChildren(el('span', 'font-bold capitalize', main), el('span', 'ml-1.5 text-muted', sub));

  for (const button of viewSwitch.children) {
    button.className = SEGMENT_BASE + (button.dataset.view === view ? SEGMENT_ACTIVE : SEGMENT_IDLE);
  }
}

// --- maandweergave ---

function renderMonthView() {
  const first = fromKey(selectedDate);
  first.setDate(1);
  const gridStart = mondayOf(keyOf(first));
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);

  const header = el('div', 'grid shrink-0 grid-cols-7 border-b border-line');
  for (let i = 0; i < 7; i++) {
    header.append(el('span', 'px-2 py-1 text-right text-xs text-muted capitalize', weekdayShort.format(fromKey(addDays(gridStart, i)))));
  }

  const grid = el('div', 'grid min-h-0 flex-1 grid-cols-7 auto-rows-fr');
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(gridStart, i);
    const date = fromKey(key);
    const inMonth = date.getMonth() === first.getMonth();

    const cell = el(
      'div',
      'flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-b border-line p-1 ' +
        (key === selectedDate ? 'bg-fill' : ''),
    );
    cell.dataset.key = key;

    const number = el(
      'span',
      'mb-0.5 self-end rounded-full px-1.5 text-sm ' +
        (key === todayKey ? 'bg-today font-semibold text-white' : inMonth ? '' : 'text-muted'),
      date.getDate() === 1 ? `1 ${monthShort.format(date)}` : String(date.getDate()),
    );
    cell.append(number);

    const items = eventsOn(key);
    for (const event of items.slice(0, MAX_CHIPS)) cell.append(chip(event));
    if (items.length > MAX_CHIPS) {
      const more = el('button', 'px-1.5 text-left text-xs text-muted hover:text-fg', `${items.length - MAX_CHIPS} meer…`);
      more.type = 'button';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        view = 'day';
        select(key);
      });
      cell.append(more);
    }

    cell.addEventListener('click', () => select(key));
    cell.addEventListener('dblclick', () => openDialog({ date: key, allDay: true }));
    grid.append(cell);
  }

  viewRoot.replaceChildren(header, grid);
}

function markSelected() {
  for (const cell of viewRoot.querySelectorAll('[data-key]')) {
    cell.classList.toggle('bg-fill', cell.dataset.key === selectedDate);
  }
}

// --- dag- en weekweergave (uurraster) ---

// zet overlappende afspraken naast elkaar
function layoutDay(items) {
  const placed = [];
  let cluster = [];
  let clusterEnd = 0;

  const flush = () => {
    const columnEnds = [];
    for (const item of cluster) {
      let col = columnEnds.findIndex((end) => end <= item.start);
      if (col === -1) col = columnEnds.length;
      columnEnds[col] = item.end;
      item.col = col;
    }
    for (const item of cluster) {
      item.cols = columnEnds.length;
      placed.push(item);
    }
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

function timedBlock({ event, start, end, col, cols }) {
  const color = colorOf(event);
  const block = el(
    'button',
    `absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs hover:brightness-95 ${color.chip} ${color.bar}`,
  );
  block.type = 'button';
  const height = Math.max(((end - start) * HOUR_PX) / 60 - 1, 18);
  block.style.top = `${(start * HOUR_PX) / 60}px`;
  block.style.height = `${height}px`;
  block.style.left = `calc(${(col / cols) * 100}% + 1px)`;
  block.style.width = `calc(${100 / cols}% - 3px)`;
  if (height < 36) {
    // korte afspraak: titel en tijd op één regel
    const line = el('div', 'flex items-baseline gap-1');
    line.append(el('span', 'truncate font-semibold', event.title), el('span', 'shrink-0 text-[11px] text-muted', event.time));
    block.append(line);
  } else {
    block.append(el('div', 'truncate font-semibold', event.title), el('div', 'truncate text-[11px] text-muted', timesLabel(event)));
  }
  block.addEventListener('click', (e) => {
    e.stopPropagation();
    openDialog({ event });
  });
  return block;
}

function renderTimeView(days) {
  const gutter = 'w-14 shrink-0';

  const header = el('div', 'flex shrink-0 border-b border-line');
  header.append(el('div', gutter));
  for (const key of days) {
    const date = fromKey(key);
    const isToday = key === todayKey;
    const cell = el('div', 'flex flex-1 items-center justify-center gap-1.5 border-l border-line py-1.5');
    cell.append(
      el('span', 'text-xs text-muted capitalize', weekdayShort.format(date)),
      el(
        'span',
        'rounded-full px-1.5 text-lg ' + (isToday ? 'bg-today font-semibold text-white' : ''),
        String(date.getDate()),
      ),
    );
    header.append(cell);
  }

  const children = [header];

  if (days.some((key) => eventsOn(key).some((e) => !e.time))) {
    const allDay = el('div', 'flex shrink-0 border-b border-line');
    allDay.append(el('div', `${gutter} pt-1.5 pr-2 text-right text-[10px] text-muted`, 'hele dag'));
    for (const key of days) {
      const cell = el('div', 'flex min-w-0 flex-1 flex-col gap-0.5 border-l border-line p-1');
      for (const event of eventsOn(key).filter((e) => !e.time)) cell.append(chip(event, false));
      allDay.append(cell);
    }
    children.push(allDay);
  }

  // scrollbalk verborgen (net als macOS-overlay), zodat de kolommen onder de kop blijven uitlijnen
  const scroller = el('div', 'min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]');
  const body = el('div', 'flex');

  const hours = el('div', gutter);
  for (let h = 0; h < 24; h++) {
    const label = el('div', 'relative h-12');
    if (h > 0) label.append(el('span', 'absolute -top-2 right-2 text-[10px] text-muted', fromMinutes(h * 60)));
    hours.append(label);
  }
  body.append(hours);

  const now = new Date();
  for (const key of days) {
    const column = el('div', 'relative min-w-0 flex-1 border-l border-line');
    for (let h = 0; h < 24; h++) column.append(el('div', 'h-12 border-b border-line'));

    const timed = eventsOn(key)
      .filter((e) => e.time)
      .map((event) => {
        const start = toMinutes(event.time);
        const end = event.endTime ? toMinutes(event.endTime) : start + 60;
        return { event, start, end: Math.min(Math.max(end, start + 15), 24 * 60) };
      });
    for (const item of layoutDay(timed)) column.append(timedBlock(item));

    if (key === todayKey) {
      const line = el('div', 'pointer-events-none absolute inset-x-0 h-px bg-today');
      line.style.top = `${((now.getHours() * 60 + now.getMinutes()) * HOUR_PX) / 60}px`;
      line.append(el('div', 'absolute -top-[3px] -left-1 size-2 rounded-full bg-today'));
      column.append(line);
    }

    column.addEventListener('dblclick', (e) => {
      const y = e.clientY - column.getBoundingClientRect().top;
      const minutes = Math.min(Math.floor(((y / HOUR_PX) * 60) / 30) * 30, 23 * 60);
      openDialog({ date: key, time: fromMinutes(minutes) });
    });
    body.append(column);
  }

  scroller.append(body);
  scroller.addEventListener('scroll', () => {
    timeScroll = scroller.scrollTop;
  });
  children.push(scroller);

  viewRoot.replaceChildren(...children);
  scroller.scrollTop = timeScroll;
}

// --- zijbalk: mini-maand en dagoverzicht ---

function renderMini() {
  const first = fromKey(miniKey);
  first.setDate(1);
  const gridStart = mondayOf(keyOf(first));
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);

  miniTitle.textContent = `${monthLong.format(first)} ${first.getFullYear()}`;

  miniWeekdays.replaceChildren(
    ...Array.from({ length: 7 }, (_, i) => el('span', '', weekdayNarrow.format(fromKey(addDays(gridStart, i))))),
  );

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(gridStart, i);
    const date = fromKey(key);
    const inMonth = date.getMonth() === first.getMonth();
    const isToday = key === todayKey;
    const isSelected = key === selectedDate;

    const button = el(
      'button',
      'mx-auto flex size-6 flex-col items-center justify-center rounded-full text-xs ' +
        (isToday
          ? 'bg-today font-semibold text-white'
          : isSelected
            ? 'bg-fg/15 font-semibold'
            : inMonth
              ? 'hover:bg-fill'
              : 'text-muted hover:bg-fill'),
      String(date.getDate()),
    );
    button.type = 'button';
    button.addEventListener('click', () => select(key));
    cells.push(button);
  }
  miniGrid.replaceChildren(...cells);
}

function renderDayList() {
  dayTitle.textContent = dayHeading.format(fromKey(selectedDate));

  const items = eventsOn(selectedDate);
  if (items.length === 0) {
    dayList.replaceChildren(el('li', 'px-1 text-sm text-muted', 'Geen afspraken'));
    return;
  }

  dayList.replaceChildren(
    ...items.map((event) => {
      const color = colorOf(event);
      const li = el('li');
      const button = el('button', 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill');
      button.type = 'button';
      const text = el('span', 'min-w-0');
      text.append(el('span', 'block truncate text-sm font-medium', event.title), el('span', 'block text-xs text-muted', timesLabel(event)));
      button.append(el('span', `size-2 shrink-0 rounded-full ${color.dot}`), text);
      button.addEventListener('click', () => openDialog({ event }));
      li.append(button);
      return li;
    }),
  );
}

// --- renderen en navigeren ---

function render() {
  renderToolbar();
  if (view === 'month') renderMonthView();
  else if (view === 'week') {
    const start = mondayOf(selectedDate);
    renderTimeView(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  } else renderTimeView([selectedDate]);
  renderMini();
  renderDayList();
}

function select(key) {
  const sameMonthView = view === 'month' && key.slice(0, 7) === selectedDate.slice(0, 7);
  selectedDate = key;
  miniKey = key;
  if (sameMonthView) {
    // geen volledige render, zodat een dubbelklik op dezelfde cel niet verloren gaat
    markSelected();
    renderToolbar();
    renderMini();
    renderDayList();
  } else {
    render();
  }
}

function navigate(direction) {
  if (view === 'month') select(addMonths(selectedDate, direction));
  else select(addDays(selectedDate, (view === 'week' ? 7 : 1) * direction));
}

viewSwitch.addEventListener('click', (e) => {
  const next = e.target.closest('[data-view]')?.dataset.view;
  if (!next || next === view) return;
  view = next;
  render();
});
$('prev').addEventListener('click', () => navigate(-1));
$('next').addEventListener('click', () => navigate(1));
$('today').addEventListener('click', () => select(todayKey));
$('mini-prev').addEventListener('click', () => {
  miniKey = addMonths(miniKey, -1);
  renderMini();
});
$('mini-next').addEventListener('click', () => {
  miniKey = addMonths(miniKey, 1);
  renderMini();
});
$('add').addEventListener('click', () => openDialog({ date: selectedDate }));
$('sidebar-add').addEventListener('click', () => openDialog({ date: selectedDate }));

// --- dialoog voor nieuwe/bestaande afspraak ---

let formColor = DEFAULT_COLOR;

function renderSwatches() {
  fColors.replaceChildren(
    ...Object.entries(COLORS).map(([name, color]) => {
      const swatch = el(
        'button',
        `size-5 rounded-full ${color.dot} ` + (name === formColor ? 'outline-2 outline-offset-2 outline-fg/60' : ''),
      );
      swatch.type = 'button';
      swatch.title = color.label;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-checked', String(name === formColor));
      swatch.addEventListener('click', () => {
        formColor = name;
        renderSwatches();
      });
      return swatch;
    }),
  );
}

function syncAllDay() {
  fFrom.disabled = fTo.disabled = fAllDay.checked;
  fFrom.required = !fAllDay.checked;
}

function openDialog({ event, date, time, allDay = false }) {
  editingId = event?.id ?? null;
  fTitle.value = event?.title ?? '';
  fDate.value = event?.date ?? date ?? selectedDate;
  fNotes.value = event?.notes ?? '';
  formColor = event?.color ?? DEFAULT_COLOR;

  // nieuwe afspraak zonder opgegeven tijd: begin op het volgende hele uur
  const now = new Date();
  const start = time ?? fromMinutes(Math.min((now.getHours() + 1) * 60, 23 * 60));
  fAllDay.checked = event ? !event.time : allDay;
  fFrom.value = event?.time ?? start;
  fTo.value = event ? (event.endTime ?? '') : fromMinutes(Math.min(toMinutes(start) + 60, 24 * 60 - 1));

  fSave.textContent = event ? 'Bewaar' : 'Voeg toe';
  fDelete.hidden = !event;
  syncAllDay();
  renderSwatches();
  fTo.setCustomValidity('');
  dialog.showModal();
  fTitle.focus();
  fTitle.select();
}

fAllDay.addEventListener('change', syncAllDay);
fTo.addEventListener('input', () => fTo.setCustomValidity(''));
fFrom.addEventListener('input', () => fTo.setCustomValidity(''));
fCancel.addEventListener('click', () => dialog.close());
// klik op de donkere achtergrond sluit de dialoog
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = fTitle.value.trim();
  if (!title || !fDate.value) return;

  const allDay = fAllDay.checked;
  if (!allDay && fTo.value && toMinutes(fTo.value) <= toMinutes(fFrom.value)) {
    fTo.setCustomValidity('De eindtijd moet na de starttijd liggen.');
    fTo.reportValidity();
    return;
  }

  const data = {
    title,
    date: fDate.value,
    time: allDay ? '' : fFrom.value,
    endTime: allDay ? '' : fTo.value,
    color: formColor,
    notes: fNotes.value.trim(),
  };

  if (editingId === null) {
    events.push({ id: crypto.randomUUID(), ...data });
  } else {
    events = events.map((ev) => (ev.id === editingId ? { ...ev, ...data } : ev));
  }

  dialog.close();
  selectedDate = miniKey = data.date;
  render();
  await persist();
});

fDelete.addEventListener('click', async () => {
  events = events.filter((ev) => ev.id !== editingId);
  dialog.close();
  render();
  await persist();
});

(async () => {
  events = await window.agenda.load();
  render();
})();
