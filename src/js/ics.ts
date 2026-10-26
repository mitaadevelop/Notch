// import en export in iCalendar (.ics) formaat
import type { CalEvent, Repeat, RepeatFreq } from '../shared/types.ts';
import { addDays, fromMinutes, keyOf } from './util.ts';
import { normalizeEvent } from './model.ts';
import { baseDates } from './occurrences.ts';
import { ALL_DAY_ALERT_HOUR } from './alerts.ts';

const compactDate = (key: string) => key.replaceAll('-', '');
const compactDateTime = (date: string, time: string) => `${compactDate(date)}T${time.replace(':', '')}00`;
const escapeText = (s: string) =>
  String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, ';');
const unescapeText = (s: string) =>
  s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/;/g, ';').replace(/\\\\/g, '\\');
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];
// index = dag van de week zoals JavaScript die telt (0 = zondag)
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function fold(line: string) {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join('\r\n ');
}

export function toICS(calendarName: string, events: CalEvent[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agenda//NL',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const ev of events) {
    const tzParam = ev.tz ? `;TZID=${ev.tz}` : '';
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@agenda`, `DTSTAMP:${stamp}`);
    if (ev.time) {
      lines.push(`DTSTART${tzParam}:${compactDateTime(ev.date, ev.time)}`);
      if (ev.endTime) lines.push(`DTEND${tzParam}:${compactDateTime(ev.endDate, ev.endTime)}`);
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(ev.date)}`,
        `DTEND;VALUE=DATE:${compactDate(addDays(ev.endDate, 1))}`,
      );
    }
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    if (ev.notes) lines.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    if (ev.repeat) {
      const { freq, interval, until, byDay } = ev.repeat;
      let rule =
        freq === 'weekdays' ? `FREQ=WEEKLY;BYDAY=${DAYS.join(',')}` : `FREQ=${freq.toUpperCase()};INTERVAL=${interval}`;
      if (freq === 'weekly' && byDay?.length) rule += `;BYDAY=${byDay.map((d) => WEEKDAY_CODES[d]).join(',')}`;
      if (until) rule += `;UNTIL=${compactDate(until)}`;
      lines.push(`RRULE:${rule}`);
    }
    for (const d of ev.exceptions) {
      lines.push(ev.time ? `EXDATE${tzParam}:${compactDateTime(d, ev.time)}` : `EXDATE;VALUE=DATE:${compactDate(d)}`);
    }
    for (const person of ev.invitees) {
      const mail = person.includes('@') ? person : `${person.replace(/\s+/g, '.').toLowerCase()}@example.invalid`;
      lines.push(`ATTENDEE;CN=${escapeText(person)}:mailto:${mail}`);
    }
    if (ev.travel) lines.push(`X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT${ev.travel}M`);
    if (ev.alert !== null && Number.isFinite(ev.alert)) {
      const trigger = ev.time ? -ev.alert : ALL_DAY_ALERT_HOUR * 60 - ev.alert;
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(ev.title)}`,
        `TRIGGER:${trigger < 0 ? '-' : ''}PT${Math.abs(trigger)}M`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// --- import ---

const LINE = /^([^:;]+)((?:;[^:=;]+=(?:"[^"]*"|[^:;]*))*):(.*)$/;
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function isZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProps(text: string) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const props: Prop[] = [];
  for (const raw of unfolded.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const p of m[2].split(';').filter(Boolean)) {
      const [k, ...v] = p.split('=');
      params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, '');
    }
    props.push({ name: m[1].toUpperCase(), params, value: m[3] });
  }
  return props;
}

// '20261025', '20261025T140000' of '20261025T120000Z' -> { date, time, tz }
interface DateValue {
  date: string;
  time: string;
  tz: string;
}

function parseDateValue(value: string, params: Record<string, string>): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { date, time: '', tz: '' };
  if (m[7]) {
    const local = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: keyOf(local), time: fromMinutes(local.getHours() * 60 + local.getMinutes()), tz: '' };
  }
  const tzid = params.TZID;
  const tz = tzid && isZone(tzid) && tzid !== localZone() ? tzid : '';
  return { date, time: `${m[4]}:${m[5]}`, tz };
}

function triggerMinutes(value: string) {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const total = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0);
  return m[1] ? -total : total;
}

function parseRule(value: string, date: string): Repeat | null {
  const rule = Object.fromEntries(value.split(';').map((p) => p.split('=') as [string, string]));
  const freqs: Record<string, RepeatFreq> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  let freq = freqs[rule.FREQ];
  if (!freq) return null;
  const interval = Number(rule.INTERVAL) || 1;
  let until = '';
  if (rule.UNTIL) until = parseDateValue(rule.UNTIL, {})?.date ?? '';

  const byDays = (rule.BYDAY ?? '').split(',').filter(Boolean);
  let byDay: number[] | undefined;
  if (freq === 'weekly' && byDays.length === 5 && DAYS.every((d) => byDays.includes(d))) {
    freq = 'weekdays';
  } else if (freq === 'weekly' && byDays.length) {
    // alleen gewone weekdagen (MO, WE); "1MO" e.d. hoort bij maandelijks en wordt hier niet ondersteund
    const days = byDays.map((d) => WEEKDAY_CODES.indexOf(d)).filter((d) => d >= 0);
    if (days.length) byDay = days;
  }

  const repeat: Repeat = { freq, interval: freq === 'weekdays' ? 1 : interval, until, ...(byDay && { byDay }) };
  if (rule.COUNT && Number(rule.COUNT) > 0) {
    // COUNT omzetten naar een einddatum door de herhaling echt af te lopen
    const probe = normalizeEvent({ date, repeat: { ...repeat, until: '' } });
    let n = 0;
    for (const d of baseDates(probe, date, addDays(date, 365 * 30))) {
      until = d;
      if (++n >= Number(rule.COUNT)) break;
    }
    repeat.until = until;
  }
  return repeat;
}

// afspraak in opbouw tijdens het inlezen
interface Draft {
  start?: DateValue | null;
  end?: DateValue | null;
  title?: string;
  location?: string;
  notes?: string;
  url?: string;
  rrule?: string;
  uid?: string;
  recurrenceId?: DateValue | null;
  trigger?: number | null;
  travel?: number;
  invitees: string[];
  exceptions: (string | undefined)[];
}

export function parseICS(text: string) {
  const props = parseProps(text);
  const name = props.find((p) => p.name === 'X-WR-CALNAME');
  const events: CalEvent[] = [];
  let cur: Draft | null = null;
  let inAlarm = false;
  const overrides: { uid: string; date: string }[] = [];

  for (const { name: key, params, value } of props) {
    if (key === 'BEGIN' && value === 'VEVENT') {
      cur = { invitees: [], exceptions: [] };
    } else if (key === 'BEGIN' && value === 'VALARM') {
      inAlarm = true;
    } else if (key === 'END' && value === 'VALARM') {
      inAlarm = false;
    } else if (key === 'END' && value === 'VEVENT') {
      if (cur?.start) {
        const event = finishEvent(cur, cur.start);
        // stabiele id uit de UID, zodat een volgende synchronisatie dezelfde afspraak herkent
        if (cur.uid) event.id = cur.recurrenceId ? `${cur.uid}@${cur.recurrenceId.date}` : cur.uid;
        events.push(event);
        if (cur.recurrenceId && cur.uid) overrides.push({ uid: cur.uid, date: cur.recurrenceId.date });
      }
      cur = null;
    } else if (cur && inAlarm) {
      if (key === 'TRIGGER' && cur.trigger === undefined) cur.trigger = triggerMinutes(value);
    } else if (cur) {
      if (key === 'DTSTART') cur.start = parseDateValue(value, params);
      else if (key === 'DTEND') cur.end = parseDateValue(value, params);
      else if (key === 'SUMMARY') cur.title = unescapeText(value);
      else if (key === 'LOCATION') cur.location = unescapeText(value);
      else if (key === 'DESCRIPTION') cur.notes = unescapeText(value);
      else if (key === 'URL') cur.url = value;
      else if (key === 'RRULE') cur.rrule = value;
      else if (key === 'UID') cur.uid = value;
      else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseDateValue(value, params);
      else if (key === 'EXDATE') for (const v of value.split(',')) cur.exceptions.push(parseDateValue(v, params)?.date);
      else if (key === 'ATTENDEE')
        cur.invitees.push(params.CN ? unescapeText(params.CN) : value.replace(/^mailto:/i, ''));
      else if (key === 'X-APPLE-TRAVEL-DURATION') cur.travel = Math.max(0, triggerMinutes(value) ?? 0);
    }
  }
  // een aangepast voorkomen (RECURRENCE-ID) vervangt dat voorkomen in de reeks: zet het oorspronkelijke op "overslaan"
  for (const { uid, date } of overrides) {
    const master = events.find((e) => e.id === uid && e.repeat);
    if (master && !master.exceptions.includes(date)) master.exceptions.push(date);
  }
  return { name: name ? unescapeText(name.value) : '', events };
}

function finishEvent(c: Draft, start: DateValue): CalEvent {
  const { end } = c;
  const allDay = !start.time;
  let endDate = start.date;
  let endTime = '';
  if (allDay) {
    if (end?.date) endDate = addDays(end.date, -1);
  } else if (end?.time) {
    endDate = end.date;
    endTime = end.time;
  }
  if (endDate < start.date) endDate = start.date;

  let alert: number | null = null;
  if (c.trigger !== undefined && c.trigger !== null) {
    alert = allDay ? ALL_DAY_ALERT_HOUR * 60 - c.trigger : -c.trigger;
    if (alert < 0) alert = null;
  }

  return normalizeEvent({
    title: c.title ?? '',
    date: start.date,
    endDate,
    time: start.time,
    endTime,
    tz: start.tz,
    location: c.location,
    notes: c.notes,
    url: c.url,
    repeat: c.rrule ? parseRule(c.rrule, start.date) : null,
    exceptions: c.exceptions.filter((d): d is string => Boolean(d)),
    invitees: c.invitees,
    travel: c.travel,
    alert,
  });
}
