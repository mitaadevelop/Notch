import type { Calendar, EventOcc, MenuItemSpec, NativeEditCommand, Occurrence, Scope, View } from '../shared/types.ts';
import { dueAlerts, dueDepartures } from './alerts.ts';
import {
  askScope,
  closeQuick,
  openCalendarDialog,
  openEventDialog,
  openQuick,
  openSettings,
  quickOpen,
} from './dialogs.ts';
import { timesLabel } from './format.ts';
import { toICS } from './ics.ts';
import { isDone } from './model.ts';
import { renderListView, renderSearch } from './list.ts';
import { renderMonthView } from './month.ts';
import { occurrencesBetween } from './occurrences.ts';
import { drawWithFlip } from './flip.ts';
import { nearestInDirection } from './keynav.ts';
import { initDropzone } from './dropzone.ts';
import { initBackups } from './backups.ts';
import { initChat, openChat } from './chatview.ts';
import { initClaude } from './claude.ts';
import { DURATION, EASE, enterView, initDialogOrigin, reduceMotion, staggerIn } from './motion.ts';
import { initMcp } from './mcp.ts';
import { checkNow, initUpdates } from './updates.ts';
import { importIcsTexts } from './importing.ts';
import { openPalette, setCommands } from './palette.ts';
import { optionsFromTemplate } from './templates.ts';
import { initRubberBand } from './rubberband.ts';
import { closeSearchPop, searchPopKey, updateSearchPop } from './searchpop.ts';
import type { Direction } from './keynav.ts';
import { closePopovers, pin } from './popover.ts';
import { refreshSelection, resetTransitionNames } from './occ-ui.ts';
import { renderSidebar } from './sidebar.ts';
import { showReminderCard, snooze, takeDueSnoozes } from './reminders.ts';
import type { Reminder } from './reminders.ts';
import {
  clearSelection,
  data,
  holdRender,
  hooks,
  isReadOnly,
  occRegistry,
  releaseRender,
  selectedEvents,
  ui,
} from './state.ts';
import { openSourceDialog } from './sources.ts';
import * as store from './store.ts';
import { isSyncing, startAutoSync, syncAll, syncCalendar } from './sync.ts';
import { createSwipeDetector, createZoomAccumulator } from './gestures.ts';
import { renderTimeGrid, scrollToNow, updateNowLine, zoomTimeGrid } from './timegrid.ts';
import {
  $,
  addDays,
  addMonths,
  diffDays,
  el,
  fromKey,
  fromMinutes,
  isoWeek,
  monthLong,
  monthShort,
  toMinutes,
  todayKey,
  weekStartOf,
} from './util.ts';
import { openStats } from './statsview.ts';
import { initWeather, loadWeather } from './weather.ts';
import { initSystem, pushTray, schedulePushTray, startSystem } from './system.ts';
import { renderYearView } from './year.ts';

const viewRoot = $('view');
const viewSwitch = $('view-switch');
const searchInput = $<HTMLInputElement>('search');

const SEGMENT_BASE = 'rounded-md px-3 py-0.5 text-sm ';
const SEGMENT_ACTIVE = 'bg-seg font-medium shadow-sm';
const SEGMENT_IDLE = 'text-fg/70';

// --- werkbalk ---

function renderToolbar() {
  const date = fromKey(ui.selectedDate);
  let main: string;
  let sub = String(date.getFullYear());

  if (ui.query) {
    main = 'Zoeken';
    sub = '';
  } else if (ui.view === 'month') {
    main = monthLong.format(date);
  } else if (ui.view === 'year') {
    main = String(date.getFullYear());
    sub = '';
  } else if (ui.view === 'list') {
    main = 'Binnenkort';
    sub = '';
  } else if (ui.view === 'week') {
    const start = fromKey(weekStartOf(ui.selectedDate, data.settings.weekStart));
    const end = fromKey(addDays(weekStartOf(ui.selectedDate, data.settings.weekStart), 6));
    main =
      start.getMonth() === end.getMonth()
        ? monthLong.format(start)
        : `${monthShort.format(start)} – ${monthShort.format(end)}`;
    sub = String(end.getFullYear());
  } else {
    main = `${date.getDate()} ${monthLong.format(date)}`;
  }

  const title = $('title');
  title.replaceChildren(el('span', 'font-bold capitalize', main));
  if (sub) title.append(el('span', 'ml-1.5 text-muted', sub));
  if (!ui.query && data.settings.weekNumbers && ['day', 'week'].includes(ui.view)) {
    title.append(el('span', 'ml-3 text-sm text-muted', `week ${isoWeek(ui.selectedDate)}`));
  }

  for (const button of viewSwitch.querySelectorAll<HTMLElement>('[data-view]')) {
    const active = button.dataset.view === ui.view && !ui.query;
    button.className = SEGMENT_BASE + (active ? SEGMENT_ACTIVE : SEGMENT_IDLE);
  }
}

// --- hoofdweergave ---

