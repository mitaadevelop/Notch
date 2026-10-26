// dialogen: afspraak, agenda, bereik-keuze, voorkeuren en snel invoeren
import type {
  Calendar,
  ColorName,
  EventInput,
  EventOcc,
  EventValues,
  Quick,
  Repeat,
  RepeatFreq,
  Scope,
} from '../shared/types.ts';
import { COLOR_NAMES, normalizeEvent } from './model.ts';
import { COLORS } from './colors.ts';
import { occurrencesBetween } from './occurrences.ts';
import { parseQuick } from './quick.ts';
import { calendarOf, data, hooks, isReadOnly, ui, writableCalendars } from './state.ts';
import type { NewEventOptions } from './state.ts';
import * as store from './store.ts';
import { dateLabel, timesLabel } from './format.ts';
import { refreshBackups } from './backups.ts';
import { findFreeSlots } from './freetime.ts';
import { toICS } from './ics.ts';
import { emailsOf, inviteDraft } from './invite.ts';
import { TIMEZONES } from './zones.ts';
import { showSystemSettings } from './system.ts';
import { showWeatherSettings } from './weather.ts';
import { templateFromValues } from './templates.ts';
import { closePopovers } from './popover.ts';
import { $, addDays, el, fromMinutes, pad, toMinutes, uid } from './util.ts';

type Choice<V extends string | number | null> = [V, string];

const ALERTS_TIMED: Choice<number | null>[] = [
  [null, 'Geen'],
  [0, 'Op het moment zelf'],
  [5, '5 minuten ervoor'],
  [10, '10 minuten ervoor'],
  [15, '15 minuten ervoor'],
  [30, '30 minuten ervoor'],
  [60, '1 uur ervoor'],
  [120, '2 uur ervoor'],
  [1440, '1 dag ervoor'],
  [2880, '2 dagen ervoor'],
  [10080, '1 week ervoor'],
];
const REFRESH_CHOICES: Choice<number>[] = [
  [0, 'Uit (alleen met de knop)'],
  [5, 'Elke 5 minuten'],
  [15, 'Elke 15 minuten'],
  [30, 'Elke 30 minuten'],
  [60, 'Elk uur'],
  [180, 'Elke 3 uur'],
];
const ALERTS_ALL_DAY: Choice<number | null>[] = [
  [null, 'Geen'],
  [0, 'Op de dag zelf (09:00)'],
  [1440, '1 dag ervoor (09:00)'],
  [2880, '2 dagen ervoor (09:00)'],
  [10080, '1 week ervoor (09:00)'],
];
const TRAVEL: Choice<number>[] = [
  [0, 'Geen'],
  [5, '5 minuten'],
  [10, '10 minuten'],
  [15, '15 minuten'],
  [30, '30 minuten'],
  [45, '45 minuten'],
  [60, '1 uur'],
  [90, '1,5 uur'],
  [120, '2 uur'],
];
const REPEATS: Choice<string>[] = [
  ['none', 'Nooit'],
  ['daily', 'Elke dag'],
  ['weekdays', 'Elke werkdag'],
  ['weekly', 'Elke week'],
  ['biweekly', 'Om de week'],
  ['monthly', 'Elke maand'],
  ['yearly', 'Elk jaar'],
];

const fillSelect = (
  select: HTMLSelectElement,
  options: Choice<string | number | null>[],
  value: string | number | null | undefined,
) => {
  select.replaceChildren(...options.map(([v, label]) => new Option(label, String(v ?? ''))));
  select.value = String(value ?? '');
  if (select.value !== String(value ?? '')) select.value = String(options[0][0] ?? '');
};

const ensureOption = (select: HTMLSelectElement, value: string | number, label: string) => {
  if (![...select.options].some((o) => o.value === String(value))) select.add(new Option(label, String(value)));
  select.value = String(value);
};

let lastCalendarId: string | null = null;
export const defaultCalendarId = () => {
  const writable = writableCalendars();
  return (
    writable.find((c) => c.id === lastCalendarId)?.id ?? (writable.find((c) => c.type === 'user') ?? writable[0]).id
  );
};

