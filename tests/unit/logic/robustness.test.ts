import { describe, expect, test } from 'vitest';
import { parseICS, toICS } from '../../../src/js/ics.ts';
import { migrate, normalizeEvent } from '../../../src/js/model.ts';
import { parseQuick } from '../../../src/js/quick.ts';
import { occurrencesBetween } from '../../../src/js/occurrences.ts';

describe('ongeldige of lege invoer', () => {
  test.each(['', 'geen ics', 'BEGIN:VCALENDAR\nEND:VCALENDAR', 'BEGIN:VEVENT\nSUMMARY:Zonder datum\nEND:VEVENT'])(
    'parseICS(%j) geeft geen afspraken en gooit niet',
    (text) => {
      expect(parseICS(text).events).toEqual([]);
    },
  );

  test('parseICS slaat een afspraak met onleesbare datum over', () => {
    const text =
      'BEGIN:VEVENT\nSUMMARY:Kapot\nDTSTART:morgen\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Goed\nDTSTART:20261026\nEND:VEVENT';
    expect(parseICS(text).events.map((e) => e.title)).toEqual(['Goed']);
  });

  test('toICS van een lijst zonder afspraken is een geldige lege kalender', () => {
    const text = toICS('Leeg', []);
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).not.toContain('BEGIN:VEVENT');
  });

  test('parseQuick van lege tekst geeft een hele-dag-afspraak vandaag', () => {
    const now = new Date(2026, 9, 26, 10, 0);
    expect(parseQuick('', now)).toMatchObject({ title: '', date: '2026-10-26', allDay: true, time: '' });
  });

  test('parseQuick negeert een onmogelijke tijd', () => {
    expect(parseQuick('Bellen om 25:99', new Date(2026, 9, 26)).time).toBe('');
  });

  test('migrate kan niet crashen op rare opslag', () => {
    for (const raw of [undefined, null, 5, 'x', [], [null, 1, 'a'], { events: 'nee', calendars: 3, settings: 'x' }]) {
      const data = migrate(raw);
      expect(data.version).toBe(2);
      expect(data.calendars.length).toBeGreaterThan(0);
      expect(data.events).toEqual([]);
    }
  });

  test('normalizeEvent corrigeert een einde vóór het begin en een ongeldige herhaling', () => {
    const ev = normalizeEvent({ date: '2026-10-26', endDate: '2026-10-20', repeat: { freq: 'daily', interval: -3 } });
    expect(ev.endDate).toBe('2026-10-26');
    expect(ev.repeat).toEqual({ freq: 'daily', interval: 1, until: '' });
  });

  test('een herhaling zonder einde loopt niet eindeloos door', () => {
    const data = migrate({
      events: [{ id: 'a', title: 'x', date: '2000-01-01', repeat: { freq: 'daily', interval: 1 } }],
    });
    const start = Date.now();
    const occs = occurrencesBetween(data, '2026-10-01', '2026-10-31').filter((o) => !o.holiday);
    expect(occs.length).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
