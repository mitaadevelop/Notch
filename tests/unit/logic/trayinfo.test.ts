import { describe, expect, test } from 'vitest';
import { migrate, normalizeEvent } from '../../../src/js/model.ts';
import { dayWord, trayState, upcoming } from '../../../src/js/trayinfo.ts';
import type { EventInput } from '../../../src/shared/types.ts';

const data = (...events: EventInput[]) => ({
  ...migrate({ events: [] }),
  events: events.map((e, i) => normalizeEvent({ id: `e${i}`, title: 'X', calendarId: 'home', ...e })),
});
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m); // oktober 2026

describe('upcoming', () => {
  test('afspraken die al voorbij zijn tellen niet, wat bezig is wel; gesorteerd op begin', () => {
    const d = data(
      { id: 'voorbij', date: '2026-10-26', time: '08:00', endTime: '09:00' },
      { id: 'bezig', date: '2026-10-26', time: '09:30', endTime: '11:00' },
      { id: 'later', date: '2026-10-26', time: '15:00', endTime: '16:00' },
      { id: 'morgen', date: '2026-10-27', time: '09:00', endTime: '10:00' },
    );
    expect(upcoming(d, at(26, 10, 0)).map((o) => o.id)).toEqual(['bezig', 'later', 'morgen']);
  });

  test('hele-dag-afspraken tellen alleen vandaag; feestdagen en afgevinkte taken nooit', () => {
    const d = data(
      { id: 'hd', date: '2026-10-26' },
      { id: 'hd-morgen', date: '2026-10-27' },
      { id: 'taak', date: '2026-10-26', task: true },
      { id: 'klaar', date: '2026-10-26', task: true, doneOn: ['2026-10-26'] },
    );
    expect(
      upcoming(d, at(26, 10, 0))
        .map((o) => o.id)
        .sort(),
    ).toEqual(['hd', 'taak']);
  });

  test('alleen de komende week en hooguit zes', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      date: '2026-10-27',
      time: `0${i}:00`,
      endTime: `0${i}:30`,
    }));
    expect(
      upcoming(data(...many, { id: 'ver', date: '2026-12-01', time: '09:00', endTime: '10:00' }), at(26, 10)).length,
    ).toBe(6);
  });
});

describe('trayState', () => {
  const d = data({ title: 'Tandarts', date: '2026-10-26', time: '14:00', endTime: '15:00', id: 'a' });

  test('uitgeschakeld: niets', () => {
    expect(trayState(d, at(26, 10), false)).toEqual({ enabled: false, title: '', tooltip: '', items: [] });
  });

  test('binnen een uur: "over N min"; later vandaag: de tijd; morgen: alleen het icoon', () => {
    expect(trayState(d, at(26, 13, 48), true).title).toBe('Tandarts · over 12 min');
    expect(trayState(d, at(26, 10), true).title).toBe('Tandarts · 14:00');
    expect(
      trayState(data({ title: 'Tandarts', date: '2026-10-27', time: '14:00', endTime: '15:00' }), at(26, 10), true)
        .title,
    ).toBe('');
    expect(trayState(d, at(26, 14, 10), true).title).toBe('Tandarts · nu');
  });

  test('regels met dag, tijd en titel, en het id om hem te openen', () => {
    const s = trayState(
      data(
        { title: 'Tandarts', date: '2026-10-26', time: '14:00', endTime: '15:00', id: 'a' },
        { title: 'Lunch', date: '2026-10-27', time: '12:00', endTime: '13:00', id: 'b' },
        { title: 'Reis', date: '2026-10-30', time: '08:00', endTime: '09:00', id: 'c' },
        { title: 'Vrij', date: '2026-10-26', id: 'd' },
      ),
      at(26, 10),
      true,
    );
    expect(s.items.map((i) => i.label)).toEqual([
      'Vandaag · Vrij',
      'Vandaag 14:00 · Tandarts',
      'Morgen 12:00 · Lunch',
      expect.stringMatching(/^vr 30 okt\.? 08:00 · Reis$/),
    ]);
    expect(s.items[1]).toEqual({ label: 'Vandaag 14:00 · Tandarts', date: '2026-10-26', id: 'a' });
  });

  test('lange titels worden afgekapt; zonder afspraken staat er een nette tooltip', () => {
    const long = trayState(
      data({
        title: 'Een heel erg lange titel van een vergadering',
        date: '2026-10-26',
        time: '14:00',
        endTime: '15:00',
      }),
      at(26, 13, 50),
      true,
    );
    expect(long.title.startsWith('Een heel erg lange titel…')).toBe(true);
    expect(long.title.length).toBeLessThan(45);
    expect(trayState(data(), at(26, 10), true)).toMatchObject({
      enabled: true,
      title: '',
      tooltip: 'Agenda: geen afspraken de komende dagen',
      items: [],
    });
  });

  test('alleen een hele-dag-afspraak vandaag: geen tekst naast het icoon, wel een tooltip', () => {
    const s = trayState(data({ title: 'Vrij', date: '2026-10-26' }), at(26, 10), true);
    expect(s.title).toBe('');
    expect(s.tooltip).toBe('Vandaag: Vrij');
  });
});

test('dayWord', () => {
  expect(dayWord('2026-10-26', '2026-10-26')).toBe('Vandaag');
  expect(dayWord('2026-10-27', '2026-10-26')).toBe('Morgen');
  expect(dayWord('2026-10-29', '2026-10-26')).toMatch(/do 29 okt/);
});