// --- bereik-keuze voor herhalende afspraken ---

const MESSAGES: Record<string, string> = {
  edit: 'Wil je alleen deze afspraak wijzigen, of ook de volgende?',
  delete: 'Wil je alleen deze afspraak verwijderen, of ook de volgende?',
  move: 'Wil je alleen deze afspraak verplaatsen, of ook de volgende?',
};

export function askScope(kind: 'edit' | 'delete' | 'move'): Promise<Scope | null> {
  const dialog = $<HTMLDialogElement>('scope-dialog');
  $('scope-message').textContent = MESSAGES[kind] ?? MESSAGES.edit;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: Scope | null) => {
      if (done) return;
      done = true;
      dialog.close();
      resolve(value);
    };
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-scope]')) {
      button.onclick = () => finish((button.dataset.scope || null) as Scope | null);
    }
    dialog.oncancel = () => finish(null);
    dialog.showModal();
  });
}

// --- afspraak ---

const f = {
  dialog: $<HTMLDialogElement>('event-dialog'),
  form: $<HTMLFormElement>('event-form'),
  title: $<HTMLInputElement>('e-title'),
  location: $<HTMLInputElement>('e-location'),
  calendar: $<HTMLSelectElement>('e-calendar'),
  dot: $('e-cal-dot'),
  allDay: $<HTMLInputElement>('e-allday'),
  task: $<HTMLInputElement>('e-task'),
  mail: $<HTMLButtonElement>('e-mail'),
  startDate: $<HTMLInputElement>('e-start-date'),
  startTime: $<HTMLInputElement>('e-start-time'),
  endDate: $<HTMLInputElement>('e-end-date'),
  endTime: $<HTMLInputElement>('e-end-time'),
  tz: $<HTMLSelectElement>('e-tz'),
  tzRow: $('e-tz-row'),
  repeat: $<HTMLSelectElement>('e-repeat'),
  untilRow: $('e-until-row'),
  untilMode: $<HTMLSelectElement>('e-until-mode'),
  untilDate: $<HTMLInputElement>('e-until-date'),
  alert: $<HTMLSelectElement>('e-alert'),
  travel: $<HTMLSelectElement>('e-travel'),
  travelRow: $('e-travel-row'),
  invitees: $('e-invitees'),
  inviteeInput: $<HTMLInputElement>('e-invitee-input'),
  url: $<HTMLInputElement>('e-url'),
  notes: $<HTMLTextAreaElement>('e-notes'),
  save: $<HTMLButtonElement>('e-save'),
  remove: $<HTMLButtonElement>('e-delete'),
};

const form: { occ: EventOcc | null; invitees: string[]; keepRepeat: Repeat | null; duration: number } = {
  occ: null,
  invitees: [],
  keepRepeat: null,
  duration: 60,
};
// minuten sinds een vaste oorsprong, puur voor rekenen met datum + tijd
const stamp = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + (time ? toMinutes(time) : 0);
};
const unstamp = (minutes: number) => {
  const date = new Date(minutes * 60000);
  return {
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    time: fromMinutes(date.getUTCHours() * 60 + date.getUTCMinutes()),
  };
};
const startStamp = () => stamp(f.startDate.value, f.allDay.checked ? '' : f.startTime.value);
const endStamp = () => stamp(f.endDate.value, f.allDay.checked ? '' : f.endTime.value);

function repeatKey(repeat: Repeat | null) {
  if (!repeat) return 'none';
  if (repeat.freq === 'weekly' && repeat.interval === 2) return 'biweekly';
  if (repeat.interval > 1 && repeat.freq !== 'weekdays') return 'keep';
  return repeat.freq;
}

function readRepeat(): Repeat | null {
  const key = f.repeat.value;
  if (key === 'none') return null;
  const until = f.untilMode.value === 'date' ? f.untilDate.value : '';
  if (key === 'keep' && form.keepRepeat) return { ...form.keepRepeat, until };
  if (key === 'biweekly') return { freq: 'weekly', interval: 2, until };
  return { freq: key as RepeatFreq, interval: 1, until };
}

