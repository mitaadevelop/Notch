// De tools die Claude via de MCP-server aanroept, uitgevoerd in de pagina: daar leeft de actuele agenda, met
// ongedaan maken en tekenen. Elke wijziging gaat via dezelfde store als je eigen acties, met een melding
// "Claude: …" en "Ongedaan maken". Invoer komt van buiten en wordt dus opnieuw gecontroleerd.
import type {
  Calendar,
  CalEvent,
  EventInput,
  EventOcc,
  EventValues,
  Occurrence,
  Repeat,
  RepeatFreq,
  Scope,
} from '../shared/types.ts';
import { findFreeSlots } from './freetime.ts';
import { isDone } from './model.ts';
import { occurrencesBetween } from './occurrences.ts';
import { searchEvents } from './search.ts';
import { calendarOf, data, isReadOnly, writableCalendars } from './state.ts';
import * as store from './store.ts';
import { addDays, diffDays, fromKey, fromMinutes, keyOf, toMinutes } from './util.ts';

const MAX_RANGE_DAYS = 366;

// --- invoer controleren ---

type Args = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function asArgs(raw: unknown): Args {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {};
}

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && keyOf(fromKey(value)) === value;
const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function date(args: Args, key: string, required: true): string;
function date(args: Args, key: string, required?: false): string | undefined;
function date(args: Args, key: string, required = false) {
  const value = args[key];
  if (value === undefined) return required ? fail(`"${key}" ontbreekt (verwacht YYYY-MM-DD).`) : undefined;
  return isDate(value)
    ? value
    : fail(`"${key}" is geen geldige datum (verwacht YYYY-MM-DD, kreeg ${JSON.stringify(value)}).`);
}

function time(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  return isTime(value)
    ? value
    : fail(`"${key}" is geen geldige tijd (verwacht HH:MM, 24 uur, kreeg ${JSON.stringify(value)}).`);
}

function text(args: Args, key: string, max: number, required = false): string | undefined {
  const value = args[key];
  if (value === undefined) return required ? fail(`"${key}" ontbreekt.`) : undefined;
  if (typeof value !== 'string') return fail(`"${key}" moet tekst zijn.`);
  if (value.length > max) return fail(`"${key}" is te lang (maximaal ${max} tekens).`);
  if (required && !value.trim()) return fail(`"${key}" mag niet leeg zijn.`);
  return value;
}

function int(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail(`"${key}" moet een geheel getal zijn tussen ${min} en ${max}.`);
}

function bool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : fail(`"${key}" moet true of false zijn.`);
}

function people(args: Args): string[] | undefined {
  const value = args.invitees;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50 || value.some((v) => typeof v !== 'string' || v.length > 200)) {
    return fail('"invitees" moet een lijst van maximaal 50 teksten zijn.');
  }
  return value.map((v) => v.trim()).filter(Boolean);
}

const FREQUENCIES: Record<string, RepeatFreq> = {
  daily: 'daily',
  weekdays: 'weekdays',
  weekly: 'weekly',
  monthly: 'monthly',
  yearly: 'yearly',
};

