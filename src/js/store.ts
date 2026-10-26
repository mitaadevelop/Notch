// laden, opslaan, ongedaan maken en alle wijzigingen van de data
import type {
  AgendaData,
  CalendarInput,
  CalEvent,
  EventInput,
  EventOcc,
  EventTemplate,
  EventValues,
  Scope,
} from '../shared/types.ts';
import { applyDelete, applyEdit, isDone, migrate, normalizeCalendar, normalizeEvent } from './model.ts';
import { data, hooks, isReadOnly, writableCalendars } from './state.ts';
import type { Move } from './state.ts';
import { addDays, diffDays, fromMinutes, toMinutes, uid } from './util.ts';

const undoStack: string[] = [];
const redoStack: string[] = [];

const snapshot = () => JSON.stringify({ calendars: data.calendars, events: data.events, settings: data.settings });

function restore(json: string) {
  const saved: Pick<AgendaData, 'calendars' | 'events' | 'settings'> = JSON.parse(json);
  data.calendars = saved.calendars;
  data.events = saved.events;
  data.settings = saved.settings;
}

function persist() {
  window.agenda.save(data).catch((error) => console.error('opslaan mislukt', error));
}

export async function load() {
  Object.assign(data, migrate(await window.agenda.load()));
}

// voert een wijziging uit met een momentopname erbij voor ongedaan maken
// `label` beschrijft de wijziging voor de melding met "Ongedaan maken"
export function commit(change: () => void, label?: string) {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  change();
  persist();
  hooks.render();
  if (label) hooks.undoToast?.(label);
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop()!);
  persist();
  hooks.render();
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop()!);
  persist();
  hooks.render();
  return true;
}

// --- afspraken ---

// een nieuwe afspraak komt nooit in een alleen-lezen agenda terecht (plakken, kopiëren, dupliceren): dan in de eerste eigen agenda
function writableId() {
  const writable = writableCalendars();
  return (writable.find((c) => c.type === 'user') ?? writable[0])?.id;
}

// Meerdere afspraken in één stap (en dus één "Ongedaan maken").
export function addEvents(list: EventInput[], label: string) {
  const events = list.map((values) => {
    const calendarId = values.calendarId && isReadOnly(values.calendarId) ? writableId() : values.calendarId;
    return normalizeEvent({ id: uid(), ...values, calendarId });
  });
  commit(() => data.events.push(...events), label);
  return events;
}

export function addEvent(values: EventInput, label = 'Afspraak toegevoegd') {
  return addEvents([values], label)[0];
}

export function editOccurrences(
  items: { occ: EventOcc; values: EventValues }[],
  scope: Scope,
  label = items.length > 1 ? `${items.length} afspraken gewijzigd` : 'Afspraak gewijzigd',
) {
  const editable = items.filter((item) => !isReadOnly(item.occ.calendarId));
  if (!editable.length) return;
  commit(() => {
    const done = new Set<string>();
    for (const { occ, values } of editable) {
      // bij "alle" is één bewerking per reeks genoeg
      if (scope === 'all') {
        if (done.has(occ.ev.id)) continue;
        done.add(occ.ev.id);
      }
      // telkens de actuele afspraak nemen: een eerdere bewerking kan hem al veranderd hebben
      const current = data.events.find((e) => e.id === occ.ev.id) ?? occ.ev;
      data.events = applyEdit(data.events, current, occ.baseDate, scope, values, uid());
    }
  }, label);
}

export function editOccurrence(occ: EventOcc, scope: Scope, values: EventValues, label = 'Afspraak gewijzigd') {
  editOccurrences([{ occ, values }], scope, label);
}

