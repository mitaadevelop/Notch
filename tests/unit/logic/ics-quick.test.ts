import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { EventInput } from '../../../src/shared/types.ts';
import { parseICS, toICS } from '../../../src/js/ics.ts';
import { normalizeEvent } from '../../../src/js/model.ts';
import { parseQuick } from '../../../src/js/quick.ts';

const ev = (o: EventInput) => normalizeEvent({ id: 'a', title: 'T', ...o });

test('ics: heen en terug met herhaling, melding, genodigden en reistijd', () => {
  const events = [
    ev({
      title: 'Overleg, met "komma"; en puntkomma',
      date: '2026-10-25',
      endDate: '2026-10-25',
      time: '14:00',
      endTime: '15:30',
      tz: 'Europe/London',
      location: 'Londen',
      notes: 'regel 1\nregel 2',
      url: 'https://example.com',
      repeat: { freq: 'weekly', interval: 2, until: '2026-12-31' },
      exceptions: ['2026-11-08'],
      alert: 30,
      travel: 45,
      invitees: ['Sam', 'lisa@example.com'],
    }),
    ev({
      id: 'b',
      title: 'Vakantie',
      date: '2026-07-01',
      endDate: '2026-07-14',
      alert: 1440,
      repeat: { freq: 'weekdays', interval: 1, until: '' },
    }),
  ];
  const text = toICS('Test', events);
  assert.ok(text.includes('\r\n'));
  assert.ok(text.split('\r\n').every((l) => l.length <= 75));
  const parsed = parseICS(text);
  assert.equal(parsed.name, 'Test');
  assert.equal(parsed.events.length, 2);
  const [a, b] = parsed.events;
  for (const key of [
    'title',
    'date',
    'endDate',
    'time',
    'endTime',
    'tz',
    'location',
    'notes',
    'url',
    'alert',
    'travel',
  ] as const) {
    assert.deepEqual(a[key], events[0][key], key);
  }
  assert.deepEqual(a.repeat, events[0].repeat);
  assert.deepEqual(a.exceptions, ['2026-11-08']);
  assert.deepEqual(a.invitees, ['Sam', 'lisa@example.com']);
  assert.equal(b.endDate, '2026-07-14');
  assert.equal(b.time, '');
  assert.equal(b.alert, 1440);
  assert.equal(b.repeat!.freq, 'weekdays');
});

test('ics: UTC-tijden, COUNT en dagelijkse hele dag van een extern bestand', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Extern',
    'BEGIN:VEVENT',
    'SUMMARY:Call',
    'DTSTART:20261026T100000Z',
    'DTEND:20261026T110000Z',
    'RRULE:FREQ=DAILY;COUNT=3',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Feest',
    'DTSTART;VALUE=DATE:20261030',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  const { events } = parseICS(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].repeat!.until, '2026-10-28');
  assert.ok(events[0].time);
  assert.equal(events[1].endDate, '2026-10-30');
});

// vaste "nu": zondag 25 oktober 2026, 12:00
const now = new Date(2026, 9, 25, 12, 0);

test('quick: datum, tijd en titel', () => {
  let r = parseQuick('Lunch met Sam morgen 12:30', now);
  assert.deepEqual(
    [r.title, r.date, r.time, r.endTime, r.allDay],
    ['Lunch met Sam', '2026-10-26', '12:30', '13:30', false],
  );

  r = parseQuick('Tandarts vrijdag om 14u', now);
  assert.deepEqual([r.title, r.date, r.time], ['Tandarts', '2026-10-30', '14:00']);

  r = parseQuick('Stand-up volgende zondag 9.15 voor 30 min', now);
  assert.deepEqual([r.title, r.date, r.time, r.endTime], ['Stand-up', '2026-11-01', '09:15', '09:45']);

  r = parseQuick('Workshop 3 november van 10:00 tot 12:30', now);
  assert.deepEqual([r.title, r.date, r.time, r.endTime], ['Workshop', '2026-11-03', '10:00', '12:30']);

  r = parseQuick('Verjaardag oma 5 maart hele dag', now);
  assert.deepEqual([r.title, r.date, r.allDay, r.time], ['Verjaardag oma', '2027-03-05', true, '']);

  r = parseQuick('Film over 2 weken 20:00 anderhalf uur', now);
  assert.deepEqual([r.date, r.time, r.endTime], ['2026-11-08', '20:00', '21:30']);

  r = parseQuick('Bellen', now);
  assert.deepEqual([r.title, r.date, r.allDay], ['Bellen', '2026-10-25', true]);
});

test('quick: herhalen, locatie en agenda', () => {
  let r = parseQuick('Yoga elke dinsdag 19:00 @Studio #Privé', now);
  assert.deepEqual(
    [r.title, r.date, r.time, r.location, r.calendarName],
    ['Yoga', '2026-10-27', '19:00', 'Studio', 'Privé'],
  );
  assert.deepEqual(r.repeat, { freq: 'weekly', interval: 1, until: '' });

  r = parseQuick('Prullenbak om de week donderdag', now);
  assert.deepEqual(r.repeat, { freq: 'weekly', interval: 2, until: '' });
  assert.equal(r.date, '2026-10-29');

  r = parseQuick('Borrel @"Café de Zon" 31/10 17:00', now);
  assert.deepEqual([r.location, r.date, r.time], ['Café de Zon', '2026-10-31', '17:00']);
});