function repeatRule(value: unknown): Repeat {
  const rule = asArgs(value);
  const freq = typeof rule.frequency === 'string' ? FREQUENCIES[rule.frequency] : undefined;
  if (!freq) return fail('"repeat.frequency" moet daily, weekdays, weekly, monthly of yearly zijn.');
  const days = rule.weekdays;
  if (days !== undefined && (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    return fail('"repeat.weekdays" moet een lijst van getallen 0-6 zijn (0 = zondag).');
  }
  return {
    freq,
    interval: int(rule, 'interval', 1, 99) ?? 1,
    until: date(rule, 'until') ?? '',
    ...(freq === 'weekly' && Array.isArray(days) && days.length ? { byDay: days as number[] } : {}),
  };
}

// --- agenda's en afspraken zoeken ---

// een agenda aanwijzen met naam of id (hoofdletters maken niet uit; een begin van de naam volstaat als het eenduidig is)
function findCalendar(query: string, pool: Calendar[], what: string): Calendar {
  const q = query.trim().toLowerCase();
  const exact = pool.find((c) => c.id === query || c.name.toLowerCase() === q);
  if (exact) return exact;
  const starts = pool.filter((c) => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return starts[0];
  const names = pool.map((c) => `"${c.name}"`).join(', ');
  return fail(`Geen ${what} gevonden met de naam of id "${query}". Beschikbaar: ${names || '(geen)'}.`);
}

function ownCalendar(query: string | undefined): Calendar {
  const own = writableCalendars();
  if (query === undefined)
    return (
      own.find((c) => c.type === 'user') ?? own[0] ?? fail('Er is geen agenda waarin afspraken kunnen worden gemaakt.')
    );
  const found = findCalendar(query, [...data.calendars], 'agenda');
  if (found.source)
    return fail(
      `Agenda "${found.name}" is een externe, alleen-lezen agenda (${found.source.kind === 'feed' ? 'link' : 'account'}).`,
    );
  if (found.type === 'holidays') return fail(`In "${found.name}" kunnen geen afspraken worden gemaakt.`);
  return found;
}

function eventById(id: unknown): CalEvent {
  if (typeof id !== 'string' || !id) return fail('"id" ontbreekt.');
  return data.events.find((e) => e.id === id) ?? fail(`Geen afspraak gevonden met id "${id}".`);
}

// het voorkomen van een afspraak (bij een herhaling: dat van `baseDate`); wordt tegen de echte voorkomens gecontroleerd
function occurrenceOf(ev: CalEvent, baseDate: string | undefined): EventOcc {
  const target = baseDate ?? ev.date;
  const found = occurrencesBetween(
    // het getoonde voorkomen kan door een tijdzone een dag verschuiven: ruim zoeken
    { ...data, calendars: data.calendars.map((c) => ({ ...c, visible: true })) },
    addDays(target, -1),
    addDays(target, diffDays(ev.date, ev.endDate) + 1),
  ).find((o): o is EventOcc => !o.holiday && o.id === ev.id && o.baseDate === target);
  return (
    found ??
    fail(
      ev.repeat
        ? `De afspraak heeft geen voorkomen op ${target} (occurrence_date is de oorspronkelijke datum).`
        : `Geen voorkomen op ${target}.`,
    )
  );
}

// --- hoe Claude een afspraak ziet ---

function repeatInfo(repeat: Repeat | null) {
  if (!repeat) return null;
  return {
    frequency: repeat.freq,
    interval: repeat.interval,
    until: repeat.until || null,
    ...(repeat.byDay ? { weekdays: repeat.byDay } : {}),
  };
}

function describe(occ: Occurrence) {
  const calendar = calendarOf(occ.calendarId);
  const ev = occ.ev;
  return {
    id: occ.id ?? occ.key,
    occurrence_date: occ.baseDate,
    title: occ.title,
    date: occ.date,
    end_date: occ.endDate,
    start_time: occ.time || null,
    end_time: occ.endTime || null,
    all_day: occ.allDay,
    calendar: calendar?.name ?? null,
    read_only: occ.holiday || Boolean(calendar?.source),
    ...(occ.holiday ? { holiday: true } : {}),
    location: occ.location || null,
    ...(ev
      ? {
          notes: ev.notes || null,
          invitees: ev.invitees,
          alert_minutes_before: ev.alert,
          repeat: repeatInfo(ev.repeat),
          ...(ev.task ? { task: true, done: isDone(ev, occ.baseDate) } : {}),
        }
      : {}),
    recurring: occ.recurring,
  };
}

// een afspraak zoals hij in de agenda staat (voor antwoorden na het maken of wijzigen)
function describeEvent(ev: CalEvent) {
  return describe(occurrenceOf(ev, ev.date));
}

const byTime = (a: Occurrence, b: Occurrence) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);

// --- lezen ---

function getContext() {
  const now = new Date();
  const today = keyOf(now);
  const upcoming = occurrencesBetween(data, today, addDays(today, 14))
    .filter(
      (o) =>
        !o.holiday &&
        (o.endDate > today ||
          o.allDay ||
          o.endTime === '' ||
          o.endTime >= fromMinutes(now.getHours() * 60 + now.getMinutes())),
    )
    .slice(0, 10)
    .map(describe);
  return {
    now: `${today}T${fromMinutes(now.getHours() * 60 + now.getMinutes())}`,
    today,
    weekday: new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    week_starts_on: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      data.settings.weekStart
    ],
    calendars: data.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      visible: c.visible,
      read_only: c.type === 'holidays' || Boolean(c.source),
      source: c.source ? (c.source.kind === 'feed' ? 'link' : 'account') : null,
      event_count: data.events.filter((e) => e.calendarId === c.id).length,
    })),
    total_events: data.events.length,
    upcoming_events: upcoming,
  };
}

