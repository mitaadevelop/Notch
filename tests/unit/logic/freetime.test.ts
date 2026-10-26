import { describe, expect, test } from 'vitest';
import { findFreeSlots } from '../../../src/js/freetime.ts';
import { migrate, normalizeEvent } from '../../../src/js/model.ts';
import type { EventInput } from '../../../src/shared/types.ts';

const data = (...events: EventInput[]) => ({
  ...migrate({ events: [] }),
  events: events.map((e, i) => normalizeEvent({ id: `e${i}`, title: 'X', calendarId: 'home', ...e })),
});
const win = { dayStart: 9 * 60, dayEnd: 18 * 60 };
const mins = (h: number, m = 0) => h * 60 + m;

describe('findFreeSlots', () => {
  test('een lege dag is helemaal vrij binnen het venster', () => {
    expect(findFreeSlots(data(), { from: '2026-10-27', to: '2026-10-27', duration: 30, ...win })).toEqual([
      { date: '2026-10-27', start: mins(9), end: mins(18) },
    ]);
  });

  test('gaten tussen afspraken; te korte gaten tellen niet', () => {
    const d = data(
      { date: '2026-10-27', time: '10:00', endTime: '11:00' },
      { date: '2026-10-27', time: '11:20', endTime: '12:00' },
    );
    const slots = findFreeSlots(d, { from: '2026-10-27', to: '2026-10-27', duration: 30, ...win });
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      [mins(9), mins(10)],
      [mins(12), mins(18)],
    ]); // het gat van 20 minuten is te kort
  });

  test('hele-dag-afspraken en feestdagen blokkeren niet; overlappende afspraken tellen als één blok', () => {
    const d = data(
      { date: '2026-10-27' },
      { date: '2026-10-27', time: '10:00', endTime: '12:00' },
      { date: '2026-10-27', time: '11:00', endTime: '13:00' },
    );
    const slots = findFreeSlots(d, { from: '2026-10-27', to: '2026-10-27', duration: 60, ...win });
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      [mins(9), mins(10)],
      [mins(13), mins(18)],
    ]);
  });

  test('ignore laat een afspraak buiten beschouwing (de afspraak die je zelf bewerkt)', () => {
    const d = data({ id: 'zelf', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    const slots = findFreeSlots(d, {
      from: '2026-10-27',
      to: '2026-10-27',
      duration: 480,
      ignore: (o) => o.id === 'zelf',
      ...win,
    });
    expect(slots).toHaveLength(1);
  });

  test('notBefore geldt alleen op de eerste dag', () => {
    const slots = findFreeSlots(data(), {
      from: '2026-10-27',
      to: '2026-10-28',
      duration: 60,
      notBefore: mins(14),
      ...win,
    });
    expect(slots.map((s) => [s.date, s.start])).toEqual([
      ['2026-10-27', mins(14)],
      ['2026-10-28', mins(9)],
    ]);
  });

  test('weekenden worden overgeslagen tenzij gevraagd, en limit kapt af', () => {
    const opts = { from: '2026-10-30', to: '2026-11-02', duration: 60, ...win };
    expect(findFreeSlots(data(), opts).map((s) => s.date)).toEqual(['2026-10-30', '2026-11-02']);
    expect(findFreeSlots(data(), { ...opts, weekends: true }).map((s) => s.date)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(findFreeSlots(data(), { ...opts, weekends: true, limit: 1 })).toHaveLength(1);
  });

  test('een meerdaagse afspraak blokkeert de dagen ertussen helemaal', () => {
    const d = data({ date: '2026-10-27', endDate: '2026-10-29', time: '12:00', endTime: '12:00' });
    const slots = findFreeSlots(d, { from: '2026-10-27', to: '2026-10-29', duration: 30, ...win });
    expect(slots.map((s) => [s.date, s.start, s.end])).toEqual([
      ['2026-10-27', mins(9), mins(12)],
      ['2026-10-29', mins(12), mins(18)],
    ]);
  });
});
