// datamodel en bewerkingen op herhalende afspraken; geen DOM, zodat het te testen is
import type {
  AgendaData,
  Calendar,
  CalendarInput,
  CalendarSource,
  CalEvent,
  ColorName,
  EventInput,
  EventTemplate,
  EventValues,
  GeoPlace,
  Scope,
  Settings,
} from '../shared/types.ts';
import { addDays, diffDays } from './util.ts';
import { validZone } from './zones.ts';

export const COLOR_NAMES: ColorName[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'gray'];

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 1,
  clock24: true,
  weekNumbers: false,
  defaultAlert: null,
  refreshMinutes: 30,
  templates: [],
  tray: false,
  weather: null,
  clocks: [],
  shortcut: '',
};

// het interval moet een heel aantal minuten zijn (0 = uit, hooguit een dag); alles anders valt terug op de standaard
const validRefresh = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24 * 60;

export const defaultCalendars = (): Calendar[] => [
  { id: 'home', name: 'Privé', color: 'blue', visible: true, type: 'user' },
  { id: 'work', name: 'Werk', color: 'orange', visible: true, type: 'user' },
  { id: 'birthdays', name: 'Verjaardagen', color: 'purple', visible: true, type: 'birthdays' },
  { id: 'holidays', name: 'Feestdagen NL', color: 'green', visible: true, type: 'holidays' },
];

function validSource(source: unknown): source is CalendarSource {
  if (!source || typeof source !== 'object') return false;
  const s = source as Record<string, unknown>;
  if (s.kind === 'feed') return typeof s.url === 'string' && s.url !== '';
  if (s.kind === 'caldav') return typeof s.accountId === 'string' && typeof s.calendarUrl === 'string';
  return false;
}

export function normalizeCalendar(c: CalendarInput): Calendar {
  return {
    id: c.id ?? crypto.randomUUID(),
    name: String(c.name ?? 'Agenda'),
    color: c.color && COLOR_NAMES.includes(c.color) ? c.color : 'blue',
    visible: c.visible !== false,
    type: c.type === 'birthdays' || c.type === 'holidays' ? c.type : 'user',
    ...(validSource(c.source) && { source: c.source }),
    ...(typeof c.syncedAt === 'number' && { syncedAt: c.syncedAt }),
    ...(typeof c.syncError === 'string' && c.syncError && { syncError: c.syncError }),
  };
}

// weekdagen als gesorteerde, unieke getallen 0-6; undefined als er niets bruikbaars is
function cleanDays(days: unknown): number[] | undefined {
  if (!Array.isArray(days)) return undefined;
  const valid = [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return valid.length ? valid : undefined;
}

// een bewaarde plaats voor het weer; onbruikbare waarden worden genegeerd
function validPlace(place: unknown): place is GeoPlace {
  if (!place || typeof place !== 'object') return false;
  const p = place as Record<string, unknown>;
  return (
    typeof p.city === 'string' &&
    p.city !== '' &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}

const MAX_TEMPLATES = 50;

// een sjabloon uit het bestand; onbruikbare worden overgeslagen (null)
export function normalizeTemplate(raw: unknown): EventTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const name = typeof t.name === 'string' ? t.name.trim().slice(0, 100) : '';
  if (!name || typeof t.id !== 'string' || !t.id) return null;
  const time = typeof t.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : '';
  const duration =
    typeof t.duration === 'number' && Number.isInteger(t.duration) && t.duration >= 5 && t.duration <= 1439
      ? t.duration
      : 60;
  // hergebruik de afspraak-normalisatie voor herhaling, meldingen, genodigden en de rest
  const ev = normalizeEvent({
    date: '2000-01-01',
    time,
    endTime: time ? '23:59' : '',
    title: typeof t.title === 'string' ? t.title : name,
    calendarId: typeof t.calendarId === 'string' ? t.calendarId : undefined,
    location: typeof t.location === 'string' ? t.location : '',
    notes: typeof t.notes === 'string' ? t.notes : '',
    invitees: Array.isArray(t.invitees) ? t.invitees.filter((i): i is string => typeof i === 'string') : [],
    alert: typeof t.alert === 'number' && Number.isFinite(t.alert) && t.alert >= 0 ? t.alert : null,
    travel: t.travel as number,
    repeat: t.repeat as EventInput['repeat'],
  });
  return {
    id: t.id,
    name,
    title: ev.title,
    calendarId: ev.calendarId,
    location: ev.location,
    notes: ev.notes,
    invitees: ev.invitees,
    time: ev.time,
    duration: ev.time ? duration : 0,
    alert: ev.alert,
    travel: ev.travel,
    repeat: ev.repeat,
  };
}

const normalizeTemplates = (raw: unknown): EventTemplate[] =>
  Array.isArray(raw)
    ? raw
        .map(normalizeTemplate)
        .filter((t): t is EventTemplate => t !== null)
        .slice(0, MAX_TEMPLATES)
    : [];

export function normalizeEvent(e: EventInput, fallbackCalendarId = 'home'): CalEvent {
  const date = e.date;
  const repeat = e.repeat?.freq
    ? {
        freq: e.repeat.freq,
        interval: Math.max(1, Number(e.repeat.interval) || 1),
        until: e.repeat.until || '',
        ...(e.repeat.freq === 'weekly' && cleanDays(e.repeat.byDay) && { byDay: cleanDays(e.repeat.byDay) }),
      }
    : null;
  return {
    id: e.id ?? crypto.randomUUID(),
    calendarId: e.calendarId ?? fallbackCalendarId,
    title: String(e.title ?? ''),
    date,
    endDate: e.endDate && e.endDate >= date ? e.endDate : date,
    time: e.time || '',
    endTime: e.time ? e.endTime || '' : '',
    location: e.location ?? '',
    url: e.url ?? '',
    notes: e.notes ?? '',
    repeat,
    alert: typeof e.alert === 'number' && Number.isFinite(e.alert) ? e.alert : null,
    travel: e.time ? Number(e.travel) || 0 : 0,
    invitees: Array.isArray(e.invitees) ? e.invitees.map(String) : [],
    tz: e.time ? e.tz || '' : '',
    exceptions: Array.isArray(e.exceptions) ? e.exceptions : [],
    task: e.task === true,
    // alleen bij een taak, en alleen echte data
    doneOn:
      e.task === true && Array.isArray(e.doneOn)
        ? [
            ...new Set(e.doneOn.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))),
          ].sort()
        : [],
  };
}