function syncAllDay() {
  const allDay = f.allDay.checked;
  f.startTime.disabled = f.endTime.disabled = allDay;
  f.startTime.required = !allDay;
  f.tzRow.hidden = f.travelRow.hidden = allDay;
  const current = f.alert.value === '' ? null : Number(f.alert.value);
  const options = allDay ? ALERTS_ALL_DAY : ALERTS_TIMED;
  fillSelect(f.alert, options, current);
  if (current !== null && f.alert.value === '') ensureOption(f.alert, current, `${current} minuten ervoor`);
}

function syncRepeat() {
  f.untilRow.hidden = f.repeat.value === 'none';
  f.untilDate.disabled = f.untilMode.value !== 'date';
}

function renderInvitees() {
  f.invitees.replaceChildren(
    ...form.invitees.map((name, index) => {
      const chip = el('span', 'flex items-center gap-1 rounded-full bg-fill py-0.5 pr-1 pl-2 text-xs');
      const remove = el('button', 'rounded-full px-1 text-muted hover:text-fg', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${name} verwijderen`);
      remove.addEventListener('click', () => {
        form.invitees.splice(index, 1);
        renderInvitees();
      });
      chip.append(name, remove);
      return chip;
    }),
  );
  f.mail.disabled = emailsOf(form.invitees).length === 0;
}

function addInvitee() {
  const value = f.inviteeInput.value.replace(/,$/, '').trim();
  if (value && !form.invitees.includes(value)) form.invitees.push(value);
  f.inviteeInput.value = '';
  renderInvitees();
}

function setCalendarDot() {
  const color = COLORS[calendarOf(f.calendar.value)?.color] ?? COLORS.blue;
  f.dot.className = `size-3 shrink-0 rounded-full ${color.dot}`;
}

// Afspraken uit een externe agenda (Google, iCloud, …) kunnen hier alleen bekeken worden: tekstvelden worden
// alleen-lezen (zodat kopiëren kan), de rest uitgeschakeld, en opslaan/verwijderen verdwijnt.
function setReadOnly(readOnly: boolean, calendarName = '') {
  const note = $('e-readonly');
  note.hidden = !readOnly;
  note.textContent = readOnly
    ? `Alleen-lezen: deze afspraak komt uit “${calendarName}”. Wijzig hem in die agenda zelf.`
    : '';
  f.save.hidden = readOnly;
  f.dialog.dataset.readonly = String(readOnly);
  const controls = f.form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
  >('input, select, textarea, button');
  for (const control of controls) {
    if (control.id === 'e-cancel' || !readOnly) continue;
    if (
      control instanceof HTMLTextAreaElement ||
      (control instanceof HTMLInputElement && TEXT_LIKE.has(control.type))
    ) {
      control.readOnly = true;
    } else if (!(control instanceof HTMLButtonElement && control === f.remove)) {
      control.disabled = true;
    }
  }
  if (readOnly) f.remove.hidden = true;
}

// zet alles terug na een eerdere alleen-lezen weergave; syncAllDay/syncRepeat bepalen daarna welke velden uit moeten
function resetControls() {
  for (const control of f.form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
  >('input, select, textarea, button')) {
    control.disabled = false;
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.readOnly = false;
  }
}

const TEXT_LIKE = new Set(['text', 'url', 'date', 'time', 'search']);

// opts.occ bewerkt een afspraak; de rest (date, time, endTime, allDay, prefill) maakt een nieuwe
export function openEventDialog(opts: NewEventOptions & { occ?: EventOcc } = {}) {
  closePopovers();
  const occ = opts.occ ?? null;
  const ev = occ?.ev ?? null;
  resetControls();
  const base = occ?.base;
  const prefill = opts.prefill ?? {};
  form.occ = occ;
  form.invitees = [...(ev?.invitees ?? prefill.invitees ?? [])];
  form.keepRepeat = ev?.repeat ?? null;

  const now = new Date();
  const nextHour = fromMinutes(Math.min((now.getHours() + 1) * 60, 23 * 60));
  const date = base?.date ?? prefill.date ?? opts.date ?? ui.selectedDate;
  const allDay = ev ? !ev.time : prefill.date ? !prefill.time : (opts.allDay ?? false);
  const startTime = base?.time || prefill.time || opts.time || nextHour;
  const endTime = ev
    ? base!.endTime || fromMinutes(Math.min(toMinutes(startTime) + 60, 24 * 60 - 1))
    : prefill.endTime || opts.endTime || fromMinutes(Math.min(toMinutes(startTime) + 60, 24 * 60 - 1));

  f.title.value = ev?.title ?? prefill.title ?? '';
  f.location.value = ev?.location ?? prefill.location ?? '';
  f.url.value = ev?.url ?? '';
  f.notes.value = ev?.notes ?? '';

  const choices = writableCalendars();
  // een afspraak uit een externe agenda blijft in zijn eigen agenda staan, ook al is die niet bewerkbaar
  if (ev && !choices.some((c) => c.id === ev.calendarId)) choices.unshift(calendarOf(ev.calendarId));
  f.calendar.replaceChildren(...choices.map((c) => new Option(c.name, c.id)));
  f.calendar.value = ev?.calendarId ?? prefill.calendarId ?? defaultCalendarId();
  if (!f.calendar.value) f.calendar.value = defaultCalendarId();
  setCalendarDot();

  f.allDay.checked = allDay;
  f.task.checked = ev?.task ?? prefill.task ?? false;
  f.startDate.value = date;
  f.startTime.value = startTime;
  f.endDate.value = base?.endDate ?? prefill.endDate ?? opts.endDate ?? date;
  f.endTime.value = endTime;
  form.duration = endStamp() - startStamp();

  fillSelect(f.tz, TIMEZONES, ev?.tz ?? '');
  if (ev?.tz) ensureOption(f.tz, ev.tz, ev.tz);

  const repeat = ev?.repeat ?? prefill.repeat ?? null;
  fillSelect(f.repeat, REPEATS, repeatKey(repeat));
  if (repeatKey(repeat) === 'keep') {
    f.repeat.add(new Option('Aangepast (behouden)', 'keep'));
    f.repeat.value = 'keep';
  }
  f.untilMode.value = repeat?.until ? 'date' : 'never';
  f.untilDate.value = repeat?.until || addDays(date, 365);

  fillSelect(f.alert, allDay ? ALERTS_ALL_DAY : ALERTS_TIMED, null);
  const wantedAlert = ev ? ev.alert : (prefill.alert ?? data.settings.defaultAlert);
  if (wantedAlert !== null && wantedAlert !== undefined) {
    f.alert.value = String(wantedAlert);
    if (f.alert.value !== String(wantedAlert)) {
      if (ev) ensureOption(f.alert, wantedAlert, `${wantedAlert} minuten ervoor`);
      else f.alert.value = '';
    }
  }

  fillSelect(f.travel, TRAVEL, ev?.travel ?? 0);
  if (ev?.travel && f.travel.value !== String(ev.travel)) ensureOption(f.travel, ev.travel, `${ev.travel} minuten`);

  f.save.textContent = ev ? 'Bewaar' : 'Voeg toe';
  f.remove.hidden = !ev;
  f.endTime.setCustomValidity('');
  f.endDate.setCustomValidity('');
  syncAllDay();
  syncRepeat();
  renderInvitees();
  setReadOnly(Boolean(ev && isReadOnly(ev.calendarId)), ev ? calendarOf(ev.calendarId)?.name : undefined);
  updateOverlap();
  f.dialog.showModal();
  f.title.focus();
  f.title.select();
}

// Waarschuwt als de afspraak overlapt met andere afspraken met een tijd (hele-dag-afspraken tellen niet mee).
function updateOverlap() {
  const note = $('e-overlap');
  const start = f.startDate.value && f.startTime.value ? startStamp() : null;
  if (f.allDay.checked || start === null || !f.endDate.value || !f.endTime.value) {
    note.hidden = true;
    return;
  }
  const end = Math.max(endStamp(), start + 1);
  const clashes = occurrencesBetween(data, f.startDate.value, f.endDate.value).filter((o) => {
    if (o.holiday || o.allDay || o.id === form.occ?.id) return false;
    const from = stamp(o.date, o.time);
    const to = o.endTime ? stamp(o.endDate, o.endTime) : from + 60;
    return from < end && to > start;
  });
  note.hidden = clashes.length === 0;
  if (!clashes.length) return;
  const names = clashes.slice(0, 2).map((o) => `“${o.title || 'zonder titel'}”`);
  const more = clashes.length > 2 ? ` en ${clashes.length - 2} andere` : '';
  const fix = el('button', 'ml-2 underline underline-offset-2 hover:opacity-80', 'Zoek een vrij moment');
  fix.type = 'button';
  fix.addEventListener('click', moveToFreeSlot);
  note.replaceChildren(`⚠ Overlapt met ${names.join(' en ')}${more}.`, fix);
}

// Zet de afspraak op het eerstvolgende gat (met dezelfde lengte) in de komende twee weken, tussen 08:00 en 21:00.
function moveToFreeSlot() {
  const length = Math.max(endStamp() - startStamp(), 5); // stempels zijn in minuten
  const earliest = toMinutes(f.startTime.value);
  const slot = findFreeSlots(data, {
    from: f.startDate.value,
    to: addDays(f.startDate.value, 14),
    duration: length,
    dayStart: 8 * 60,
    dayEnd: 21 * 60,
    weekends: true,
    limit: 1,
    ignore: (o) => o.id === form.occ?.id,
    // op de eigen dag alleen vanaf het huidige begin, zodat het niet naar eerder op de dag springt
    notBefore: Math.ceil(earliest / 5) * 5,
  })[0];
  if (!slot) {
    $('e-overlap').textContent = '⚠ Geen vrij moment gevonden in de komende twee weken.';
    return;
  }
  f.startDate.value = slot.date;
  f.startTime.value = fromMinutes(slot.start);
  // het einde volgt uit de lengte; onStartChange rekent met form.duration
  form.duration = length;
  onStartChange();
}

f.allDay.addEventListener('change', () => {
  syncAllDay();
  form.duration = endStamp() - startStamp();
  updateOverlap();
});

// begin verschuiven neemt het einde mee, einde aanpassen wijzigt de duur
const onStartChange = () => {
  if (!f.startDate.value) return;
  const end = unstamp(startStamp() + form.duration);
  f.endDate.value = end.date;
  if (!f.allDay.checked) f.endTime.value = end.time;
  f.endTime.setCustomValidity('');
  f.endDate.setCustomValidity('');
  updateOverlap();
};
const onEndChange = () => {
  form.duration = endStamp() - startStamp();
  f.endTime.setCustomValidity('');
  f.endDate.setCustomValidity('');
  updateOverlap();
};
f.startDate.addEventListener('change', onStartChange);
f.startTime.addEventListener('change', onStartChange);
f.endDate.addEventListener('change', onEndChange);
f.endTime.addEventListener('change', onEndChange);

f.calendar.addEventListener('change', () => {
  setCalendarDot();
  updateOverlap();
  // verjaardagen herhalen jaarlijks en duren de hele dag
  if (calendarOf(f.calendar.value)?.type === 'birthdays' && !form.occ && f.repeat.value === 'none') {
    f.repeat.value = 'yearly';
    f.allDay.checked = true;
    syncAllDay();
    syncRepeat();
    form.duration = endStamp() - startStamp();
  }
});
f.repeat.addEventListener('change', syncRepeat);
f.untilMode.addEventListener('change', syncRepeat);
f.inviteeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addInvitee();
  }
});
f.inviteeInput.addEventListener('blur', addInvitee);
$('e-cancel').addEventListener('click', () => f.dialog.close());
f.dialog.addEventListener('click', (e) => {
  if (e.target === f.dialog) f.dialog.close();
});

// De waarden van het formulier als afspraak.
function readValues(): EventValues {
  const allDay = f.allDay.checked;
  const alert = f.alert.value === '' ? null : Number(f.alert.value);
  return {
    title: f.title.value.trim(),
    calendarId: f.calendar.value,
    location: f.location.value.trim(),
    url: f.url.value.trim(),
    notes: f.notes.value.trim(),
    date: f.startDate.value,
    endDate: f.endDate.value,
    time: allDay ? '' : f.startTime.value,
    endTime: allDay ? '' : f.endTime.value,
    tz: allDay ? '' : f.tz.value,
    repeat: readRepeat(),
    alert,
    travel: allDay ? 0 : Number(f.travel.value) || 0,
    invitees: form.invitees,
    task: f.task.checked,
  };
}

f.mail.addEventListener('click', async () => {
  const values = readValues();
  if (!(await window.agenda.composeMail(inviteDraft(values)))) f.mail.title = 'De mail-app kon niet worden geopend.';
});

$('e-ics').addEventListener('click', async () => {
  const values = readValues();
  if (!values.title) {
    f.title.focus();
    return;
  }
  const ev = normalizeEvent({ ...values, id: form.occ?.id ?? uid() });
  await window.agenda.exportICS(toICS(values.title, [ev]), values.title);
});

$('e-template').addEventListener('click', () => {
  const values = readValues();
  if (!values.title) {
    f.title.focus();
    return;
  }
  store.addTemplate(templateFromValues(values, values.title, uid()));
});

f.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = f.title.value.trim();
  if (!title) return;
  const allDay = f.allDay.checked;

  if (endStamp() < startStamp()) {
    const field = allDay || f.endDate.value > f.startDate.value ? f.endDate : f.endTime;
    field.setCustomValidity('Het einde moet na het begin liggen.');
    field.reportValidity();
    return;
  }

  const values = readValues();

  const occ = form.occ;
  let scope: Scope | null = 'all';
  if (occ?.recurring) {
    scope = await askScope('edit');
    if (!scope) return;
  }
  lastCalendarId = values.calendarId;
  ui.selectedDate = ui.miniKey = values.date;
  f.dialog.close();
  if (occ) store.editOccurrence(occ, scope, values);
  else store.addEvent(values);
});

f.remove.addEventListener('click', async () => {
  const occ = form.occ;
  if (!occ) return;
  let scope: Scope | null = 'all';
  if (occ.recurring) {
    scope = await askScope('delete');
    if (!scope) return;
  }
  f.dialog.close();
  store.deleteOccurrence(occ, scope);
});

// --- agenda ---

const c = {
  dialog: $<HTMLDialogElement>('calendar-dialog'),
  form: $<HTMLFormElement>('calendar-form'),
  heading: $('c-heading'),
  name: $<HTMLInputElement>('c-name'),
  colors: $('c-colors'),
  remove: $<HTMLButtonElement>('c-delete'),
};
let editing: Calendar | null = null;
let chosenColor: ColorName = 'blue';
let confirmDelete = false;

function renderCalendarSwatches() {
  c.colors.replaceChildren(
    ...COLOR_NAMES.map((name) => {
      const color = COLORS[name];
      const swatch = el(
        'button',
        `size-5 rounded-full ${color.dot} ` + (name === chosenColor ? 'outline-2 outline-offset-2 outline-fg/60' : ''),
      );
      swatch.type = 'button';
      swatch.title = color.label;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-checked', String(name === chosenColor));
      swatch.addEventListener('click', () => {
        chosenColor = name;
        renderCalendarSwatches();
      });
      return swatch;
    }),
  );
}

export function openCalendarDialog(calendar: Calendar | null = null) {
  editing = calendar;
  confirmDelete = false;
  c.heading.textContent = calendar ? 'Agenda bewerken' : 'Nieuwe agenda';
  c.name.value = calendar?.name ?? '';
  chosenColor = calendar?.color ?? COLOR_NAMES[data.calendars.length % COLOR_NAMES.length];
  c.remove.hidden = !calendar || calendar.type !== 'user';
  c.remove.textContent = 'Verwijder';
  renderCalendarSwatches();
  c.dialog.showModal();
  c.name.focus();
  c.name.select();
}

c.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = c.name.value.trim();
  if (!name) return;
  c.dialog.close();
  if (editing) store.editCalendar(editing.id, { name, color: chosenColor });
  else store.addCalendar({ name, color: chosenColor });
});
c.remove.addEventListener('click', () => {
  const target = editing;
  if (!target) return;
  const count = data.events.filter((ev) => ev.calendarId === target.id).length;
  if (!confirmDelete && count > 0) {
    confirmDelete = true;
    c.remove.textContent = `Zeker? ${count} afspraken gaan mee`;
    return;
  }
  c.dialog.close();
  store.deleteCalendar(target.id);
});
$('c-cancel').addEventListener('click', () => c.dialog.close());

// --- voorkeuren ---

const s = {
  dialog: $<HTMLDialogElement>('settings-dialog'),
  weekStart: $<HTMLSelectElement>('s-weekstart'),
  clock24: $<HTMLInputElement>('s-clock24'),
  weekNumbers: $<HTMLInputElement>('s-weeknumbers'),
  alert: $<HTMLSelectElement>('s-alert'),
  refresh: $<HTMLSelectElement>('s-refresh'),
  clocks: [$<HTMLSelectElement>('s-clock1'), $<HTMLSelectElement>('s-clock2')],
};

export function openSettings() {
  s.weekStart.value = String(data.settings.weekStart);
  s.clock24.checked = data.settings.clock24;
  s.weekNumbers.checked = data.settings.weekNumbers;
  fillSelect(s.alert, ALERTS_TIMED, data.settings.defaultAlert);
  fillSelect(s.refresh, REFRESH_CHOICES, data.settings.refreshMinutes);
  // een eigen waarde uit het bestand blijft zichtbaar in plaats van stil te verspringen
  if (s.refresh.value !== String(data.settings.refreshMinutes)) {
    ensureOption(s.refresh, data.settings.refreshMinutes, `Elke ${data.settings.refreshMinutes} minuten`);
  }
  const clockChoices: Choice<string>[] = [['', 'Geen'], ...TIMEZONES.filter(([zone]) => zone !== '')];
  s.clocks.forEach((select, i) => fillSelect(select, clockChoices, data.settings.clocks[i] ?? ''));
  renderTemplateList();
  showSystemSettings();
  showWeatherSettings();
  s.dialog.showModal();
  void refreshBackups();
}
// de sjablonen met een knop om ze te verwijderen
export function renderTemplateList() {
  const list = $('tpl-list');
  const items = data.settings.templates.map((template) => {
    const li = el('li', 'flex items-center gap-2 rounded-md bg-fill px-2.5 py-1.5 text-sm');
    const detail = [template.time || 'hele dag', calendarOf(template.calendarId)?.name].filter(Boolean).join(' · ');
    li.append(el('span', 'min-w-0 flex-1 truncate', template.name), el('span', 'shrink-0 text-xs text-muted', detail));
    const remove = el('button', 'shrink-0 rounded px-1.5 text-muted hover:text-today', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Sjabloon ${template.name} verwijderen`);
    remove.addEventListener('click', () => {
      store.removeTemplate(template.id);
      renderTemplateList();
    });
    li.append(remove);
    return li;
  });
  list.replaceChildren(...(items.length ? items : [el('li', 'text-xs text-muted', 'Nog geen sjablonen.')]));
}
s.weekStart.addEventListener('change', () => store.updateSettings({ weekStart: Number(s.weekStart.value) }));
s.clock24.addEventListener('change', () => store.updateSettings({ clock24: s.clock24.checked }));
s.weekNumbers.addEventListener('change', () => store.updateSettings({ weekNumbers: s.weekNumbers.checked }));
const updateClocks = () =>
  store.updateSettings({ clocks: [...new Set(s.clocks.map((select) => select.value).filter(Boolean))] });
for (const select of s.clocks) select.addEventListener('change', updateClocks);
s.refresh.addEventListener('change', () => store.updateSettings({ refreshMinutes: Number(s.refresh.value) }));
s.alert.addEventListener('change', () =>
  store.updateSettings({ defaultAlert: s.alert.value === '' ? null : Number(s.alert.value) }),
);

// --- snel invoeren ---

const q = { box: $('quick'), input: $<HTMLInputElement>('q-input'), preview: $('q-preview') };

// de velden die snel invoeren altijd vult; de rest laat de dialoog of normalizeEvent aanvullen
export interface QuickValues extends EventInput {
  title: string;
  calendarId: string;
  time: string;
  endTime: string;
  location: string;
  repeat: Repeat | null;
}

// maakt van een zin in gewone taal de waarden voor een afspraak (ook gebruikt door het commandopalet)
export function quickEventFromText(
  input: string,
  now = new Date(),
): { values: QuickValues; calendar: Calendar; parsed: Quick } | null {
  const text = input.trim();
  if (!text) return null;
  const parsed = parseQuick(text, now);
  const name = parsed.calendarName.toLowerCase();
  const calendar =
    (name && writableCalendars().find((cal) => cal.name.toLowerCase().startsWith(name))) ||
    calendarOf(defaultCalendarId());
  const values: QuickValues = {
    title: parsed.title || 'Nieuwe afspraak',
    calendarId: calendar.id,
    date: parsed.date,
    endDate: parsed.date,
    time: parsed.time,
    endTime: parsed.endTime,
    location: parsed.location,
    repeat: parsed.repeat,
  };
  const alert = data.settings.defaultAlert;
  if (alert !== null && (parsed.allDay ? ALERTS_ALL_DAY : ALERTS_TIMED).some(([v]) => v === alert))
    values.alert = alert;
  return { values, calendar, parsed };
}

const quickValues = () => quickEventFromText(q.input.value);

function updateQuickPreview() {
  const result = quickValues();
  if (!result) {
    q.preview.textContent = 'Typ bijvoorbeeld “Tandarts vrijdag 14:00” of “Yoga elke dinsdag 19:00 @Studio”.';
    return;
  }
  const { values, calendar, parsed } = result;
  const when = values.time
    ? timesLabel({ allDay: false, date: values.date, endDate: values.date, time: values.time, endTime: values.endTime })
    : 'hele dag';
  const repeat = REPEATS.find(([key]) => key === (values.repeat ? repeatKey(values.repeat) : ''))?.[1];
  q.preview.textContent = [
    `${values.title}`,
    `${dateLabel(values.date)}, ${when}`,
    calendar.name,
    parsed.location && `@${parsed.location}`,
    repeat && repeat.toLowerCase(),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function openQuick() {
  q.box.hidden = false;
  q.input.value = '';
  updateQuickPreview();
  q.input.focus();
}
export function closeQuick() {
  q.box.hidden = true;
}
export const quickOpen = () => !q.box.hidden;

function submitQuick() {
  const result = quickValues();
  if (!result) return;
  closeQuick();
  ui.selectedDate = ui.miniKey = result.values.date;
  lastCalendarId = result.values.calendarId;
  store.addEvent(result.values);
}

q.input.addEventListener('input', updateQuickPreview);
q.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitQuick();
  if (e.key === 'Escape') closeQuick();
});
$('q-add').addEventListener('click', submitQuick);
$('q-cancel').addEventListener('click', closeQuick);
$('q-more').addEventListener('click', () => {
  const result = quickValues();
  closeQuick();
  hooks.newEvent(result ? { prefill: result.values } : {});
});
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Element;
  if (!q.box.hidden && !q.box.contains(target) && !target.closest('#add')) closeQuick();
});
