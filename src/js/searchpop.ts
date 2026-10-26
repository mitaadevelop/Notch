// uitklaplijst onder het zoekveld: de beste resultaten terwijl je typt, met de gevonden letters gemarkeerd
import type { SearchResult } from '../shared/types.ts';
import { dateLabel } from './format.ts';
import { searchEvents } from './search.ts';
import { COLORS } from './colors.ts';
import { data, hooks } from './state.ts';
import { el, todayKey } from './util.ts';

const MAX_RESULTS = 6;

// Splitst `text` in stukken, met per stuk of het (hoofdletterongevoelig) bij de zoekterm hoort.
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

let pop: HTMLElement | null = null;
let results: SearchResult[] = [];
let total = 0;
let active = -1; // -1: geen resultaat gekozen (Enter toont dan alle resultaten)
let input: HTMLInputElement | null = null;
let showAll: () => void = () => {};

export const searchPopOpen = () => pop !== null;

export function closeSearchPop() {
  pop?.remove();
  pop = null;
  active = -1;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
}

function marked(text: string, query: string) {
  const span = el('span', 'min-w-0 flex-1 truncate');
  for (const part of highlightParts(text, query)) {
    span.append(part.match ? el('mark', 'rounded-sm bg-accent/30 text-inherit', part.text) : part.text);
  }
  return span;
}

function paint(query: string) {
  if (!pop || !input) return;
  const rect = input.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(rect.right - 340, innerWidth - 348))}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  pop.replaceChildren();

  results.forEach((result, i) => {
    const color = COLORS[result.calendar.color] ?? COLORS.blue;
    const row = el(
      'li',
      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ' + (i === active ? 'bg-fill' : ''),
    );
    row.id = `search-opt-${i}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === active));
    row.append(
      el('span', `size-2 shrink-0 rounded-full ${color.dot}`),
      marked(result.ev?.title ?? result.title ?? '', query),
    );
    row.append(el('span', 'shrink-0 text-xs text-muted', dateLabel(result.date)));
    // pointerdown + preventDefault: het veld houdt de focus, anders sluit de blur de lijst vóór de klik aankomt
    row.addEventListener('pointerdown', (e) => e.preventDefault());
    row.addEventListener('click', () => choose(i));
    pop!.append(row);
  });

  if (!results.length) pop.append(el('li', 'px-2 py-3 text-center text-sm text-muted', 'Niets gevonden.'));
  const all = el('li', 'mt-1 cursor-pointer border-t border-line px-2 py-1.5 text-xs text-muted hover:text-fg');
  all.setAttribute('role', 'presentation');
  all.textContent = total > results.length ? `Alle ${total} resultaten tonen  ⏎` : 'Resultaten als lijst tonen  ⏎';
  all.addEventListener('pointerdown', (e) => e.preventDefault());
  all.addEventListener('click', () => showAll());
  pop.append(all);

  if (active >= 0) input.setAttribute('aria-activedescendant', `search-opt-${active}`);
  else input.removeAttribute('aria-activedescendant');
}

function choose(index: number) {
  const result = results[index];
  closeSearchPop();
  if (result) hooks.openSearchResult(result);
}

// toont of ververst de lijst voor `query`
export function updateSearchPop(field: HTMLInputElement, query: string, onShowAll: () => void) {
  input = field;
  showAll = onShowAll;
  const found = searchEvents(data, query, todayKey());
  total = found.length;
  results = found.slice(0, MAX_RESULTS);
  active = -1;
  if (!pop) {
    pop = el(
      'ul',
      'fixed z-40 w-[340px] rounded-xl border border-line bg-canvas p-1 shadow-2xl [-webkit-app-region:no-drag]',
    );
    pop.id = 'search-pop';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', 'Zoekresultaten');
    document.body.append(pop);
    field.setAttribute('aria-controls', 'search-pop');
  }
  field.setAttribute('aria-expanded', 'true');
  paint(query);
}

// pijltjes en Enter in het zoekveld; geeft true als de toets verwerkt is
export function searchPopKey(e: KeyboardEvent, query: string): boolean {
  if (!pop) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!results.length) return true;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    // van "niets gekozen" naar het eerste/laatste resultaat en terug
    active = active === -1 ? (step === 1 ? 0 : results.length - 1) : active + step;
    if (active < 0 || active >= results.length) active = -1;
    paint(query);
    return true;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (active >= 0) choose(active);
    else showAll();
    return true;
  }
  return false;
}