function range(args: Args, maxDays = MAX_RANGE_DAYS) {
  const from = date(args, 'from', true);
  const to = date(args, 'to', true);
  if (to < from) fail('"to" ligt voor "from".');
  if (diffDays(from, to) + 1 > maxDays) fail(`Het bereik is te groot (maximaal ${maxDays} dagen).`);
  return { from, to };
}

function listEvents(raw: unknown) {
  const args = asArgs(raw);
  const { from, to } = range(args);
  const limit = int(args, 'limit', 1, 500) ?? 100;
  const calendar = text(args, 'calendar', 200);
  const holidays = bool(args, 'include_holidays') ?? false;
  const only = calendar === undefined ? null : findCalendar(calendar, [...data.calendars], 'agenda').id;
  const all = occurrencesBetween(data, from, to)
    .filter((o) => holidays || !o.holiday)
    .filter((o) => only === null || o.calendarId === only)
    .sort(byTime);
  return { from, to, count: all.length, truncated: all.length > limit, events: all.slice(0, limit).map(describe) };
}

function search(raw: unknown) {
  const args = asArgs(raw);
  const query = text(args, 'query', 200, true)!;
  const limit = int(args, 'limit', 1, 100) ?? 25;
  const from = date(args, 'from');
  const to = date(args, 'to');
  if ((from && !to) || (!from && to)) fail('Geef "from" en "to" samen op, of geen van beide.');
  if (from && to && to < from) fail('"to" ligt voor "from".');
  const today = keyOf(new Date());
  const hits = searchEvents(data, query, today).filter((r) => calendarOf(r.calendar.id)?.visible);
  if (from && to) {
    const ids = new Set(hits.flatMap((r) => (r.ev ? [r.ev.id] : [])));
    const holidays = new Set(hits.filter((r) => !r.ev).map((r) => r.title));
    const found = occurrencesBetween(data, from, to)
      .filter((o) => (o.holiday ? holidays.has(o.title) : ids.has(o.id!)))
      .sort(byTime);
    return { query, count: found.length, truncated: found.length > limit, events: found.slice(0, limit).map(describe) };
  }
  const events = hits.slice(0, limit).map((r) => {
    if (!r.ev) return { title: r.title, date: r.date, calendar: r.calendar.name, holiday: true, read_only: true };
    // zonder bereik: de eerstvolgende (of enige) keer
    const occ = occurrencesBetween(data, r.date, r.date).find((o) => o.id === r.ev!.id);
    return occ ? describe(occ) : describeEvent(r.ev);
  });
  return { query, count: hits.length, truncated: hits.length > limit, events };
}

function getEvent(raw: unknown) {
  const args = asArgs(raw);
  const ev = eventById(args.id);
  return describe(occurrenceOf(ev, date(args, 'occurrence_date')));
}

function freeTime(raw: unknown) {
  const args = asArgs(raw);
  const { from, to } = range(args, 62);
  const duration = int(args, 'duration_minutes', 5, 1440) ?? fail('"duration_minutes" ontbreekt.');
  const dayStart = toMinutes(time(args, 'day_start') ?? '09:00');
  const dayEnd = toMinutes(time(args, 'day_end') ?? '18:00');
  if (dayEnd <= dayStart) fail('"day_end" moet na "day_start" liggen.');
  const limit = int(args, 'limit', 1, 100) ?? 20;
  const weekends = bool(args, 'include_weekends') ?? false;

  const slots = findFreeSlots(data, { from, to, duration, dayStart, dayEnd, weekends, limit }).map((slot) => ({
    date: slot.date,
    start_time: fromMinutes(slot.start),
    end_time: fromMinutes(slot.end),
    minutes: slot.end - slot.start,
  }));
  return {
    duration_minutes: duration,
    window: `${fromMinutes(dayStart)}-${fromMinutes(dayEnd)}`,
    count: slots.length,
    slots,
  };
}

// --- schrijven ---