function render() {
  closePopovers();
  resetTransitionNames();
  renderToolbar();
  if (ui.query) renderSearch(viewRoot);
  else if (ui.view === 'month') renderMonthView(viewRoot);
  else if (ui.view === 'year') renderYearView(viewRoot);
  else if (ui.view === 'list') renderListView(viewRoot);
  else if (ui.view === 'week') {
    const start = weekStartOf(ui.selectedDate, data.settings.weekStart);
    renderTimeGrid(
      viewRoot,
      Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    );
  } else renderTimeGrid(viewRoot, [ui.selectedDate]);
  renderSidebar();
  refreshSelection();
  window.agenda.menuState({ weekNumbers: data.settings.weekNumbers });
  schedulePushTray(); // het menubalk-icoon volgt wijzigingen
}

// laat de hoofdweergave zacht binnenkomen: opzij schuiven bij vorige/volgende, omhoog bij een andere weergave
function animateView(direction: number, zoom = 0) {
  if (reduceMotion()) return;
  void enterView(viewRoot, { direction, zoom });
  staggerIn(viewRoot);
}

// van groot naar klein: jaar > maand > week > dag; de lijst hoort er niet bij
const ZOOM_ORDER: View[] = ['year', 'month', 'week', 'day'];

function navigate(direction: number) {
  const key = ui.selectedDate;
  const next = {
    month: () => addMonths(key, direction),
    year: () => addMonths(key, 12 * direction),
    week: () => addDays(key, 7 * direction),
    day: () => addDays(key, direction),
    list: () => addDays(key, 30 * direction),
  }[ui.view]();
  hooks.selectDate(next);
  animateView(direction);
}

// --- haken voor de weergaven ---

// Wijzigingen in de data (verplaatsen, plakken, undo, synchroniseren) glijden naar hun nieuwe plek (flip.ts).
// Meerdere opdrachten in één tik worden één tekenronde. Navigatie (andere dag of weergave) tekent meteen en heeft
// zijn eigen animatie. Tijdens slepen of typen wacht het tekenen (state.holdRender).
// tekent alleen de zijbalk; tijdens slepen wacht dat (anders verdwijnen de doelen onder de muis)
hooks.refreshSidebar = () => {
  if (ui.holds) ui.renderDeferred = true;
  else renderSidebar();
};

// het vernieuwknopje bovenin: draait en is niet te dubbel-klikken zolang er wordt ververst
const refreshButton = $<HTMLButtonElement>('refresh');
hooks.syncState = () => {
  const busy = isSyncing();
  refreshButton.setAttribute('aria-busy', String(busy));
  $('refresh-icon').classList.toggle('animate-spin', busy);
};
refreshButton.addEventListener('click', () => void refreshAll());

let renderQueued = false;
hooks.render = () => {
  if (ui.holds) {
    ui.renderDeferred = true;
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    // er kan intussen een sleepactie begonnen zijn: dan later
    if (ui.holds) ui.renderDeferred = true;
    else drawWithFlip(viewRoot, render, !reduceMotion());
  });
};

hooks.selectDate = (key) => {
  const sameMonth = ui.view === 'month' && !ui.query && key.slice(0, 7) === ui.selectedDate.slice(0, 7);
  ui.selectedDate = ui.miniKey = key;
  clearSelection();
  if (sameMonth) {
    // geen volledige render, zodat een dubbelklik op dezelfde cel niet verloren gaat
    for (const cell of viewRoot.querySelectorAll<HTMLElement>('[data-key]'))
      cell.classList.toggle('bg-fill', cell.dataset.key === key);
    renderToolbar();
    renderSidebar();
    refreshSelection();
  } else {
    render();
  }
};

hooks.setView = (view, key) => {
  const zoom =
    ZOOM_ORDER.includes(view) && ZOOM_ORDER.includes(ui.view)
      ? ZOOM_ORDER.indexOf(view) - ZOOM_ORDER.indexOf(ui.view)
      : 0;
  ui.view = view;
  if (key) ui.selectedDate = ui.miniKey = key;
  ui.query = '';
  searchInput.value = '';
  closeSearchPop();
  render();
  animateView(0, Math.sign(zoom));
};

hooks.selectOcc = (occ) => {
  ui.selectedKey = occ.key;
  ui.selectedOcc = occ;
  ui.selected = new Map(occ.holiday ? [] : [[occ.key, occ]]);
  refreshSelection();
};

// ⇧/⌘-klik: een afspraak bij de selectie optellen of eraf halen
hooks.toggleOcc = (occ) => {
  if (occ.holiday) return;
  if (ui.selected.has(occ.key)) ui.selected.delete(occ.key);
  else {
    // de eerder aangeklikte afspraak hoort al bij de selectie
    if (ui.selectedOcc && !ui.selectedOcc.holiday) ui.selected.set(ui.selectedOcc.key, ui.selectedOcc);
    ui.selected.set(occ.key, occ);
  }
  const last = [...ui.selected.values()].at(-1) ?? null;
  ui.selectedKey = last?.key ?? null;
  ui.selectedOcc = last;
  refreshSelection();
};

