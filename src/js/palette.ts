// commandopalet (⌘K): opdrachten, naar een datum springen, een afspraak zoeken of in gewone taal een afspraak maken
import { quickEventFromText } from './dialogs.ts';
import { dateLabel, timesLabel } from './format.ts';
import { parseQuick } from './quick.ts';
import { searchEvents } from './search.ts';
import { data, hooks } from './state.ts';
import * as store from './store.ts';
import { $, dayHeading, el, fromKey, keyOf } from './util.ts';

export interface Command {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
}

interface Item {
  id: string;
  label: string;
  detail?: string;
  group: string;
  run: () => void;
}

let commands: () => Command[] = () => [];
// de app geeft hier haar opdrachten door; als functie, zodat labels (bijv. "Weeknummers tonen") actueel zijn
export const setCommands = (provider: () => Command[]) => (commands = provider);

const f = {
  dialog: $<HTMLDialogElement>('palette'),
  input: $<HTMLInputElement>('pal-input'),
  list: $<HTMLUListElement>('pal-list'),
};

let shown: Item[] = [];
let active = 0;

const MAX_COMMANDS = 7;
const MAX_EVENTS = 5;

function matches(command: Command, tokens: string[]) {
  const haystack = `${command.label} ${command.keywords ?? ''}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function buildItems(query: string, now = new Date()): Item[] {
  const text = query.trim();
  const all = commands();
  if (!text) return all.map((c) => ({ id: c.id, label: c.label, group: 'Opdracht', run: c.run }));

  const items: Item[] = [];
  const tokens = text.toLowerCase().split(/\s+/);
  const stripped = text.replace(/^(ga naar|naar|toon)\s+/i, '');
  const parsed = parseQuick(stripped, now);

  // alleen een datum ("3 november", "volgende vrijdag") -> ernaartoe springen
  if (parsed.dateFound && !parsed.title && !parsed.time) {
    items.push({
      id: 'goto',
      label: `Ga naar ${dayHeading.format(fromKey(parsed.date))}`,
      group: 'Ga naar',
      run: () => hooks.selectDate(parsed.date),
    });
  }

  for (const c of all.filter((c) => matches(c, tokens)).slice(0, MAX_COMMANDS)) {
    items.push({ id: c.id, label: c.label, group: 'Opdracht', run: c.run });
  }

  if (text.length >= 2) {
    for (const result of searchEvents(data, text, keyOf(now)).slice(0, MAX_EVENTS)) {
      items.push({
        id: `event-${result.ev?.id ?? result.title}-${result.date}`,
        label: result.ev?.title ?? result.title ?? '',
        detail: dateLabel(result.date),
        group: 'Afspraak',
        run: () => hooks.openSearchResult(result),
      });
    }
  }

  // een zin met een titel erin -> afspraak maken; met een datum of tijd erbij gaat dat voor de rest
  const created = parsed.title || parsed.time ? quickEventFromText(stripped, now) : null;
  if (created) {
    const { values, calendar } = created;
    const when = values.time
      ? timesLabel({
          allDay: false,
          date: values.date!,
          endDate: values.date!,
          time: values.time,
          endTime: values.endTime,
        })
      : 'hele dag';
    const item: Item = {
      id: 'create',
      label: `Maak afspraak “${values.title}”`,
      detail: `${dateLabel(values.date!)}, ${when} · ${calendar.name}`,
      group: 'Maken',
      run: () => {
        store.addEvent(values);
        hooks.selectDate(values.date!);
      },
    };
    if (parsed.dateFound || parsed.time) items.unshift(item);
    else items.push(item);
  }
  return items;
}

function render() {
  f.list.replaceChildren(
    ...shown.map((item, i) => {
      const li = el(
        'li',
        'flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-2 text-sm ' +
          (i === active ? 'bg-accent text-white' : ''),
      );
      li.id = `pal-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(el('span', 'min-w-0 flex-1 truncate font-medium', item.label));
      if (item.detail)
        li.append(el('span', `shrink-0 text-xs ${i === active ? 'text-white/80' : 'text-muted'}`, item.detail));
      li.append(
        el('span', `shrink-0 text-[10px] uppercase ${i === active ? 'text-white/70' : 'text-muted'}`, item.group),
      );
      li.addEventListener('pointermove', () => {
        if (active === i) return;
        active = i;
        render();
      });
      li.addEventListener('click', () => choose(i));
      return li;
    }),
  );
  if (!shown.length) f.list.append(el('li', 'px-3 py-6 text-center text-sm text-muted', 'Niets gevonden.'));
  f.input.setAttribute('aria-activedescendant', shown.length ? `pal-opt-${active}` : '');
  f.list.children[active]?.scrollIntoView({ block: 'nearest' });
}

function update() {
  shown = buildItems(f.input.value);
  active = 0;
  render();
}

function choose(index: number) {
  const item = shown[index];
  if (!item) return;
  f.dialog.close();
  // na het sluiten (de focus is dan terug) de opdracht uitvoeren
  setTimeout(() => item.run(), 0);
}

export const paletteOpen = () => f.dialog.open;

export function openPalette() {
  if (f.dialog.open) return;
  f.input.value = '';
  update();
  f.dialog.showModal();
  f.input.focus();
}

f.input.addEventListener('input', update);
f.input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!shown.length) return;
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(active);
  }
});
f.dialog.addEventListener('click', (e) => {
  if (e.target === f.dialog) f.dialog.close();
});
