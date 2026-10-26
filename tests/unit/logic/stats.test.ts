import { describe, expect, test } from 'vitest';
import { migrate, normalizeEvent } from '../../../src/js/model.ts';
import { computeStats, hoursLabel, periodRange } from '../../../src/js/stats.ts';
import type { EventInput } from '../../../src/shared/types.ts';

const data = (...events: EventInput[]) => ({
  ...migrate({ events: [] }),
  events: events.map((e, i) => normalizeEvent({ id: `e${i}`, title: 'X', calendarId: 'home', ...e })),
});
const week = { from: '2026-10-26', to: '2026-11-01' }; // maandag t/m zondag

describe('computeStats', () => {
  test('telt uren per agenda en per weekdag, de drukste dag en gemiddelden', () => {
    const s = computeStats(
      data(
        { date: '2026-10-26', time: '09:00', endTime: '10:30' }, // maandag, 90 min, Privé
        { date: '2026-10-26', time: '13:00', endTime: '14:00', calendarId: 'work' }, // maandag, 60 min, Werk
        { date: '2026-10-28', time: '09:00', endTime: '10:00', calendarId: 'work' }, // woensdag, 60 min
      ),
      week.from,
      week.to,
    );
    expect(s.totalMinutes).toBe(210);
    expect(s.timedCount).toBe(3);
    expect(s.perCalendar.map((c) => [c.name, c.minutes, c.count])).toEqual([
      ['Werk', 120, 2],
      ['Privé', 90, 1],
    ]);
    expect(s.perWeekday).toEqual([0, 150, 0, 60, 0, 0, 0]); // zondag eerst: ma = 1, wo = 3
    expect(s.busiest).toEqual({ date: '2026-10-26', minutes: 150 });
  });

  test('hele-dag-afspraken tellen mee als aantal, niet als uren; een afspraak zonder eindtijd is een uur', () => {
    const s = computeStats(
      data({ date: '2026-10-27' }, { date: '2026-10-27', time: '10:00', endTime: '' }),
      week.from,
      week.to,
    );
    expect(s.allDayCount).toBe(1);
    expect(s.timedCount).toBe(1);
    expect(s.totalMinutes).toBe(60);
  });

  test('een afspraak over middernacht telt op beide dagen, en alleen de dagen binnen de periode', () => {
    const s = computeStats(
      data({ date: '2026-11-01', endDate: '2026-11-02', time: '22:00', endTime: '02:00' }),
      week.from,
      week.to,
    );
    expect(s.totalMinutes).toBe(120); // alleen zondag 22:00-24:00 valt in de week
    expect(s.perWeekday[0]).toBe(120);
  });

  test('herhalingen tellen elk voorkomen binnen de periode', () => {
    const s = computeStats(
      data({ date: '2026-10-05', time: '18:00', endTime: '19:00', repeat: { freq: 'daily', interval: 1, until: '' } }),
      week.from,
      week.to,
    );
    expect(s.timedCount).toBe(7);
    expect(s.totalMinutes).toBe(420);
  });

  test("taken tellen apart (open/gedaan) en niet als tijd; feestdagen en verborgen agenda's tellen niet mee", () => {
    const d = data(
      { date: '2026-10-27', task: true },
      { date: '2026-10-28', task: true, doneOn: ['2026-10-28'] },
      { date: '2026-10-29', time: '10:00', endTime: '11:00', calendarId: 'work' },
    );
    d.calendars.find((c) => c.id === 'work')!.visible = false;
    const s = computeStats(d, week.from, week.to);
    expect(s.tasks).toEqual({ open: 1, done: 1 });
    expect(s.timedCount).toBe(0);
    expect(s.perCalendar).toEqual([]);
    expect(s.busiest).toBeNull();
    expect(computeStats(data(), '2026-12-24', '2026-12-26').totalMinutes).toBe(0); // met Kerst erin
  });

  test('bij een gelijke drukte wint de eerste dag', () => {
    const s = computeStats(
      data(
        { date: '2026-10-28', time: '09:00', endTime: '10:00' },
        { date: '2026-10-27', time: '09:00', endTime: '10:00' },
      ),
      week.from,
      week.to,
    );
    expect(s.busiest?.date).toBe('2026-10-27');
  });
});

describe('periodRange', () => {
  test.each([
    ['week', '2026-10-28', 1, '2026-10-26', '2026-11-01'],
    ['last-week', '2026-10-28', 1, '2026-10-19', '2026-10-25'],
    ['week', '2026-10-28', 0, '2026-10-25', '2026-10-31'], // week begint op zondag
    ['month', '2026-10-28', 1, '2026-10-01', '2026-10-31'],
    ['last-month', '2026-01-15', 1, '2025-12-01', '2025-12-31'],
    ['month', '2028-02-10', 1, '2028-02-01', '2028-02-29'], // schrikkeljaar
  ] as const)('%s op %s (week begint %i)', (period, today, weekStart, from, to) => {
    expect(periodRange(period, today, weekStart)).toEqual({ from, to });
  });
});

describe('hoursLabel', () => {
  test.each([
    [0, '0m'],
    [45, '45m'],
    [60, '1u'],
    [90, '1u 30m'],
    [125, '2u 5m'],
    [59.6, '1u'],
  ])('%d min -> %s', (minutes, label) => expect(hoursLabel(minutes)).toBe(label));
});