// Met ⇧ een kader om afspraken heen trekken selecteert ze (zonder ⇧ maakt slepen een nieuwe afspraak); ⇧⌘ vult de
// selectie aan. Het moet op een lege plek beginnen: een dagcel in de maandweergave of een kolom in het uurraster.
{
  let base = new Map<string, Occurrence>();
  const additive = (e: PointerEvent) => e.metaKey || (e.ctrlKey && window.agenda.platform !== 'darwin');
  initRubberBand(viewRoot, {
    canStart: (e) => {
      const target = e.target as Element;
      if (!e.shiftKey || ui.query || target.closest('[data-okey], button, input, select, a, [data-inline]'))
        return false;
      const inView =
        ui.view === 'month'
          ? target.closest('[data-key]')
          : ui.view === 'week' || ui.view === 'day'
            ? target.closest('[data-col]')
            : null;
      return inView ? 'exclusive' : false;
    },
    isAdditive: additive,
    onStart: () => {
      holdRender();
      closePopovers();
    },
    onSelect: (keys) => {
      const hits = keys.map((k) => occRegistry.get(k)).filter((o): o is Occurrence => Boolean(o) && !o!.holiday);
      ui.selected = new Map([...base, ...hits.map((o) => [o.key, o] as const)]);
      const last = hits.at(-1) ?? [...ui.selected.values()].at(-1) ?? null;
      ui.selectedKey = last?.key ?? null;
      ui.selectedOcc = last;
      refreshSelection();
    },
    onEnd: () => releaseRender(),
  });
  // de selectie waarmee een kader begint: een aanvullend kader (⇧⌘) houdt de huidige, anders begint het leeg
  viewRoot.addEventListener(
    'pointerdown',
    (e) => {
      base = additive(e) ? new Map(ui.selected) : new Map();
    },
    true,
  );
}

hooks.openOcc = (occ) => {
  if (!occ.holiday) openEventDialog({ occ });
};

hooks.newEvent = (opts = {}) => {
  closeQuick();
  openEventDialog(opts);
};

hooks.openSearchResult = (result) => {
  hooks.setView('day', result.date);
  const ev = result.ev;
  if (!ev) return;
  const occ = occurrencesBetween(data, result.date, result.date).find((o) => o.id === ev.id);
  if (occ && !occ.holiday) openEventDialog({ occ });
};

hooks.moveOcc = async (occ, move) => {
  if (occ.holiday || isReadOnly(occ.calendarId)) return;

  // is de versleepte afspraak onderdeel van een selectie, dan verhuist de hele selectie mee (vergroten blijft bij één)
  const group =
    !move.toTimed && ui.selected.has(occ.key) ? selectedEvents().filter((o) => !isReadOnly(o.calendarId)) : [];
  if (group.length > 1) {
    if (move.copy) {
      store.addEvents(
        group.map((o) => ({ ...store.moveValues(o, move), repeat: null })),
        `${group.length} kopieën gemaakt`,
      );
      return;
    }
    let groupScope: Scope | null = 'all';
    if (group.some((o) => o.recurring)) {
      groupScope = await askScope('move');
      if (!groupScope) return render();
    }
    store.editOccurrences(
      group.map((o) => ({ occ: o, values: store.moveValues(o, move) })),
      groupScope,
      `${group.length} afspraken verplaatst`,
    );
    return;
  }

  if (move.copy) {
    // een kopie is altijd een losse afspraak, dus er hoeft geen bereik gekozen te worden
    store.addEvent({ ...store.moveValues(occ, move), repeat: null }, 'Kopie gemaakt');
    return;
  }
  let scope: Scope | null = 'all';
  if (occ.recurring) {
    scope = await askScope('move');
    if (!scope) {
      render();
      return;
    }
  }
  store.editOccurrence(occ, scope, store.moveValues(occ, move), 'Afspraak verplaatst');
};

hooks.toggleCalendar = (calendar) => store.setCalendarVisible(calendar.id, !calendar.visible);
hooks.editCalendar = (calendar) => openCalendarDialog(calendar);

hooks.occMenu = async (occ) => {
  if (occ.holiday) return;
  // afspraken uit een externe agenda zijn alleen-lezen: bekijken, kopiëren en dupliceren (naar een eigen agenda) kan wel
  const choice = await window.agenda.popupMenu(
    isReadOnly(occ.calendarId)
      ? [
          { id: 'edit', label: 'Bekijk…' },
          { id: 'duplicate', label: 'Dupliceer' },
          { separator: true },
          { id: 'copy', label: 'Kopieer' },
        ]
      : [
          { id: 'edit', label: 'Bewerk…' },
          ...(occ.ev?.task
            ? [{ id: 'toggle-task', label: isDone(occ.ev, occ.baseDate) ? 'Markeer als open' : 'Markeer als gedaan' }]
            : []),
          { id: 'duplicate', label: 'Dupliceer' },
          { separator: true },
          { id: 'cut', label: 'Knip' },
          { id: 'copy', label: 'Kopieer' },
          { separator: true },
          { id: 'delete', label: 'Verwijder' },
        ],
  );
  if (choice === 'edit') openEventDialog({ occ });
  else if (choice) editAction(choice);
};

