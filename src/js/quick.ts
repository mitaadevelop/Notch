// "Lunch met Sam morgen 12:30" -> afspraak. Nederlandse invoer in gewone taal.
import type { Quick, RepeatFreq } from '../shared/types.ts';
import { addDays, addMonths, fromMinutes, keyOf, makeKey, pad, toMinutes } from './util.ts';

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
];
const MONTH_ABBR = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// haalt de eerste treffer uit de tekst en geeft die en de rest terug
function take(text: string, regex: RegExp): [RegExpExecArray | null, string] {
  const m = regex.exec(text);
  if (!m) return [null, text];
  return [m, (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ')];
}

function monthIndex(name: string) {
  const lower = name.toLowerCase();
  const i = MONTHS.indexOf(lower);
  return i !== -1 ? i : MONTH_ABBR.indexOf(lower.replace(/\.$/, ''));
}

const nextWeekday = (from: Date, dow: number, forceNext: boolean) => {
  const today = new Date(from).getDay();
  let diff = (dow - today + 7) % 7;
  if (diff === 0 && forceNext) diff = 7;
  return diff;
};

export function parseQuick(input: string, now = new Date()): Quick {
  const today = keyOf(now);
  let text = ` ${input.trim()} `;
  let m: RegExpExecArray | null;
  const out: Quick = {
    title: '',
    date: '',
    time: '',
    endTime: '',
    allDay: false,
    repeat: null,
    location: '',
    calendarName: '',
    dateFound: false,
  };

  // #agenda en @locatie
  [m, text] = take(text, /\s#(\S+)/);
  if (m) out.calendarName = m[1];
  [m, text] = take(text, /\s@(?:"([^"]+)"|(\S+))/);
  if (m) out.location = m[1] ?? m[2];

  // herhalen
  const weekdayNames = WEEKDAYS.join('|');
  [m, text] = take(text, new RegExp(`\\selke (${weekdayNames})\\b`, 'i'));
  if (m) {
    out.repeat = { freq: 'weekly', interval: 1, until: '' };
    out.date = addDays(today, nextWeekday(now, WEEKDAYS.indexOf(m[1].toLowerCase()), false));
    out.dateFound = true;
  } else {
    const rules: [RegExp, { freq: RepeatFreq; interval: number }][] = [
      [/\s(?:elke dag|dagelijks)\b/i, { freq: 'daily', interval: 1 }],
      [/\s(?:elke werkdag|op werkdagen)\b/i, { freq: 'weekdays', interval: 1 }],
      [/\s(?:om de week|tweewekelijks)\b/i, { freq: 'weekly', interval: 2 }],
      [/\s(?:elke week|wekelijks)\b/i, { freq: 'weekly', interval: 1 }],
      [/\s(?:elke maand|maandelijks)\b/i, { freq: 'monthly', interval: 1 }],
      [/\s(?:elk jaar|jaarlijks)\b/i, { freq: 'yearly', interval: 1 }],
    ];
    for (const [regex, rule] of rules) {
      [m, text] = take(text, regex);
      if (m) {
        out.repeat = { ...rule, until: '' };
        break;
      }
    }
  }

  [m, text] = take(text, /\shele dag\b/i);
  if (m) out.allDay = true;

  // datum
  if (!out.date) {
    const dateRules: [RegExp, (r: RegExpExecArray) => string][] = [
      [
        /\s(vandaag|morgen|overmorgen|gisteren)\b/i,
        (r) =>
          addDays(
            today,
            ({ vandaag: 0, morgen: 1, overmorgen: 2, gisteren: -1 } as Record<string, number>)[r[1].toLowerCase()],
          ),
      ],
      [
        /\sover (\d+) (dagen?|weken?|maanden?)\b/i,
        (r) => {
          const n = Number(r[1]);
          const unit = r[2].toLowerCase();
          if (unit.startsWith('dag')) return addDays(today, n);
          if (unit.startsWith('wek')) return addDays(today, n * 7);
          return addMonths(today, n);
        },
      ],
      [
        new RegExp(`\\s(?:(volgende|aanstaande)\\s+)?(${weekdayNames})\\b`, 'i'),
        (r) => addDays(today, nextWeekday(now, WEEKDAYS.indexOf(r[2].toLowerCase()), Boolean(r[1]))),
      ],
      [
        new RegExp(`\\s(\\d{1,2})\\s+(${MONTHS.join('|')}|${MONTH_ABBR.join('|')})\\.?(?:\\s+(\\d{4}))?\\b`, 'i'),
        (r) => {
          const month = monthIndex(r[2]);
          const year = r[3] ? Number(r[3]) : now.getFullYear();
          let key = makeKey(year, month, Number(r[1]));
          if (!r[3] && key < today) key = makeKey(year + 1, month, Number(r[1]));
          return key;
        },
      ],
      [
        /\s(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/,
        (r) => {
          let year = r[3] ? Number(r[3]) : now.getFullYear();
          if (year < 100) year += 2000;
          let key = makeKey(year, Number(r[2]) - 1, Number(r[1]));
          if (!r[3] && key < today) key = makeKey(year + 1, Number(r[2]) - 1, Number(r[1]));
          return key;
        },
      ],
    ];
    for (const [regex, compute] of dateRules) {
      [m, text] = take(text, regex);
      if (m) {
        out.date = compute(m);
        out.dateFound = true;
        break;
      }
    }
  }

  // tijd: bereik, anders één tijd
  const toTime = (h: string, min = '00', suffix = '') => {
    let hours = Number(h);
    const s = suffix.toLowerCase();
    if (s === 'pm' && hours < 12) hours += 12;
    if (s === 'am' && hours === 12) hours = 0;
    return hours > 23 || Number(min) > 59 ? '' : `${pad(hours)}:${pad(Number(min))}`;
  };
  [m, text] = take(
    text,
    /\s(?:van\s+)?(\d{1,2})(?:[:.](\d{2})|\s*u(?:ur)?)?\s*(?:-|tot|t\/m)\s*(\d{1,2})(?:[:.](\d{2})|\s*u(?:ur)?)?(?=\s)/i,
  );
  if (m) {
    out.time = toTime(m[1], m[2]);
    out.endTime = toTime(m[3], m[4]);
  } else {
    [m, text] = take(text, /\s(?:om\s+|vanaf\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i);
    if (m) out.time = toTime(m[1], m[2], m[3]);
    else {
      [m, text] = take(text, /\s(?:om\s+|vanaf\s+)?(\d{1,2})[:.](\d{2})(?=\s)/i);
      if (m) out.time = toTime(m[1], m[2]);
      else {
        [m, text] = take(text, /\s(?:om\s+)(\d{1,2})(?:\s*uur|u)?(?=\s)/i);
        if (!m) [m, text] = take(text, /\s(\d{1,2})\s*u(?:ur)?(?=\s)(?!\s*(?:lang|durend))/i);
        if (m) out.time = toTime(m[1]);
      }
    }
  }

  // duur
  [m, text] = take(text, /\s(?:voor\s+)?(anderhalf|een half|\d+(?:[.,]\d+)?)\s*(uur|u|min|minuten)(?=\s)/i);
  if (m && out.time && !out.endTime) {
    const n = /anderhalf/i.test(m[1]) ? 1.5 : /een half/i.test(m[1]) ? 0.5 : Number(m[1].replace(',', '.'));
    const minutes = /^(uur|u)$/i.test(m[2]) ? n * 60 : n;
    out.endTime = fromMinutes(Math.min(toMinutes(out.time) + Math.round(minutes), 24 * 60 - 1));
  }

  if (out.time && !out.endTime) out.endTime = fromMinutes(Math.min(toMinutes(out.time) + 60, 24 * 60 - 1));
  if (!out.date) out.date = today;
  if (!out.time) out.allDay = true;
  if (out.allDay) {
    out.time = '';
    out.endTime = '';
  }

  out.title = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:^|\s)(?:om|op|van|tot|voor|vanaf|in|bij)$/i, '')
    .trim();
  return out;
}
