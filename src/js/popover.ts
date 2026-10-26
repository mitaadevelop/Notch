// kaartje bij een afspraak: een voorbeeld bij hover (na een korte pauze) en een vastgezet kaartje met snelle acties bij klikken
import type { Occurrence } from '../shared/types.ts';
import { timesLabel } from './format.ts';
import { occurrencesBetween } from './occurrences.ts';
import { calendarOf, colorOfOcc, data, hooks, isReadOnly, ui, writableCalendars } from './state.ts';
import { dayHeading, el, fromKey } from './util.ts';

export type OccCommand = 'edit' | 'duplicate' | 'copy' | 'delete' | 'calendar';

const HOVER_DELAY_MS = 500;
const WIDTH = 288;

let card: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let pinned = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export const popoverOpen = () => card !== null && pinned;

export function closePopovers() {
  clearTimeout(timer);
  card?.remove();
  anchor?.removeAttribute('aria-describedby');
  card = null;
  anchor = null;
  pinned = false;
}

// zet het kaartje naast de afspraak: liefst rechts ervan, anders links, anders eronder; altijd binnen het venster
function place(node: HTMLElement, pop: HTMLElement) {
  const rect = node.getBoundingClientRect();
  const height = pop.offsetHeight;
  let left = rect.right + 8;
  if (left + WIDTH > innerWidth - 8) left = rect.left - WIDTH - 8;
  if (left < 8) left = Math.min(Math.max(rect.left, 8), innerWidth - WIDTH - 8);
  const top = Math.min(Math.max(rect.top, 8), Math.max(8, innerHeight - height - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function build(occ: Occurrence, withActions: boolean) {
  const color = colorOfOcc(occ);
  const pop = el(
    'div',
    'fixed z-40 flex w-72 flex-col gap-1.5 rounded-xl border border-line bg-canvas p-3 text-sm shadow-2xl ' +
      (withActions ? '' : 'pointer-events-none'),
  );
  pop.id = 'event-pop';
  pop.setAttribute('role', withActions ? 'dialog' : 'tooltip');
  if (withActions) pop.setAttribute('aria-label', `Details van ${occ.title || 'afspraak'}`);

  const head = el('div', 'flex items-start gap-2');
  head.append(
    el('span', `mt-1.5 size-2.5 shrink-0 rounded-full ${color.dot}`),
    el('span', 'min-w-0 font-semibold break-words', occ.title || '(zonder titel)'),
  );
  pop.append(head);
  pop.append(el('div', 'text-muted', timesLabel(occ) + (occ.recurring ? ' · herhalend ↻' : '')));
  if (occ.location) pop.append(el('div', 'text-muted', `📍 ${occ.location}`));
  const notes = occ.ev?.notes.trim();
  if (notes) pop.append(el('div', 'line-clamp-3 text-xs text-muted', notes));
  const calendar = calendarOf(occ.calendarId);
  if (calendar) pop.append(el('div', 'text-xs text-muted', calendar.name + (calendar.source ? ' · alleen-lezen' : '')));
  if (withActions) pop.append(actions(occ));
  return pop;
}

function actions(occ: Occurrence) {
  const readOnly = isReadOnly(occ.calendarId);
  const box = el('div', 'mt-1 flex flex-col gap-2 border-t border-line pt-2');
  const row = el('div', 'flex flex-wrap gap-1');
  const add = (label: string, command: OccCommand, danger = false) => {
    const button = el(
      'button',
      'rounded-md bg-fill px-2 py-1 text-xs hover:brightness-95 ' + (danger ? 'text-today' : ''),
      label,
    );
    button.type = 'button';
    button.dataset.command = command;
    button.addEventListener('click', () => void hooks.occCommand(occ, command));
    row.append(button);
  };
  add(readOnly ? 'Bekijk' : 'Bewerk', 'edit');
  add('Dupliceer', 'duplicate');
  add('Kopieer', 'copy');
  if (!readOnly) add('Verwijder', 'delete', true);
  box.append(row);

  if (!readOnly) {
    // een afspraak naar een andere agenda verplaatsen zonder dialoog
    const label = el('label', 'flex items-center gap-2 text-xs');
    label.append(el('span', 'text-muted', 'Agenda'));
    const select = el('select', 'min-w-0 flex-1 rounded-md bg-fill px-1.5 py-1 outline-none');
    for (const calendar of writableCalendars()) select.add(new Option(calendar.name, calendar.id));
    select.value = occ.calendarId;
    select.addEventListener('change', () => void hooks.occCommand(occ, 'calendar', select.value));
    label.append(select);
    box.append(label);
  }
  return box;
}

function show(node: HTMLElement, occ: Occurrence, withActions: boolean) {
  closePopovers();
  card = build(occ, withActions);
  anchor = node;
  pinned = withActions;
  document.body.append(card);
  place(node, card);
  node.setAttribute('aria-describedby', card.id);
}

// Hover: na een korte pauze een voorbeeld; niet tijdens slepen of typen en niet naast een vastgezet kaartje.
export function schedulePreview(node: HTMLElement, occ: Occurrence) {
  clearTimeout(timer);
  if (pinned) return;
  timer = setTimeout(() => {
    if (pinned || ui.holds || document.querySelector('dialog[open]:not([data-panel])')) return;
    show(node, occ, false);
  }, HOVER_DELAY_MS);
}

export function cancelPreview() {
  clearTimeout(timer);
  if (card && !pinned) closePopovers();
}

// Het kaartje blijft staan met snelle acties
export function pin(node: HTMLElement, occ: Occurrence, { focus = false } = {}) {
  show(node, occ, true);
  // met het toetsenbord geopend: meteen op de eerste knop, zodat Tab/Enter werken
  if (focus) card?.querySelector<HTMLElement>('button, select')?.focus();
}

// "3 meer…" in de maand: alle afspraken van die dag in een lijstje, zonder van weergave te wisselen
export function showDayList(node: HTMLElement, key: string) {
  closePopovers();
  const pop = el(
    'div',
    'fixed z-40 flex w-72 flex-col gap-1 rounded-xl border border-line bg-canvas p-3 text-sm shadow-2xl',
  );
  pop.id = 'event-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Afspraken op ${dayHeading.format(fromKey(key))}`);
  pop.append(el('div', 'mb-1 font-semibold first-letter:uppercase', dayHeading.format(fromKey(key))));

  const list = el('ul', 'flex max-h-72 flex-col overflow-y-auto');
  for (const occ of occurrencesBetween(data, key, key)) {
    const item = el('button', 'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-fill');
    item.type = 'button';
    item.append(
      el('span', `size-2 shrink-0 rounded-full ${colorOfOcc(occ).dot}`),
      el('span', 'min-w-0 flex-1 truncate', occ.title || '(zonder titel)'),
      el('span', 'shrink-0 text-xs text-muted', timesLabel(occ)),
    );
    if (!occ.holiday) {
      item.addEventListener('click', () => {
        closePopovers();
        hooks.selectOcc(occ);
        hooks.openOcc(occ);
      });
    } else item.disabled = true;
    const li = el('li');
    li.append(item);
    list.append(li);
  }
  pop.append(list);

  const goto = el(
    'button',
    'mt-1 self-start rounded-md px-1.5 py-1 text-xs text-accent hover:bg-fill',
    'Ga naar deze dag',
  );
  goto.type = 'button';
  goto.addEventListener('click', () => {
    closePopovers();
    hooks.setView('day', key);
  });
  pop.append(goto);

  card = pop;
  anchor = node;
  pinned = true;
  document.body.append(pop);
  place(node, pop);
}

const PIN_DELAY_MS = 250;

// Vastzetten na een korte pauze, zodat een dubbelklik (opent de dialoog) of een volgende klik het nog kan annuleren
export function pinSoon(node: HTMLElement, occ: Occurrence) {
  clearTimeout(timer);
  timer = setTimeout(() => pin(node, occ), PIN_DELAY_MS);
}

// buiten klikken, Escape, scrollen en het venster verkleinen sluiten een vastgezet kaartje
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!card) return;
    const target = e.target as Element;
    if (card.contains(target)) return;
    // opnieuw klikken op dezelfde afspraak laat pin() het kaartje zelf vernieuwen
    if (pinned && target.closest('[data-okey]')) return;
    closePopovers();
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && card && pinned) {
      e.stopPropagation();
      // stond de focus in het kaartje, dan terug naar de afspraak
      const back = card.contains(document.activeElement) && anchor?.isConnected ? anchor : null;
      closePopovers();
      back?.focus({ preventScroll: true });
    }
  },
  true,
);
addEventListener('resize', closePopovers);
document.addEventListener('scroll', () => card && closePopovers(), true);