export function deleteOccurrences(
  occs: EventOcc[],
  scope: Scope,
  label = occs.length > 1 ? `${occs.length} afspraken verwijderd` : 'Afspraak verwijderd',
) {
  const deletable = occs.filter((occ) => !isReadOnly(occ.calendarId));
  if (!deletable.length) return;
  commit(() => {
    for (const occ of deletable) {
      const current = data.events.find((e) => e.id === occ.ev.id);
      if (current) data.events = applyDelete(data.events, current, occ.baseDate, scope);
    }
  }, label);
}

export function deleteOccurrence(occ: EventOcc, scope: Scope) {
  deleteOccurrences([occ], scope);
}

// verplaatst of verlengt een voorkomen met dagen/minuten, gerekend vanaf de waarden in de eigen tijdzone
export function moveValues(
  occ: EventOcc,
  { days = 0, startMinutes = 0, endMinutes = startMinutes, toTimed }: Move = {},
): EventValues {
  const { base } = occ;
  const values: EventValues = { ...pickFields(occ.ev), date: '', endDate: '', time: '', endTime: '' };
  const span = diffDays(base.date, base.endDate);
  values.date = addDays(base.date, days);
  values.endDate = addDays(values.date, span);
  values.time = base.time;
  values.endTime = base.endTime;
  if (toTimed) {
    values.time = toTimed.time;
    values.endTime = toTimed.endTime;
  } else if (base.time) {
    values.time = shiftTime(base.time, startMinutes);
    values.endTime = base.endTime ? shiftTime(base.endTime, endMinutes) : '';
  }
  return values;
}

const pickFields = (ev: CalEvent) => ({
  title: ev.title,
  calendarId: ev.calendarId,
  location: ev.location,
  url: ev.url,
  notes: ev.notes,
  repeat: ev.repeat,
  alert: ev.alert,
  travel: ev.travel,
  invitees: ev.invitees,
  tz: ev.tz,
  task: ev.task,
});

