// gedeelde bouwstenen voor afspraken in de weergaven: blokjes, selectie en banen
import type { EventOcc, Occurrence } from '../shared/types.ts';
import { colorOfOcc, holdRender, hooks, isReadOnly, occRegistry, releaseRender, ui } from './state.ts';
import { dayLabel, hideDragLabel, showDragLabel } from './dragkit.ts';
import { cancelPreview, closePopovers, pinSoon, schedulePreview } from './popover.ts';
import { fmtTime } from './format.ts';
import { isDone } from './model.ts';
import * as store from './store.ts';
import { diffDays, el } from './util.ts';

const SELECTED = ['ring-2', 'ring-accent'];

// Elke afspraak krijgt een eigen naam (data-flip), zodat hij bij een update van zijn oude naar zijn nieuwe plek kan glijden
// (zie flip.ts). Een meerdaagse balk staat in elke weekrij opnieuw: die krijgen een volgnummer.
const usedNames = new Map<string, number>();
export const resetTransitionNames = () => {
  usedNames.clear();
  occRegistry.clear();
};

function transitionName(key: string) {
  const base = `o-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const n = usedNames.get(base) ?? 0;
  usedNames.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

// de eigen agenda in de zijbalk onder de cursor (alleen agenda's waar je afspraken in mag zetten)
export function calendarAt(clientX: number, clientY: number): string | null {
  const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-calid]');
  return row?.dataset.calid ?? null;
}

// markeert de agenda in de zijbalk waar een versleepte afspraak op zou landen (null haalt de markering weg)
export function highlightCalendar(id: string | null) {
  for (const row of document.querySelectorAll<HTMLElement>('[data-calid]')) {
    const on = row.dataset.calid === id;
    row.classList.toggle('ring-2', on);
    row.classList.toggle('ring-accent', on);
  }
}

export const isBar = (occ: Occurrence) => occ.allDay || occ.endDate > occ.date;

// klik selecteert, dubbelklik opent, rechtermuisknop toont het contextmenu
export function wireOcc(node: HTMLElement, occ: Occurrence) {
  node.dataset.okey = occ.key;
  // ook blokken die geen knop zijn moeten met de pijltjestoetsen focus kunnen krijgen; de selectiering is de aanduiding
  if (!(node instanceof HTMLButtonElement)) node.tabIndex = -1;
  node.classList.add('focus-visible:outline-none');
  occRegistry.set(occ.key, occ);
  // dezelfde afspraak houdt zijn naam als hij van dag verandert; een voorkomen van een herhaling heeft zijn datum nodig
  node.dataset.flip = transitionName(occ.recurring ? occ.key : (occ.id ?? occ.key));
  if (isSelected(occ.key)) node.classList.add(...SELECTED);
  if (occ.ev?.task) decorateTask(node, occ as EventOcc);
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    // ⇧ of ⌘ (op Windows/Linux ook Ctrl; op macOS is Ctrl-klik een rechtermuisklik): afspraken bij de selectie
    // optellen of eraf halen, zonder kaartje
    if (e.shiftKey || e.metaKey || (e.ctrlKey && window.agenda.platform !== 'darwin')) {
      closePopovers();
      hooks.toggleOcc(occ);
      return;
    }
    // één klik selecteert alleen (zodat je er met ⇧/⌘ makkelijk meer bij kunt klikken); nog een klik op de al
    // geselecteerde afspraak opent het kaartje met acties
    const alreadySelected = ui.selected.size === 1 && ui.selectedKey === occ.key;
    hooks.selectOcc(occ);
    if (alreadySelected) pinSoon(node, occ);
    else closePopovers();
  });
  node.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    closePopovers();
    hooks.openOcc(occ);
  });
  node.addEventListener('mouseenter', () => schedulePreview(node, occ));
  node.addEventListener('mouseleave', cancelPreview);
  node.addEventListener('pointerdown', cancelPreview);
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closePopovers();
    hooks.selectOcc(occ);
    hooks.occMenu(occ);
  });
}

// Een taak krijgt een rondje vooraan (met een vinkje als hij klaar is) en een doorgestreepte titel. Het rondje is geen
// eigen knop (een knop in een knop mag niet): de klik wordt afgehandeld op het blokje zelf.
function decorateTask(node: HTMLElement, occ: EventOcc) {
  const done = isDone(occ.ev, occ.baseDate);
  const box = el(
    'span',
    'inline-flex size-3 shrink-0 items-center justify-center rounded-full border text-[8px] leading-none ' +
      (done ? 'border-transparent bg-accent text-white' : 'border-current'),
    done ? '✓' : '',
  );
  box.dataset.taskCheck = '1';
  box.setAttribute('aria-hidden', 'true');
  node.prepend(el('span', 'sr-only', done ? 'Taak, afgevinkt: ' : 'Taak, open: '), box);
  if (done) node.classList.add('line-through', 'opacity-60');
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    store.toggleTaskDone(occ);
  });
  // slepen vanaf het rondje moet de taak niet verplaatsen
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
}

const isSelected = (key: string) => ui.selected.has(key) || ui.selectedKey === key;

export function refreshSelection() {
  // na het opnieuw tekenen zijn de afspraak-objecten nieuw: de selectie wijst naar de actuele
  for (const key of [...ui.selected.keys()]) {
    const fresh = occRegistry.get(key);
    if (fresh) ui.selected.set(key, fresh);
    else ui.selected.delete(key);
  }
  const current = ui.selectedKey ? occRegistry.get(ui.selectedKey) : undefined;
  if (current) ui.selectedOcc = current;
  for (const node of document.querySelectorAll<HTMLElement>('[data-okey]')) {
    const selected = isSelected(node.dataset.okey!);
    node.classList.toggle('ring-2', selected);
    node.classList.toggle('ring-accent', selected);
  }
  const info = document.getElementById('sel-info');
  if (info) {
    info.hidden = ui.selected.size < 2;
    info.textContent = `${ui.selected.size} geselecteerd`;
  }
}

// --- dagen aanwijzen met de muis: de dagcel onder de cursor (maand en hele-dag-rij hebben data-key) ---

export function dayKeyAt(clientX: number, clientY: number): string | null {
  for (const cell of document.querySelectorAll<HTMLElement>('#view [data-key]')) {
    const r = cell.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom)
      return cell.dataset.key ?? null;
  }
  return null;
}

// markeert de dagen van `from` t/m `to` (alleen als het er meer dan één zijn)
const RANGE = ['ring-2', 'ring-inset', 'ring-accent/60'];
export function markRange(from: string, to: string) {
  const [a, b] = from <= to ? [from, to] : [to, from];
  for (const cell of document.querySelectorAll<HTMLElement>('#view [data-key]')) {
    const inRange = cell.dataset.key! >= a && cell.dataset.key! <= b;
    for (const name of RANGE) cell.classList.toggle(name, inRange && a !== b);
  }
}

// Over meerdere dagen slepen met de muis maakt een meerdaagse hele-dag-afspraak.
export function attachRangeCreate(cell: HTMLElement, startKey: string) {
  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    holdRender();
    let lastKey = startKey;
    const onMove = (ev: PointerEvent) => {
      const key = dayKeyAt(ev.clientX, ev.clientY);
      if (!key || key === lastKey) return;
      lastKey = key;
      markRange(startKey, lastKey);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      markRange(startKey, startKey);
      releaseRender();
      if (lastKey === startKey) return;
      const [date, endDate] = startKey <= lastKey ? [startKey, lastKey] : [lastKey, startKey];
      hooks.newEvent({ date, endDate, allDay: true });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// --- vergroten of verkleinen van een meerdaagse balk door aan de linker- of rechterrand te slepen ---

// terwijl een rand versleept wordt mag de balk zelf niet als geheel gaan slepen (HTML5-slepen)
let edgeDragging = false;

function attachEdgeResize(handle: HTMLElement, occ: Occurrence, side: 'start' | 'end') {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || occ.holiday) return;
    e.stopPropagation(); // geen selectie of kaartje: dit is een sleepgreep
    edgeDragging = true;
    holdRender();
    closePopovers();
    let target = side === 'end' ? occ.endDate : occ.date;

    const onMove = (ev: PointerEvent) => {
      const key = dayKeyAt(ev.clientX, ev.clientY);
      if (!key) return;
      // de balk blijft minstens één dag lang
      target = side === 'end' ? (key < occ.date ? occ.date : key) : key > occ.endDate ? occ.endDate : key;
      const [from, to] = side === 'end' ? [occ.date, target] : [target, occ.endDate];
      markRange(from, to);
      const days = diffDays(from, to) + 1;
      showDragLabel(
        ev.clientX,
        ev.clientY,
        days === 1 ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)} (${days} dagen)`,
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      edgeDragging = false;
      hideDragLabel();
      markRange(target, target);
      releaseRender();
      const changed = side === 'end' ? target !== occ.endDate : target !== occ.date;
      if (changed) void hooks.resizeOcc(occ, side, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// gekleurd blok voor hele-dag- en meerdaagse afspraken
export function barChip(
  occ: Occurrence,
  { startsHere = true, endsHere = true }: { startsHere?: boolean; endsHere?: boolean } = {},
) {
  const color = colorOfOcc(occ);
  const node = el(
    'button',
    `relative flex w-full min-w-0 items-center gap-1 px-1.5 py-px text-left text-xs/5 hover:brightness-95 ${color.chip} ` +
      (startsHere ? `rounded-l-[5px] border-l-[3px] ${color.bar} ` : '') +
      (endsHere ? 'rounded-r-[5px]' : ''),
  );
  node.type = 'button';
  node.append(el('span', 'truncate font-medium', occ.title));
  if (occ.recurring) node.append(el('span', 'shrink-0 text-muted', '↻'));
  if (!occ.holiday) wireOcc(node, occ);
  else node.disabled = false;
  // grepen aan de uiteinden om de balk langer of korter te maken (niet bij alleen-lezen agenda's)
  if (!occ.holiday && !isReadOnly(occ.calendarId)) {
    for (const [side, here] of [
      ['start', startsHere],
      ['end', endsHere],
    ] as const) {
      if (!here) continue;
      const handle = el('span', `absolute inset-y-0 w-1.5 cursor-ew-resize ${side === 'start' ? 'left-0' : 'right-0'}`);
      handle.dataset.edge = side;
      handle.setAttribute('aria-hidden', 'true');
      attachEdgeResize(handle, occ, side);
      node.append(handle);
    }
  }
  return node;
}

// regel met stip voor afspraken met een tijd (maandweergave, lijst)
export function dotRow(occ: Occurrence) {
  const color = colorOfOcc(occ);
  const node = el(
    'button',
    'flex w-full min-w-0 items-center gap-1.5 rounded-[5px] px-1 text-left text-xs/5 hover:bg-fill',
  );
  node.type = 'button';
  node.append(el('span', `size-1.5 shrink-0 rounded-full ${color.dot}`), el('span', 'truncate', occ.title));
  node.append(el('span', 'ml-auto shrink-0 text-muted', fmtTime(occ.time)));
  wireOcc(node, occ);
  return node;
}

// verdeelt blokken (met sc..ec kolommen) over banen zodat ze elkaar niet overlappen
// een afspraak op de kolommen sc..ec van een rij; lane wordt door assignLanes ingevuld
export interface LaneItem {
  occ: Occurrence;
  sc: number;
  ec: number;
  lane: number;
}

export function assignLanes(items: LaneItem[]) {
  const lanes: LaneItem[][] = [];
  for (const item of items) {
    let lane = lanes.findIndex((l) => l.every((o) => o.ec < item.sc || o.sc > item.ec));
    if (lane === -1) lane = lanes.push([]) - 1;
    lanes[lane].push(item);
    item.lane = lane;
  }
  return lanes.length;
}

// sorteervolgorde voor banen: balken eerst, langste eerst, dan op tijd
export const byLanePriority = (a: LaneItem, b: LaneItem) =>
  a.sc - b.sc ||
  Number(isBar(b.occ)) - Number(isBar(a.occ)) ||
  b.ec - b.sc - (a.ec - a.sc) ||
  a.occ.time.localeCompare(b.occ.time) ||
  a.occ.title.localeCompare(b.occ.title);

// HTML5-slepen van balken: onthoudt wat er versleept wordt en welke dag is vastgepakt
export const drag: { occ: Occurrence | null; grabKey: string } = { occ: null, grabKey: '' };

// Staat op elke versleepte afspraak, zodat het hele venster (de dropzone) eigen slepen van een bestand van buiten kan
// onderscheiden. `drag.occ` is daarvoor niet bruikbaar: de dropdoelen maken dat leeg voordat het document het event ziet.
export const INTERNAL_DRAG = 'application/x-agenda-occurrence';

// markeert de dag waar een versleepte afspraak op zou landen (null haalt de markering weg)
const DROP_RING = ['ring-2', 'ring-inset', 'ring-accent/60'];
export function highlightDrop(key: string | null) {
  for (const cell of document.querySelectorAll<HTMLElement>('#view [data-key]')) {
    cell.classList.toggle('ring-2', cell.dataset.key === key);
    for (const name of DROP_RING.slice(1)) cell.classList.toggle(name, cell.dataset.key === key);
  }
}

// Alt/Option bij het loslaten kopieert in plaats van te verplaatsen: de cursor laat dat zien
export const dropEffect = (e: DragEvent) => (e.altKey ? 'copy' : 'move');

export function makeDraggable(node: HTMLElement, occ: Occurrence, dayAt: (e: MouseEvent) => string) {
  if (occ.holiday || isReadOnly(occ.calendarId)) return;
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    if (edgeDragging) return e.preventDefault();
    drag.occ = occ;
    holdRender();
    closePopovers();
    drag.grabKey = dayAt(e);
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData('text/plain', occ.key);
    e.dataTransfer!.setData(INTERNAL_DRAG, occ.key);
    // pas na het maken van het sleepbeeld dimmen, anders is ook het beeld gedimd
    requestAnimationFrame(() => node.classList.add('opacity-40'));
  });
  node.addEventListener('dragend', () => {
    drag.occ = null;
    node.classList.remove('opacity-40');
    highlightDrop(null);
    hideDragLabel();
    highlightCalendar(null);
    releaseRender();
  });
}