// rechtermuisknop op een lege plek in een dag: nieuwe afspraak of de gekopieerde afspraak plakken
hooks.dayMenu = async (key, time) => {
  if (key !== ui.selectedDate) hooks.selectDate(key);
  const choice = await window.agenda.popupMenu([
    { id: 'new', label: 'Nieuwe afspraak' },
    { separator: true },
    { id: 'paste', label: 'Plak', enabled: ui.clipboard.length > 0 },
  ]);
  if (choice === 'new') {
    hooks.newEvent(
      time
        ? { date: key, time, endTime: fromMinutes(Math.min(toMinutes(time) + 60, 24 * 60 - 1)) }
        : { date: key, allDay: true },
    );
  } else if (choice === 'paste' && ui.clipboard.length) {
    store.pasteEvents(ui.clipboard, key, time);
  }
};

// acties van het kaartje bij een afspraak
hooks.occCommand = async (occ, command, arg) => {
  closePopovers();
  if (occ.holiday) return;
  hooks.selectOcc(occ);
  if (command === 'edit') openEventDialog({ occ });
  else if (command === 'duplicate') store.pasteEvent(clipOf(occ), occ.baseDate);
  else if (command === 'copy') {
    ui.clipboard = [clipOf(occ)];
    toast('Afspraak gekopieerd.');
  } else if (command === 'delete') await deleteSelected();
  else if (command === 'calendar' && arg) hooks.changeCalendar(occ, arg);
};

hooks.resizeOcc = async (occ, edge, key) => {
  if (occ.holiday || isReadOnly(occ.calendarId)) return;
  const values = store.moveValues(occ);
  // de nieuwe dag geldt voor wat je ziet (lokaal); de afspraak rekent in de tijdzone van zichzelf, dus verschuif de basiswaarden evenveel
  if (edge === 'end') values.endDate = addDays(occ.base.endDate, diffDays(occ.endDate, key));
  else values.date = addDays(occ.base.date, diffDays(occ.date, key));
  if (values.endDate < values.date) return;
  let scope: Scope | null = 'all';
  if (occ.recurring) {
    scope = await askScope('edit');
    if (!scope) return render();
  }
  store.editOccurrence(occ, scope, values, 'Afspraak aangepast');
};

hooks.changeCalendar = (occ, calendarId) => {
  const target = data.calendars.find((c) => c.id === calendarId);
  if (occ.holiday || !target || target.source || target.type === 'holidays') return;
  const group = ui.selected.has(occ.key) ? selectedEvents() : [occ];
  const movable = group.filter((o) => !isReadOnly(o.calendarId) && o.calendarId !== calendarId);
  if (!movable.length) return;
  // de agenda hoort bij de hele reeks, dus bij een herhalende afspraak geldt dit voor alle voorkomens
  store.editOccurrences(
    movable.map((o) => ({ occ: o, values: { ...store.moveValues(o), calendarId } })),
    'all',
    movable.length > 1
      ? `${movable.length} afspraken verplaatst naar ${target.name}`
      : `Verplaatst naar ${target.name}`,
  );
};

hooks.calendarMenu = async (calendar) => {
  const items: MenuItemSpec[] = [
    { id: 'edit', label: 'Bewerk…' },
    { id: 'export', label: 'Exporteer…' },
  ];
  if (calendar.source) items.splice(1, 0, { id: 'refresh', label: 'Vernieuw' });
  if (calendar.type === 'user') items.push({ separator: true }, { id: 'delete', label: 'Verwijder…' });
  const choice = await window.agenda.popupMenu(items);
  if (choice === 'edit') openCalendarDialog(calendar);
  else if (choice === 'export') exportCalendar(calendar);
  else if (choice === 'refresh') void refreshCalendar(calendar);
  else if (choice === 'delete') openCalendarDialog(calendar);
};

// --- bewerken: kopiëren, plakken, verwijderen, dupliceren ---

const isTextFocused = () => {
  const node = document.activeElement;
  return Boolean(node && (node.matches('input, textarea, select') || (node as HTMLElement).isContentEditable));
};
// het zijpaneel van de assistent blokkeert niets: alleen echte (modale) dialogen tellen
const modalOpen = () => Boolean(document.querySelector('dialog[open]:not([data-panel])'));

const clipOf = (occ: EventOcc) => store.eventToClip({ ...occ.ev, date: occ.base.date, endDate: occ.base.endDate });

async function deleteSelected() {
  const group = selectedEvents();
  if (!group.length) return false;
  const deletable = group.filter((o) => !isReadOnly(o.calendarId));
  if (!deletable.length) {
    toast('Deze afspraak komt uit een externe agenda en kan hier niet worden verwijderd.');
    return true;
  }
  let scope: Scope | null = 'all';
  if (deletable.some((o) => o.recurring)) {
    scope = await askScope('delete');
    if (!scope) return true;
  }
  clearSelection();
  store.deleteOccurrences(deletable, scope);
  if (deletable.length < group.length) toast('Afspraken uit externe agenda’s zijn niet verwijderd.');
  return true;
}

