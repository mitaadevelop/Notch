import { expect, test } from 'vitest';
import { migrate } from '../../../src/js/model.ts';
import { compareOcc, occurrencesBetween } from '../../../src/js/occurrences.ts';

const ev = (id: string, title: string, date: string, time = '') => ({
  id,
  title,
  date,
  time,
  endTime: time ? '23:00' : '',
});

test('voorkomens staan op datum, dan hele dag vóór tijd, dan op tijd, dan op titel', () => {
  const data = migrate({
    events: [
      ev('a', 'Laat', '2026-10-27', '18:00'),
      ev('b', 'Vroeg', '2026-10-27', '08:00'),
      ev('c', 'Zebra', '2026-10-27'),
      ev('d', 'Appel', '2026-10-27'),
      ev('e', 'Eerder', '2026-10-26', '23:00'),
    ],
  });
  data.calendars = data.calendars.filter((c) => c.type === 'user'); // geen feestdagen ertussen
  const titles = occurrencesBetween(data, '2026-10-26', '2026-10-27').map((o) => o.title);
  expect(titles).toEqual(['Eerder', 'Appel', 'Zebra', 'Vroeg', 'Laat']);
});

test('compareOcc is antisymmetrisch', () => {
  const data = migrate({ events: [ev('a', 'A', '2026-10-27', '09:00'), ev('b', 'B', '2026-10-27')] });
  const [first, second] = occurrencesBetween(data, '2026-10-27', '2026-10-27').filter((o) => !o.holiday);
  expect(Math.sign(compareOcc(first, second))).toBe(-Math.sign(compareOcc(second, first)));
  expect(compareOcc(first, first)).toBe(0);
});
