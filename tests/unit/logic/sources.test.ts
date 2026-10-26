import { describe, expect, test } from 'vitest';
import { parseICS, toICS } from '../../../src/js/ics.ts';
import { normalizeCalendar, normalizeEvent } from '../../../src/js/model.ts';
import { baseDates, occurrencesBetween } from '../../../src/js/occurrences.ts';
import { migrate } from '../../../src/js/model.ts';

const ics = (...events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');

describe('agenda met een bron', () => {
  test('normalizeCalendar bewaart een geldige bron en gooit onzin weg', () => {
    const feed = { kind: 'feed', url: 'https://x/a.ics', provider: 'google' } as const;
    expect(normalizeCalendar({ id: 'a', source: feed, syncedAt: 5, syncError: 'oeps' })).toMatchObject({
      source: feed,
      syncedAt: 5,
      syncError: 'oeps',
    });
    for (const source of [
      null,
      'x',
      { kind: 'feed' },
      { kind: 'feed', url: '' },
      { kind: 'caldav', accountId: 1 },
      { kind: 'rss' },
    ]) {
      expect(normalizeCalendar({ id: 'a', source } as never)).not.toHaveProperty('source');
    }
    expect(normalizeCalendar({ id: 'a' })).not.toHaveProperty('syncError');
  });

  test('de bron overleeft migreren van opgeslagen data', () => {
    const source = { kind: 'caldav', accountId: 'acc', calendarUrl: 'https://x/cal/', provider: 'icloud' };
    const data = migrate({ calendars: [{ id: 'c', name: 'iCloud', color: 'red', type: 'user', source }], events: [] });
    expect(data.calendars.find((c) => c.id === 'c')?.source).toEqual(source);
  });
});

describe('ics: UID en aangepaste voorkomens', () => {
  test('de UID wordt de id, zodat een volgende synchronisatie dezelfde afspraak herkent', () => {
    const { events } = parseICS(ics(['UID:abc@google.com', 'SUMMARY:Tandarts', 'DTSTART:20261026T100000']));
    expect(events[0].id).toBe('abc@google.com');
  });

  test('een aangepast voorkomen (RECURRENCE-ID) vervangt dat voorkomen in de reeks', () => {
    const { events } = parseICS(
      ics(
        ['UID:serie', 'SUMMARY:Yoga', 'DTSTART:20261026T190000', 'RRULE:FREQ=WEEKLY'],
        ['UID:serie', 'RECURRENCE-ID:20261102T190000', 'SUMMARY:Yoga (verplaatst)', 'DTSTART:20261103T080000'],
      ),
    );
    expect(events).toHaveLength(2);
    const [series, moved] = events;
    expect(series.exceptions).toEqual(['2026-11-02']);
    expect(moved).toMatchObject({
      id: 'serie@2026-11-02',
      title: 'Yoga (verplaatst)',
      date: '2026-11-03',
      repeat: null,
    });

    const data = { ...migrate({ events }), events };
    const titles = occurrencesBetween(data, '2026-10-26', '2026-11-09')
      .filter((o) => !o.holiday)
      .map((o) => `${o.date} ${o.title}`);
    expect(titles).toEqual(['2026-10-26 Yoga', '2026-11-03 Yoga (verplaatst)', '2026-11-09 Yoga']);
  });

  test('een override zonder bijbehorende reeks blijft gewoon een losse afspraak', () => {
    const { events } = parseICS(
      ics(['UID:weg', 'RECURRENCE-ID:20261102T190000', 'SUMMARY:Los', 'DTSTART:20261103T080000']),
    );
    expect(events.map((e) => e.title)).toEqual(['Los']);
  });
});

describe('herhalen op meerdere weekdagen', () => {
  const weekly = (days: number[], interval = 1, until = '') =>
    normalizeEvent({ id: 'w', date: '2026-10-26', repeat: { freq: 'weekly', interval, until, byDay: days } });

  test('maandag, woensdag en vrijdag', () => {
    expect([...baseDates(weekly([1, 3, 5]), '2026-10-26', '2026-11-08')]).toEqual([
      '2026-10-26',
      '2026-10-28',
      '2026-10-30',
      '2026-11-02',
      '2026-11-04',
      '2026-11-06',
    ]);
  });

  test('om de week telt vanaf de week van de start', () => {
    expect([...baseDates(weekly([1, 4], 2), '2026-10-26', '2026-11-15')]).toEqual([
      '2026-10-26',
      '2026-10-29',
      '2026-11-09',
      '2026-11-12',
    ]);
  });

  test('uitzonderingen, einddatum en een periode ver na de start', () => {
    const ev = { ...weekly([2], 1, '2027-01-31'), exceptions: ['2026-11-03'] };
    expect([...baseDates(ev, '2026-11-01', '2026-11-20')]).toEqual(['2026-11-10', '2026-11-17']);
    expect([...baseDates(ev, '2027-01-20', '2027-03-01')]).toEqual(['2027-01-26']);
  });

  test('ongeldige dagen worden opgeschoond', () => {
    const repeat = normalizeEvent({
      date: '2026-10-26',
      repeat: { freq: 'weekly', byDay: [5, 1, 1, 9, -1, 2.5, 'x'] as never },
    }).repeat;
    expect(repeat?.byDay).toEqual([1, 5]);
    expect(normalizeEvent({ date: '2026-10-26', repeat: { freq: 'daily', byDay: [1] } }).repeat).not.toHaveProperty(
      'byDay',
    );
  });

  test('ics: lezen en schrijven van BYDAY', () => {
    const { events } = parseICS(
      ics(['UID:x', 'SUMMARY:Sport', 'DTSTART:20261026T180000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH']),
    );
    expect(events[0].repeat).toEqual({ freq: 'weekly', interval: 2, until: '', byDay: [1, 4] });
    const text = toICS('Test', events);
    expect(text).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
    expect(parseICS(text).events[0].repeat).toEqual(events[0].repeat);
  });

  test('ics: maandag t/m vrijdag blijft "elke werkdag"', () => {
    const { events } = parseICS(
      ics(['UID:x', 'SUMMARY:Werk', 'DTSTART:20261026T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']),
    );
    expect(events[0].repeat?.freq).toBe('weekdays');
  });
});

describe('ics: COUNT wordt een echte einddatum', () => {
  const until = (rule: string, start = '20261026T100000') =>
    parseICS(ics(['UID:x', 'SUMMARY:x', `DTSTART:${start}`, `RRULE:${rule}`])).events[0].repeat?.until;

  test.each([
    ['FREQ=DAILY;COUNT=3', '2026-10-28'],
    ['FREQ=DAILY;INTERVAL=2;COUNT=3', '2026-10-30'],
    ['FREQ=WEEKLY;COUNT=3', '2026-11-09'],
    ['FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3', '2026-11-02'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=6', '2026-11-02'],
    ['FREQ=MONTHLY;COUNT=3', '2026-12-26'],
    ['FREQ=YEARLY;COUNT=2', '2027-10-26'],
  ])('%s', (rule, expected) => {
    expect(until(rule)).toBe(expected);
  });

  test('een UNTIL wint van niets en COUNT=0 wordt genegeerd', () => {
    expect(until('FREQ=DAILY;UNTIL=20261030T000000Z')).toBe('2026-10-30');
    expect(until('FREQ=DAILY;COUNT=0')).toBe('');
  });
});
