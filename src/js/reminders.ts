// Meldingen met uitstellen: een kaart in de app (als je ermee bezig bent) of een melding van het systeem,
// en uitgestelde meldingen die een herstart overleven.
import { DURATION, EASE, play, reduceMotion } from './motion.ts';
import { el } from './util.ts';

export interface Reminder {
  id: string | null;
  date: string;
  title: string;
  body: string;
}

interface Snoozed extends Reminder {
  at: number; // ms sinds 1970 waarop hij opnieuw afgaat
}

export const SNOOZE_CHOICES: [minutes: number, label: string][] = [
  [5, 'Over 5 min'],
  [60, 'Over 1 uur'],
];

const KEY = 'agenda.snoozes';
const MAX_AGE = 24 * 3600_000; // een melding van gisteren hoeft na een herstart niet meer

function read(): Snoozed[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (s): s is Snoozed =>
            s && typeof s.at === 'number' && typeof s.title === 'string' && typeof s.date === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function write(list: Snoozed[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // zonder opslag werkt uitstellen nog wel zolang de app open is
  }
}

// houdt bij in het geheugen, zodat uitstellen ook werkt als localStorage niet beschikbaar is
let memory: Snoozed[] | null = null;
const list = () => (memory ??= read());
const save = (next: Snoozed[]) => {
  memory = next;
  write(next);
};

export function snooze(reminder: Reminder, minutes: number, now = Date.now()) {
  const others = list().filter((s) => !(s.id === reminder.id && s.date === reminder.date && s.id !== null));
  save([...others, { ...reminder, at: now + minutes * 60_000 }]);
}

// haalt de uitgestelde meldingen die nu aan de beurt zijn eruit (en verwijdert ze)
export function takeDueSnoozes(now = Date.now()): Reminder[] {
  const all = list();
  const due = all.filter((s) => s.at <= now && now - s.at <= MAX_AGE);
  if (!all.length) return [];
  const rest = all.filter((s) => s.at > now);
  if (rest.length !== all.length) save(rest);
  return due.map(({ id, date, title, body }) => ({ id, date, title, body }));
}

export const pendingSnoozes = () => list().length;

// alleen voor tests: geheugen en opslag leegmaken
export function resetSnoozes() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // niets te doen
  }
}

// --- de kaart in de app ---

function stack() {
  let box = document.getElementById('reminders');
  if (!box) {
    box = el('div', 'fixed top-14 right-4 z-40 flex w-[320px] flex-col gap-2');
    box.id = 'reminders';
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
}

function remove(card: HTMLElement) {
  card.removeAttribute('role');
  if (reduceMotion() || typeof card.animate !== 'function') return card.remove();
  void play(
    card,
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateX(12px)' },
    ],
    { duration: DURATION.fast, easing: EASE.in, fill: 'forwards' },
  ).then(() => card.remove());
}

export function showReminderCard(reminder: Reminder, open: (reminder: Reminder) => void, now = () => Date.now()) {
  const card = el('div', 'rounded-xl border border-line bg-canvas p-3 shadow-2xl');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `Herinnering: ${reminder.title}`);
  card.dataset.reminder = reminder.id ?? '';

  const title = el('button', 'block w-full truncate text-left text-sm font-semibold hover:underline', reminder.title);
  title.type = 'button';
  title.addEventListener('click', () => {
    remove(card);
    open(reminder);
  });
  card.append(title);
  if (reminder.body) card.append(el('p', 'mt-0.5 truncate text-xs text-muted', reminder.body));

  const row = el('div', 'mt-2 flex flex-wrap items-center gap-1.5');
  for (const [minutes, label] of SNOOZE_CHOICES) {
    const button = el('button', 'rounded-md bg-fill px-2.5 py-1 text-xs hover:brightness-95', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      snooze(reminder, minutes, now());
      remove(card);
    });
    row.append(button);
  }
  const close = el('button', 'ml-auto rounded-md px-2.5 py-1 text-xs text-muted hover:bg-fill', 'Sluiten');
  close.type = 'button';
  close.addEventListener('click', () => remove(card));
  row.append(close);
  card.append(row);

  stack().append(card);
  void play(
    card,
    [
      { opacity: 0, transform: 'translateX(16px) scale(0.98)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: DURATION.base, easing: EASE.out },
  );
  return card;
}