// is deze taak (voor dit voorkomen) afgevinkt?
export const isDone = (ev: Pick<CalEvent, 'task' | 'doneOn'>, baseDate: string) =>
  ev.task && ev.doneOn.includes(baseDate);

interface RawData {
  calendars?: CalendarInput[];
  events?: EventInput[];
  settings?: Partial<Settings>;
}

// accepteert het oude formaat (een array met afspraken) en het nieuwe ({ calendars, events, settings })
export function migrate(raw: unknown): AgendaData {
  const base: RawData = Array.isArray(raw) ? { events: raw } : raw && typeof raw === 'object' ? raw : {};
  const calendars =
    Array.isArray(base.calendars) && base.calendars.length ? base.calendars.map(normalizeCalendar) : defaultCalendars();
  for (const type of ['birthdays', 'holidays']) {
    if (!calendars.some((c) => c.type === type)) {
      calendars.push(defaultCalendars().find((c) => c.type === type)!);
    }
  }
  const users = calendars.filter((c) => c.type === 'user');
  const home = (users[0] ?? calendars[0]).id;
  const events = (Array.isArray(base.events) ? base.events : [])
    .filter((e) => e && typeof e.date === 'string')
    .map((e) => {
      // oude afspraken hadden alleen een kleur: koppel ze aan een agenda met dezelfde kleur
      const calendarId = e.calendarId ?? users.find((c) => c.color === e.color)?.id ?? home;
      return normalizeEvent({ ...e, calendarId }, home);
    });
  return {
    version: 2,
    calendars,
    events,
    settings: {
      ...DEFAULT_SETTINGS,
      ...base.settings,
      refreshMinutes: validRefresh(base.settings?.refreshMinutes)
        ? base.settings.refreshMinutes
        : DEFAULT_SETTINGS.refreshMinutes,
      templates: normalizeTemplates(base.settings?.templates),
      tray: base.settings?.tray === true,
      weather: validPlace(base.settings?.weather)
        ? {
            city: base.settings.weather.city.slice(0, 120),
            lat: base.settings.weather.lat,
            lon: base.settings.weather.lon,
          }
        : null,
      clocks: Array.isArray(base.settings?.clocks)
        ? [...new Set(base.settings.clocks.filter(validZone))].slice(0, 2)
        : [],
      shortcut:
        typeof base.settings?.shortcut === 'string' && base.settings.shortcut.length <= 60
          ? base.settings.shortcut
          : '',
    },
  };
}

// --- bewerken en verwijderen met bereik: 'only' | 'following' | 'all' ---

export function applyEdit(
  events: CalEvent[],
  ev: CalEvent,
  baseDate: string,
  scope: Scope,
  values: EventValues,
  newId: string = crypto.randomUUID(),
): CalEvent[] {
  const recurring = Boolean(ev.repeat);
  if (!recurring || scope === 'all' || (scope === 'following' && baseDate === ev.date)) {
    const span = diffDays(values.date, values.endDate ?? values.date);
    const date = recurring ? addDays(ev.date, diffDays(baseDate, values.date)) : values.date;
    const updated = normalizeEvent({
      ...ev,
      ...values,
      date,
      endDate: addDays(date, span),
      id: ev.id,
      exceptions: ev.exceptions,
    });
    return events.map((e) => (e.id === ev.id ? updated : e));
  }
  if (scope === 'only') {
    // een afgevinkt voorkomen blijft afgevinkt, ook als het een eigen afspraak wordt
    const doneOn = ev.doneOn.includes(baseDate) ? [values.date] : [];
    const single = normalizeEvent({ ...ev, ...values, id: newId, repeat: null, exceptions: [], doneOn });
    return [...events.map((e) => (e.id === ev.id ? { ...ev, exceptions: [...ev.exceptions, baseDate] } : e)), single];
  }
  const ended: CalEvent = {
    ...ev,
    repeat: { ...ev.repeat!, until: addDays(baseDate, -1) },
    exceptions: ev.exceptions.filter((d) => d < baseDate),
  };
  const created = normalizeEvent({
    ...ev,
    ...values,
    id: newId,
    exceptions: ev.exceptions.filter((d) => d >= baseDate),
  });
  return [...events.map((e) => (e.id === ev.id ? ended : e)), created];
}

export function applyDelete(events: CalEvent[], ev: CalEvent, baseDate: string, scope: Scope): CalEvent[] {
  if (!ev.repeat || scope === 'all' || (scope === 'following' && baseDate === ev.date)) {
    return events.filter((e) => e.id !== ev.id);
  }
  return events.map((e) => {
    if (e.id !== ev.id) return e;
    if (scope === 'only') return { ...e, exceptions: [...e.exceptions, baseDate] };
    return { ...e, repeat: { ...e.repeat!, until: addDays(baseDate, -1) } };
  });
}