// alles wat in de huidige weergave staat selecteren (⌘A)
function selectAllVisible() {
  const all = [...occRegistry.values()].filter((o) => !o.holiday);
  ui.selected = new Map(all.map((o) => [o.key, o]));
  const last = all.at(-1) ?? null;
  ui.selectedKey = last?.key ?? null;
  ui.selectedOcc = last;
  refreshSelection();
}

function editAction(name: string) {
  if (name === 'undo') return store.undo();
  if (name === 'redo') return store.redo();
  if (name === 'select-all') return void selectAllVisible();
  const group = selectedEvents();
  if (name === 'copy' && group.length) {
    ui.clipboard = group.map(clipOf);
    if (group.length > 1) toast(`${group.length} afspraken gekopieerd.`);
  } else if (name === 'cut' && group.length) {
    if (group.every((o) => isReadOnly(o.calendarId))) {
      return void toast('Knippen kan niet bij een externe agenda; kopiëren wel.');
    }
    ui.clipboard = group.map(clipOf);
    void deleteSelected();
  } else if (name === 'paste' && ui.clipboard.length) store.pasteEvents(ui.clipboard, ui.selectedDate);
  else if (name === 'duplicate' && group.length) {
    // elk blijft op zijn eigen dag staan; een kopie heeft nooit een uitzondering
    store.addEvents(
      group.map((occ) => store.pasted(clipOf(occ), occ.baseDate)),
      group.length > 1 ? `${group.length} afspraken gedupliceerd` : 'Afspraak geplakt',
    );
  } else if (name === 'toggle-task') {
    for (const occ of group) store.toggleTaskDone(occ);
  } else if (name === 'delete') void deleteSelected();
  return undefined;
}

// handmatig verversen met een melding over het resultaat
async function refreshCalendar(calendar: Calendar) {
  toast(
    (await syncCalendar(calendar)) ? `${calendar.name} is bijgewerkt.` : `Vernieuwen van ${calendar.name} mislukt.`,
  );
}

async function refreshAll() {
  if (isSyncing()) return; // er loopt al een ronde; de knop draait zolang
  if (!data.calendars.some((c) => c.source)) return toast('Er zijn geen externe agenda’s om te vernieuwen.');
  const failed = await syncAll();
  return toast(failed.length ? `Vernieuwen mislukt voor: ${failed.join(', ')}.` : 'Externe agenda’s zijn bijgewerkt.');
}

// Naar vandaag; in dag- en weekweergave scrolt het uurraster ook zacht naar het huidige tijdstip.
function goToday() {
  const jumped =
    ui.selectedDate.slice(0, ui.view === 'year' ? 4 : 7) !== todayKey().slice(0, ui.view === 'year' ? 4 : 7);
  hooks.selectDate(todayKey());
  if (jumped) animateView(0, 1); // terug naar nu: de weergave zoomt zacht in
  if (timeGridShown()) requestAnimationFrame(() => scrollToNow(viewRoot));
}

// --- trackpad: vegen = vorige/volgende, knijpen = uren groter/kleiner ---

const timeGridShown = () => (ui.view === 'day' || ui.view === 'week') && !ui.query;

function zoomHours(factor: number | null, clientY: number | null = null) {
  if (timeGridShown()) zoomTimeGrid(viewRoot, factor, clientY, render);
}

const swipe = createSwipeDetector((direction) => {
  if (!ui.query) navigate(direction);
});
const pinch = createZoomAccumulator((factor, clientY) => zoomHours(factor, clientY));

viewRoot.addEventListener(
  'wheel',
  (e) => {
    if (document.querySelector('dialog[open]:not([data-panel])') || ui.holds) return;
    if (e.ctrlKey) {
      // knijpen (of ctrl+scrollen): alleen in het uurraster; elders de pagina niet laten zoomen
      e.preventDefault();
      if (timeGridShown()) pinch.add(e.deltaY, e.clientY);
      return;
    }
    swipe.handle(e.deltaX, e.deltaY);
  },
  { passive: false },
);

