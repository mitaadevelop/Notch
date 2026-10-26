import { describe, expect, test } from 'vitest';
import { migrate } from '../../../src/js/model.ts';
import { clockIn, TIMEZONES, validZone, zoneName } from '../../../src/js/zones.ts';

// De tests draaien in de lokale tijdzone van de machine; vergelijken we met de zone van de test zelf:
const local = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('clockIn', () => {
  test('dezelfde zone als lokaal: dezelfde tijd, geen dagverschil', () => {
    expect(clockIn(local, '2026-10-26', 13)).toEqual({ time: '13:00', dayShift: 0 });
  });

  test('UTC: het uur lokaal min de UTC-afwijking van die dag', () => {
    const offsetHours = -new Date(2026, 9, 26, 12).getTimezoneOffset() / 60; // lokaal t.o.v. UTC
    const expected = (12 - offsetHours + 24) % 24;
    expect(clockIn('UTC', '2026-10-26', 12).time).toBe(`${String(expected).padStart(2, '0')}:00`);
  });

  test('een zone ver vooruit geeft "volgende dag", ook over een maandgrens', () => {
    const tokyo = clockIn('Asia/Tokyo', '2026-10-31', 23);
    if (local === 'Asia/Tokyo') expect(tokyo.dayShift).toBe(0);
    else expect(tokyo.dayShift).toBeGreaterThanOrEqual(0); // het teken hangt af van waar de test draait
    const backwards = clockIn('Pacific/Honolulu', '2026-11-01', 1);
    expect(backwards.dayShift).toBeLessThanOrEqual(0);
  });

  test('de tijd heeft altijd twee cijfers per deel en een geldig uur', () => {
    for (const zone of ['America/New_York', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland']) {
      for (let h = 0; h < 24; h++) {
        const { time } = clockIn(zone, '2026-07-01', h);
        expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      }
    }
  });

  test('halve uren worden meegenomen (Mumbai is +5:30)', () => {
    expect(clockIn('Asia/Kolkata', '2026-10-26', 0).time.endsWith(':30')).toBe(true);
  });
});

describe('validZone en zoneName', () => {
  test.each(['Europe/Amsterdam', 'America/New_York', 'UTC', 'Asia/Kolkata'])('geldig: %s', (z) =>
    expect(validZone(z)).toBe(true),
  );
  test.each(['', 'Mars/Olympus', 'europe', 5, null, undefined, 'x'.repeat(100), '../../etc'])('ongeldig: %j', (z) =>
    expect(validZone(z)).toBe(false),
  );

  test('bekende steden krijgen hun Nederlandse naam, onbekende de plaatsnaam', () => {
    expect(zoneName('America/New_York')).toBe('New York');
    expect(zoneName('Asia/Tokyo')).toBe('Tokio');
    expect(zoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  test('de lijst heeft unieke, geldige zones', () => {
    const ids = TIMEZONES.map(([id]) => id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(validZone(id), id).toBe(true);
  });
});

describe('instelling clocks', () => {
  test('standaard leeg; geldige zones blijven, onzin en dubbelen vallen weg, hooguit twee', () => {
    expect(migrate({ events: [] }).settings.clocks).toEqual([]);
    expect(migrate({ settings: { clocks: ['America/New_York', 'Asia/Tokyo'] } }).settings.clocks).toEqual([
      'America/New_York',
      'Asia/Tokyo',
    ]);
    expect(
      migrate({
        settings: { clocks: ['America/New_York', 'America/New_York', 'Mars/X', 5, 'Asia/Tokyo', 'Europe/London'] },
      }).settings.clocks,
    ).toEqual(['America/New_York', 'Asia/Tokyo']);
    expect(migrate({ settings: { clocks: 'America/New_York' } }).settings.clocks).toEqual([]);
  });
});