// De start- en eindtijd van een afspraak uit de invoer: zonder starttijd duurt hij de hele dag, zonder eindtijd een uur.
function schedule(startDate: string, endDate: string, start: string | undefined, end: string | undefined) {
  if (endDate < startDate) fail('"end_date" ligt voor "date".');
  if (!start) {
    if (end) fail('"end_time" kan niet zonder "start_time" (een afspraak zonder tijd duurt de hele dag).');
    return { time: '', endTime: '' };
  }
  const endTime = end ?? fromMinutes(Math.min(toMinutes(start) + 60, 24 * 60 - 1));
  if (endDate === startDate && toMinutes(endTime) <= toMinutes(start)) fail('"end_time" moet na "start_time" liggen.');
  return { time: start, endTime };
}

function newEvent(raw: unknown): EventInput {
  const args = asArgs(raw);
  const title = text(args, 'title', 500, true)!;
  const startDate = date(args, 'date', true);
  const endDate = date(args, 'end_date') ?? startDate;
  const alert = int(args, 'alert_minutes_before', 0, 40_320);
  return {
    title: title.trim(),
    calendarId: ownCalendar(text(args, 'calendar', 200)).id,
    date: startDate,
    endDate,
    ...schedule(startDate, endDate, time(args, 'start_time'), time(args, 'end_time')),
    location: text(args, 'location', 500) ?? '',
    notes: text(args, 'notes', 10_000) ?? '',
    invitees: people(args) ?? [],
    repeat: args.repeat === undefined || args.repeat === null ? null : repeatRule(args.repeat),
    alert: alert ?? null,
    task: bool(args, 'task') ?? false,
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function createEvents(raw: unknown) {
  const list = asArgs(raw).events;
  if (!Array.isArray(list) || !list.length) fail('"events" moet een lijst met minstens één afspraak zijn.');
  if (list.length > 50) fail('Maak maximaal 50 afspraken tegelijk.');
  // alles eerst controleren: één foute afspraak betekent dat er niets wordt gemaakt
  const inputs = list.map((item, i) => {
    try {
      return newEvent(item);
    } catch (error) {
      return fail(`Afspraak ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const label = `Claude: ${inputs.length} ${plural(inputs.length, 'afspraak toegevoegd', 'afspraken toegevoegd')}`;
  const created = store.addEvents(inputs, label);
  return { created: created.length, events: created.map(describeEvent) };
}

function scopeOf(args: Args, ev: CalEvent): Scope {
  const value = args.scope;
  if (value !== undefined && value !== 'all' && value !== 'only' && value !== 'following') {
    return fail('"scope" moet all, only of following zijn.');
  }
  const scope = (value as Scope | undefined) ?? 'all';
  if (scope !== 'all' && !ev.repeat) return 'all'; // een losse afspraak heeft maar één voorkomen
  if (scope !== 'all' && !args.occurrence_date) fail(`Bij scope "${scope}" is "occurrence_date" nodig.`);
  return scope;
}

function writableEvent(args: Args) {
  const ev = eventById(args.id);
  const calendar = calendarOf(ev.calendarId);
  if (isReadOnly(ev.calendarId))
    fail(`"${ev.title}" staat in de alleen-lezen agenda "${calendar?.name}" en kan niet worden aangepast.`);
  return ev;
}

function updateEvent(raw: unknown) {
  const args = asArgs(raw);
  const ev = writableEvent(args);
  const scope = scopeOf(args, ev);
  const occ = occurrenceOf(ev, date(args, 'occurrence_date'));
  const values: EventValues = store.moveValues(occ);

  const title = text(args, 'title', 500);
  if (title !== undefined) values.title = title.trim() || fail('"title" mag niet leeg zijn.');
  const newDate = date(args, 'date');
  const newEnd = date(args, 'end_date');
  const span = diffDays(values.date, values.endDate);
  if (newDate) {
    values.date = newDate;
    values.endDate = newEnd ?? addDays(newDate, span); // zonder einddatum blijft de lengte gelijk
  } else if (newEnd) values.endDate = newEnd;

  const allDay = bool(args, 'all_day');
  const start = time(args, 'start_time');
  const end = time(args, 'end_time');
  if (allDay) {
    if (start || end) fail('"all_day" en een tijd samen kan niet.');
    values.time = '';
    values.endTime = '';
  } else if (start || end) {
    const wasTimed = Boolean(values.time);
    const length =
      wasTimed && values.endTime && values.endDate === values.date
        ? toMinutes(values.endTime) - toMinutes(values.time)
        : 60;
    const from = start ?? (values.time || fail('Een afspraak zonder tijd heeft eerst een "start_time" nodig.'));
    // alleen een nieuwe starttijd: de lengte blijft gelijk
    const until = end ?? fromMinutes(Math.min(toMinutes(from) + Math.max(length, 5), 24 * 60 - 1));
    values.time = from;
    values.endTime = until;
  }
  const checked = schedule(values.date, values.endDate, values.time || undefined, values.endTime || undefined);
  values.time = checked.time;
  values.endTime = checked.endTime;

  const calendar = text(args, 'calendar', 200);
  if (calendar !== undefined) {
    if (scope !== 'all') fail('De agenda kan alleen voor de hele reeks worden gewijzigd (scope "all").');
    values.calendarId = ownCalendar(calendar).id;
  }
  const location = text(args, 'location', 500);
  if (location !== undefined) values.location = location;
  const notes = text(args, 'notes', 10_000);
  if (notes !== undefined) values.notes = notes;
  const invitees = people(args);
  if (invitees) values.invitees = invitees;
  if (args.repeat === null) values.repeat = null;
  else if (args.repeat !== undefined) values.repeat = repeatRule(args.repeat);
  if (args.alert_minutes_before !== undefined) values.alert = int(args, 'alert_minutes_before', 0, 40_320) ?? null;
  const task = bool(args, 'task');
  if (task !== undefined) values.task = task;
  const done = bool(args, 'done');
  if (done !== undefined && !(task ?? ev.task)) fail('"done" kan alleen bij een taak.');

  // alleen afvinken of heropenen: één stap zonder de afspraak zelf te herschrijven
  if (done !== undefined && Object.keys(args).every((k) => ['id', 'occurrence_date', 'scope', 'done'].includes(k))) {
    store.setTaskDone(occ, done, `Claude: ${ev.title} ${done ? 'afgevinkt' : 'heropend'}`);
    return { updated: true, scope, event: describeEvent(ev) };
  }

  const before = new Set(data.events.map((e) => e.id));
  store.editOccurrence(occ, scope, values, `Claude: ${values.title} gewijzigd`);
  // bij "alleen deze" of "volgende" ontstaat een nieuwe afspraak: dat is degene die Claude nu bedoelt
  const updated = data.events.find((e) => !before.has(e.id)) ?? data.events.find((e) => e.id === ev.id);
  if (done !== undefined && updated) {
    const fresh = occurrenceOf(updated, updated.id === ev.id ? occ.baseDate : updated.date);
    store.setTaskDone(fresh, done, `Claude: ${updated.title} ${done ? 'afgevinkt' : 'heropend'}`);
  }
  return { updated: true, scope, event: updated ? describeEvent(updated) : null };
}

function deleteEvent(raw: unknown) {
  const args = asArgs(raw);
  const ev = writableEvent(args);
  const scope = scopeOf(args, ev);
  const occ = occurrenceOf(ev, date(args, 'occurrence_date'));
  store.deleteOccurrences([occ], scope, `Claude: ${ev.title} verwijderd`);
  return { deleted: true, scope, title: ev.title };
}

const TOOLS: Record<string, (args: unknown) => unknown> = {
  get_context: getContext,
  list_events: listEvents,
  search_events: search,
  get_event: getEvent,
  find_free_time: freeTime,
  create_events: createEvents,
  update_event: updateEvent,
  delete_event: deleteEvent,
};

export async function handleMcpCall(tool: string, args: unknown): Promise<unknown> {
  // eigen sleutels only: "__proto__" of "toString" is geen tool
  if (!Object.hasOwn(TOOLS, tool)) fail(`Onbekende tool: ${tool}.`);
  return TOOLS[tool](args);
}

// de pagina luistert naar verzoeken van de MCP-server en meldt aan main dat hij klaar is
export function initMcp() {
  window.agenda.onMcpCall(async ({ id, tool, args }) => {
    try {
      window.agenda.mcpReply(id, { ok: true, result: await handleMcpCall(tool, args) });
    } catch (error) {
      window.agenda.mcpReply(id, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  window.agenda.mcpReady();
}