// opdrachten voor het commandopalet (⌘K); als functie, zodat labels als "Weeknummers tonen/verbergen" actueel zijn
setCommands(() => [
  { id: 'today', label: 'Ga naar vandaag', keywords: 'vandaag nu', run: () => goToday() },
  { id: 'new', label: 'Nieuwe afspraak', keywords: 'maak toevoegen', run: () => hooks.newEvent() },
  { id: 'quick', label: 'Snel een afspraak invoeren…', keywords: 'typ gewone taal', run: openQuick },
  {
    id: 'new-task',
    label: 'Nieuwe taak',
    keywords: 'todo to-do vinkje',
    run: () => hooks.newEvent({ allDay: true, prefill: { task: true } }),
  },
  ...(['day', 'week', 'month', 'year', 'list'] as const).map((view) => ({
    id: `view-${view}`,
    label: `Weergave: ${{ day: 'dag', week: 'week', month: 'maand', year: 'jaar', list: 'lijst' }[view]}`,
    keywords: 'toon weergave',
    run: () => hooks.setView(view),
  })),
  { id: 'search', label: 'Zoeken in afspraken', keywords: 'zoek vind', run: actions.search },
  { id: 'new-calendar', label: 'Nieuwe agenda…', run: () => openCalendarDialog() },
  {
    id: 'add-source',
    label: 'Google-, Outlook- of iCloud-agenda toevoegen…',
    keywords: 'externe link account',
    run: () => openSourceDialog(),
  },
  { id: 'sync', label: 'Externe agenda’s vernieuwen', keywords: 'ververs synchroniseer', run: () => void refreshAll() },
  { id: 'import', label: 'Importeren (.ics)…', keywords: 'open bestand', run: () => void importFiles() },
  { id: 'export', label: 'Alles exporteren (.ics)…', keywords: 'bewaar bestand', run: () => void exportCalendar(null) },
  { id: 'settings', label: 'Voorkeuren…', keywords: 'instellingen', run: openSettings },
  {
    id: 'weeknumbers',
    label: data.settings.weekNumbers ? 'Weeknummers verbergen' : 'Weeknummers tonen',
    run: () => store.updateSettings({ weekNumbers: !data.settings.weekNumbers }),
  },
  ...(timeGridShown()
    ? [
        { id: 'zoom-in', label: 'Uren groter', keywords: 'zoom', run: () => zoomHours(1.25) },
        { id: 'zoom-out', label: 'Uren kleiner', keywords: 'zoom', run: () => zoomHours(0.8) },
        { id: 'zoom-reset', label: 'Standaard uurhoogte', keywords: 'zoom', run: () => zoomHours(null) },
      ]
    : []),
  ...data.settings.templates.map((template) => ({
    id: `template-${template.id}`,
    label: `Sjabloon: ${template.name}`,
    keywords: 'nieuw afspraak maak sjabloon',
    run: () => hooks.newEvent(optionsFromTemplate(template, ui.selectedDate)),
  })),
  { id: 'chat', label: 'Vraag het aan Claude…', keywords: 'assistent chat ai', run: openChat },
  { id: 'stats', label: 'Statistieken…', keywords: 'uren overzicht drukte', run: openStats },
  { id: 'undo', label: 'Ongedaan maken', run: () => void store.undo() },
  { id: 'redo', label: 'Opnieuw', run: () => void store.redo() },
]);

const NATIVE: Record<string, NativeEditCommand> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
};

// --- importeren en exporteren ---

// Eén melding tegelijk: een nieuwe vervangt de vorige. Met `action` komt er een knop in (bijv. "Ongedaan maken").
let currentToast: HTMLElement | null = null;

function dismissToast(node: HTMLElement) {
  if (currentToast === node) currentToast = null;
  node.removeAttribute('role'); // een wegvagende melding hoeft niet meer voorgelezen of gevonden te worden
  const fade = reduceMotion()
    ? undefined
    : node.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
  if (fade) fade.onfinish = () => node.remove();
  else node.remove();
}