function shiftTime(time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(Math.max(h * 60 + m + minutes, 0), 24 * 60 - 1);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// De waarden van een geplakte kopie op een dag; met `time` (plakken in het uurraster) schuift de afspraak naar dat
// tijdstip en behoudt de duur.
export function pasted(clip: CalEvent, dateKey: string, time?: string): EventInput {
  const span = diffDays(clip.date, clip.endDate);
  let { time: start, endTime } = clip;
  if (time && clip.time) {
    start = time;
    if (clip.endDate === clip.date) {
      const length = clip.endTime ? Math.max(toMinutes(clip.endTime) - toMinutes(clip.time), 15) : 60;
      endTime = fromMinutes(Math.min(toMinutes(time) + length, 24 * 60 - 1));
    }
  }
  return { ...clip, id: uid(), date: dateKey, endDate: addDays(dateKey, span), time: start, endTime, exceptions: [] };
}

// Plakt één of meer afspraken; de vroegste komt op `dateKey` en de rest behoudt zijn afstand daartoe.
export function pasteEvents(clips: CalEvent[], dateKey: string, time?: string) {
  const first = clips.reduce((min, c) => (c.date < min ? c.date : min), clips[0].date);
  const single = clips.length === 1;
  const list = clips.map((c) => pasted(c, addDays(dateKey, diffDays(first, c.date)), single ? time : undefined));
  return addEvents(list, single ? 'Afspraak geplakt' : `${list.length} afspraken geplakt`);
}

export function pasteEvent(clip: CalEvent, dateKey: string, time?: string) {
  return pasteEvents([clip], dateKey, time)[0];
}

export const eventToClip = (ev: CalEvent) => structuredClone({ ...ev });

// --- agenda's ---

export function addCalendar(values: CalendarInput) {
  const calendar = normalizeCalendar({ id: uid(), type: 'user', ...values });
  commit(() => data.calendars.push(calendar));
  return calendar;
}

export function editCalendar(id: string, values: CalendarInput) {
  commit(() => {
    data.calendars = data.calendars.map((c) => (c.id === id ? { ...c, ...values } : c));
  });
}

export function setCalendarVisible(id: string, visible: boolean) {
  editCalendar(id, { visible });
}

export function deleteCalendar(id: string) {
  const source = data.calendars.find((c) => c.id === id)?.source;
  commit(() => {
    data.calendars = data.calendars.filter((c) => c.id !== id);
    data.events = data.events.filter((e) => e.calendarId !== id);
  }, 'Agenda verwijderd');
  // het wachtwoord van een account verdwijnt als het laatste agenda-abonnement ervan is verwijderd
  if (
    source?.kind === 'caldav' &&
    !data.calendars.some((c) => c.source?.kind === 'caldav' && c.source.accountId === source.accountId)
  ) {
    window.agenda.removeAccount(source.accountId).catch((error) => console.error('account verwijderen mislukt', error));
  }
}

// Vinkt een taak af (of weer open) voor het gekozen voorkomen. Alleen-lezen agenda's kunnen dat niet.
export function setTaskDone(occ: EventOcc, done: boolean, label = done ? 'Taak afgevinkt' : 'Taak weer open') {
  const current = data.events.find((e) => e.id === occ.ev.id);
  if (!current?.task || isReadOnly(current.calendarId) || isDone(current, occ.baseDate) === done) return;
  commit(() => {
    data.events = data.events.map((e) =>
      e.id === current.id
        ? { ...e, doneOn: done ? [...e.doneOn, occ.baseDate].sort() : e.doneOn.filter((d) => d !== occ.baseDate) }
        : e,
    );
  }, label);
}

export const toggleTaskDone = (occ: EventOcc) => setTaskDone(occ, !isDone(occ.ev, occ.baseDate));

export function addTemplate(template: EventTemplate) {
  commit(() => {
    // dezelfde naam vervangt het oude sjabloon in plaats van er een tweede naast te zetten
    data.settings.templates = [...data.settings.templates.filter((t) => t.name !== template.name), template].slice(-50);
  }, `Sjabloon “${template.name}” bewaard`);
}

export function removeTemplate(id: string) {
  if (!data.settings.templates.some((t) => t.id === id)) return;
  commit(() => {
    data.settings.templates = data.settings.templates.filter((t) => t.id !== id);
  }, 'Sjabloon verwijderd');
}

export function updateSettings(patch: Partial<AgendaData['settings']>) {
  commit(() => Object.assign(data.settings, patch));
}

export function importEvents(calendarName: string, events: EventInput[]) {
  const calendar = normalizeCalendar({ id: uid(), name: calendarName || 'Geïmporteerd', color: 'gray', type: 'user' });
  commit(() => {
    data.calendars.push(calendar);
    for (const e of events) data.events.push(normalizeEvent({ ...e, id: uid(), calendarId: calendar.id }));
  });
  return calendar;
}

// --- synchronisatie met externe agenda's (valt buiten ongedaan maken: het is geen keuze van de gebruiker) ---

// vervangt de afspraken van een externe agenda; met `error` blijven de oude afspraken staan en wordt de fout bewaard
export function applySync(calendarId: string, parsed: EventInput[] | null, error = '') {
  const calendar = data.calendars.find((c) => c.id === calendarId);
  if (!calendar) return;
  let changed: boolean;
  if (parsed) {
    const seen = new Set<string>();
    const next = parsed.map((e) => {
      let id = `${calendarId}:${e.id ?? uid()}`;
      while (seen.has(id)) id += '+';
      seen.add(id);
      return normalizeEvent({ ...e, id, calendarId });
    });
    const previous = data.events.filter((e) => e.calendarId === calendarId);
    changed = JSON.stringify(previous) !== JSON.stringify(next) || Boolean(calendar.syncError);
    if (changed) data.events = [...data.events.filter((e) => e.calendarId !== calendarId), ...next];
    calendar.syncedAt = Date.now();
    delete calendar.syncError;
  } else {
    changed = calendar.syncError !== error;
    calendar.syncError = error;
  }
  persist();
  if (changed) hooks.render();
}