function showToast(message: string, action?: { label: string; run: () => void }) {
  if (currentToast) dismissToast(currentToast);
  const node = el(
    'div',
    'fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-4 py-2 text-sm text-canvas shadow-lg',
  );
  node.setAttribute('role', 'status');
  node.classList.add('overflow-hidden');
  node.append(el('span', '', message));
  if (action) {
    const button = el('button', 'font-semibold underline underline-offset-2 hover:opacity-80', action.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      dismissToast(node);
      action.run();
    });
    node.append(button);
  }
  const lifetime = action ? 6000 : 3300;
  // bij "Ongedaan maken" laat een dunne balk zien hoeveel tijd je nog hebt
  const bar = action ? el('div', 'absolute inset-x-0 bottom-0 h-0.5 origin-left bg-canvas/50') : null;
  if (bar) node.append(bar);
  currentToast = node;
  document.body.append(node);
  if (!reduceMotion()) {
    // het horizontaal centreren zit in de losse `translate`-eigenschap van Tailwind; `transform` komt er los bovenop
    node.animate?.(
      [
        { opacity: 0, transform: 'translateY(14px) scale(0.96)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DURATION.slow, easing: EASE.spring },
    );
    bar?.animate?.([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: lifetime,
      easing: 'linear',
      fill: 'forwards',
    });
  }
  setTimeout(() => dismissToast(node), lifetime);
}

const toast = (message: string) => showToast(message);

// bestanden en agenda-links op het venster laten vallen
initDropzone(toast);

hooks.undoToast = (message) => showToast(message, { label: 'Ongedaan maken', run: () => void store.undo() });

async function exportCalendar(calendar: Calendar | null) {
  const events = calendar ? data.events.filter((e) => e.calendarId === calendar.id) : data.events;
  const name = calendar?.name ?? 'Agenda';
  if (!events.length) return toast(`${name} bevat geen afspraken om te exporteren.`);
  if (await window.agenda.exportICS(toICS(name, events), name)) toast(`${events.length} afspraken geëxporteerd.`);
  return undefined;
}

async function importFiles() {
  const files = await window.agenda.importICS();
  const total = importIcsTexts(files);
  if (files.length) toast(total ? `${total} afspraken geïmporteerd.` : 'Geen afspraken gevonden in het bestand.');
}

// --- menu en sneltoetsen ---

const actions: Record<string, () => unknown> = {
  new: () => (quickOpen() ? closeQuick() : openQuick()),
  'new-calendar': () => openCalendarDialog(),
  'add-source': () => openSourceDialog(),
  sync: refreshAll,
  import: importFiles,
  export: () => exportCalendar(null),
  search: () => {
    searchInput.focus();
    searchInput.select();
  },
  today: () => goToday(),
  prev: () => navigate(-1),
  next: () => navigate(1),
  settings: openSettings,
  'check-updates': () => {
    openSettings();
    checkNow();
  },
  palette: openPalette,
  'zoom-in': () => zoomHours(1.25),
  'zoom-out': () => zoomHours(0.8),
  'zoom-reset': () => zoomHours(null),
  'toggle-weeknumbers': () => store.updateSettings({ weekNumbers: !data.settings.weekNumbers }),
};

window.agenda.onMenu((name) => {
  if (name.startsWith('view:')) return hooks.setView(name.slice(5) as View);
  if (name in NATIVE || name === 'duplicate') {
    if (isTextFocused() && name in NATIVE) return window.agenda.nativeEdit(NATIVE[name]);
    if (modalOpen()) return undefined;
    return editAction(name);
  }
  if (name in actions && !(modalOpen() && ['new', 'prev', 'next', 'today', 'palette'].includes(name)))
    return actions[name]();
  return undefined;
});

window.agenda.onNotificationOpen(({ id, date }) => openReminder({ id, date, title: '', body: '' }));
// "Over 10 min" in de melding van het systeem (macOS)
window.agenda.onNotificationSnooze((reminder, minutes) => snooze(reminder, minutes));

// --- pijltjestoetsen, Enter en spatie ---

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const DAY_STEP: Record<Direction, number> = { left: -1, right: 1, up: -7, down: 7 };

const nodeOf = (key: string | null) =>
  key ? ([...viewRoot.querySelectorAll<HTMLElement>('[data-okey]')].find((n) => n.dataset.okey === key) ?? null) : null;

// Naar de dichtstbijzijnde afspraak in die richting; is er geen, dan gaat de gekozen dag een dag (links/rechts) of een week op.
function moveSelection(direction: Direction) {
  const current = nodeOf(ui.selectedKey);
  if (current) {
    const seen = new Set<string>();
    const candidates = [...viewRoot.querySelectorAll<HTMLElement>('[data-okey]')].flatMap((node) => {
      const key = node.dataset.okey!;
      if (key === ui.selectedKey || seen.has(key)) return [];
      seen.add(key);
      return [{ key, box: node.getBoundingClientRect(), node }];
    });
    const target = nearestInDirection(current.getBoundingClientRect(), candidates, direction);
    const next = candidates.find((c) => c.key === target);
    const occ = target ? occRegistry.get(target) : undefined;
    if (next && occ) {
      hooks.selectOcc(occ);
      next.node.focus({ preventScroll: true });
      next.node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
  }
  hooks.selectDate(addDays(ui.selectedDate, DAY_STEP[direction]));
}

// de toetsen gelden alleen als er geen veld, dialoog of knop de aandacht heeft (een afspraak mag wel)
function keyboardIdle() {
  const active = document.activeElement;
  const free = !active || active === document.body || active.matches('[data-okey]');
  return free && !isTextFocused() && !modalOpen() && !quickOpen() && !ui.holds;
}

document.addEventListener('keydown', (e) => {
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && keyboardIdle()) {
    const direction = ARROWS[e.key];
    if (direction) {
      e.preventDefault();
      moveSelection(direction);
      return;
    }
    const occ = ui.selectedOcc;
    if (e.key === 'Enter' && occ && !occ.holiday) {
      e.preventDefault();
      hooks.openOcc(occ);
      return;
    }
    if (e.key === ' ' && occ && !occ.holiday) {
      const node = nodeOf(occ.key);
      if (node) {
        e.preventDefault();
        pin(node, occ, { focus: true });
        return;
      }
    }
  }
  if (e.key === 'Escape') {
    if (quickOpen()) closeQuick();
    else if (document.activeElement === searchInput || ui.query) {
      closeSearchPop();
      searchInput.value = '';
      searchInput.blur();
      if (ui.query) {
        ui.query = '';
        render();
      }
    } else if (ui.selectedKey || ui.selected.size) {
      clearSelection();
      refreshSelection();
    }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextFocused() && !modalOpen()) {
    e.preventDefault();
    deleteSelected();
  }
});

// --- werkbalk en zijbalk ---

viewSwitch.addEventListener('click', (e) => {
  const view = (e.target as Element).closest<HTMLElement>('[data-view]')?.dataset.view as View | undefined;
  if (view && (view !== ui.view || ui.query)) hooks.setView(view);
});
$('prev').addEventListener('click', () => navigate(-1));
$('next').addEventListener('click', () => navigate(1));
$('today').addEventListener('click', () => goToday());
$('add').addEventListener('click', actions.new);
$('cal-add').addEventListener('click', async () => {
  const choice = await window.agenda.popupMenu([
    { id: 'new', label: 'Nieuwe agenda…' },
    { id: 'source', label: 'Google, Outlook, iCloud of link toevoegen…' },
  ]);
  if (choice === 'new') openCalendarDialog();
  else if (choice === 'source') openSourceDialog();
});
$('mini-prev').addEventListener('click', () => {
  ui.miniKey = addMonths(ui.miniKey, -1);
  renderSidebar();
});
$('mini-next').addEventListener('click', () => {
  ui.miniKey = addMonths(ui.miniKey, 1);
  renderSidebar();
});
// Typen toont een uitklaplijst met de beste resultaten; Enter (of "Alle resultaten") toont ze als lijst in de weergave.
// Staat die lijst al open, dan volgt hij de invoer meteen.
function showAllResults() {
  ui.query = searchInput.value.trim();
  closeSearchPop();
  render();
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (!query) {
    closeSearchPop();
    if (ui.query) {
      ui.query = '';
      render();
    }
  } else if (ui.query) {
    ui.query = query;
    render();
  } else updateSearchPop(searchInput, query, showAllResults);
});
searchInput.addEventListener('keydown', (e) => {
  if (searchPopKey(e, searchInput.value.trim())) e.stopPropagation();
});
searchInput.addEventListener('blur', closeSearchPop);

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (ui.view === 'month' && !ui.query) render();
  }, 120);
});

// --- meldingen, dock-icoon en de klok ---

function openReminder({ id, date }: Reminder) {
  hooks.setView('day', date);
  const occ = occurrencesBetween(data, date, date).find((o) => o.id === id);
  if (occ) hooks.selectOcc(occ);
}

// Zit je in de app, dan verschijnt er een kaart met uitstellen; anders een melding van het systeem.
function deliver(reminder: Reminder) {
  if (document.hasFocus()) showReminderCard(reminder, openReminder);
  else window.agenda.notify(reminder);
}

let lastCheck = Date.now();
function checkAlerts() {
  const now = Date.now();
  // na slaap niet alle gemiste meldingen in één keer afspelen
  const from = Math.max(lastCheck, now - 10 * 60000);
  for (const occ of dueAlerts(data, from, now)) {
    deliver({
      title: occ.title || 'Afspraak',
      body: [timesLabel(occ), occ.location].filter(Boolean).join(' · '),
      id: occ.id,
      date: occ.date,
    });
  }
  for (const occ of dueDepartures(data, from, now)) {
    deliver({
      title: `Tijd om te vertrekken: ${occ.title || 'Afspraak'}`,
      body: [`Reistijd ${occ.ev?.travel} min`, `begint om ${occ.time}`, occ.location].filter(Boolean).join(' · '),
      id: occ.id,
      date: occ.date,
    });
  }
  for (const reminder of takeDueSnoozes(now)) deliver(reminder);
  lastCheck = now;
}

function updateDockIcon() {
  if (window.agenda.platform !== 'darwin') return;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const now = new Date();
  const pad = 40;
  const inner = size - pad * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(pad, pad, inner, inner, 96);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, pad, inner, inner, 96);
  ctx.clip();
  ctx.fillStyle = '#ff3b30';
  ctx.fillRect(pad, pad, inner, 130);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 76px -apple-system, "SF Pro Display", sans-serif';
  const weekday = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(now).slice(0, 3).toUpperCase();
  ctx.fillText(weekday, size / 2, pad + 94);
  ctx.fillStyle = '#1d1d1f';
  ctx.font = '300 250px -apple-system, "SF Pro Display", sans-serif';
  ctx.fillText(String(now.getDate()), size / 2, pad + 380);
  window.agenda.setDockIcon(canvas.toDataURL('image/png'));
}

let currentDay = todayKey();
setInterval(() => {
  if (todayKey() !== currentDay) {
    currentDay = todayKey();
    updateDockIcon();
    render();
  } else {
    updateNowLine();
  }
  pushTray(); // "over 12 min" loopt mee met de klok
  void loadWeather(); // doet alleen iets als de voorspelling verouderd is
}, 30000);
setInterval(checkAlerts, 15000);

initDialogOrigin();

(async () => {
  if (window.agenda.platform === 'darwin') document.documentElement.classList.add('vibrancy');
  await store.load();
  render();
  updateDockIcon();
  void initUpdates(toast);
  void initClaude(toast);
  initBackups();
  initChat();
  initSystem();
  void startSystem();
  initWeather();
  void loadWeather();
  initMcp(); // pas nu: de agenda is geladen en getekend, Claude kan erbij
  // externe agenda's: meteen verversen en daarna zo vaak als in de voorkeuren staat
  void syncAll();
  startAutoSync();
})();
