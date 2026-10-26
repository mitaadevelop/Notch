import { describe, expect, test } from 'vitest';
import { migrate, normalizeTemplate } from '../../../src/js/model.ts';
import { optionsFromTemplate, templateFromValues } from '../../../src/js/templates.ts';
import type { EventValues } from '../../../src/shared/types.ts';

const values = (over: Partial<EventValues> = {}): EventValues => ({
  title: 'Sporten',
  calendarId: 'home',
  location: 'Sportschool',
  url: '',
  notes: 'Schoenen mee',
  date: '2026-10-26',
  endDate: '2026-10-26',
  time: '18:00',
  endTime: '19:30',
  tz: '',
  repeat: { freq: 'weekly', interval: 1, until: '', byDay: [1, 3] },
  alert: 15,
  travel: 20,
  invitees: ['Sam'],
  task: false,
  ...over,
});

describe('templateFromValues', () => {
  test('neemt alles over behalve de datum, met de duur uit begin- en eindtijd', () => {
    expect(templateFromValues(values(), 'Sportschool', 't1')).toEqual({
      id: 't1',
      name: 'Sportschool',
      title: 'Sporten',
      calendarId: 'home',
      location: 'Sportschool',
      notes: 'Schoenen mee',
      invitees: ['Sam'],
      time: '18:00',
      duration: 90,
      alert: 15,
      travel: 20,
      repeat: { freq: 'weekly', interval: 1, until: '', byDay: [1, 3] },
    });
  });

  test('een hele dag heeft geen tijd en duur 0', () => {
    const t = templateFromValues(values({ time: '', endTime: '', travel: 0 }), 'Vrij', 't2');
    expect(t).toMatchObject({ time: '', duration: 0 });
  });

  test('meerdaags of zonder eindtijd telt als een uur; een lege naam wordt de titel', () => {
    expect(templateFromValues(values({ endDate: '2026-10-27' }), 'x', 'i').duration).toBe(60);
    expect(templateFromValues(values({ endTime: '' }), 'x', 'i').duration).toBe(60);
    expect(templateFromValues(values(), '   ', 'i').name).toBe('Sporten');
  });

  test('kopieert invitees en herhaling, zodat later wijzigen het sjabloon niet raakt', () => {
    const v = values();
    const t = templateFromValues(v, 'n', 'i');
    v.invitees.push('Lisa');
    v.repeat!.interval = 9;
    expect(t.invitees).toEqual(['Sam']);
    expect(t.repeat!.interval).toBe(1);
  });
});

describe('optionsFromTemplate', () => {
  test('vult de dialoog voor de gekozen dag, met het eindtijdstip uit de duur', () => {
    const t = templateFromValues(values(), 'n', 'i');
    expect(optionsFromTemplate(t, '2026-11-03').prefill).toMatchObject({
      title: 'Sporten',
      date: '2026-11-03',
      endDate: '2026-11-03',
      time: '18:00',
      endTime: '19:30',
      alert: 15,
      travel: 20,
      repeat: { freq: 'weekly', byDay: [1, 3] },
    });
  });

  test('een einde blijft binnen de dag en een hele dag blijft een hele dag', () => {
    const late = templateFromValues(values({ time: '23:00', endTime: '23:59' }), 'n', 'i');
    late.duration = 120;
    expect(optionsFromTemplate(late, '2026-11-03').prefill?.endTime).toBe('23:59');
    const allDay = templateFromValues(values({ time: '', endTime: '' }), 'n', 'i');
    expect(optionsFromTemplate(allDay, '2026-11-03').prefill).toMatchObject({ time: '', endTime: '' });
  });
});

describe('normalizeTemplate en migrate', () => {
  const good = { id: 'a', name: ' Lunch ', title: 'Lunch', calendarId: 'work', time: '12:00', duration: 45 };

  test('een geldig sjabloon blijft, met opgeschoonde velden', () => {
    expect(normalizeTemplate(good)).toMatchObject({
      id: 'a',
      name: 'Lunch',
      time: '12:00',
      duration: 45,
      calendarId: 'work',
      repeat: null,
    });
  });

  test.each([null, 5, 'x', [], {}, { id: 'a' }, { name: 'x' }, { id: '', name: 'x' }, { id: 'a', name: '   ' }])(
    'onbruikbaar: %j',
    (raw) => expect(normalizeTemplate(raw)).toBeNull(),
  );

  test('slechte velden vallen terug: tijd, duur, meldingen en herhaling', () => {
    const t = normalizeTemplate({
      ...good,
      time: '25:99',
      duration: 'lang',
      alert: -5,
      repeat: { freq: 'wekelijks' },
      invitees: [1, 'ok'],
    })!;
    expect(t.time).toBe('');
    expect(t.duration).toBe(0);
    expect(t.alert).toBeNull();
    expect(t.invitees).toEqual(['ok']);
  });

  test('een te lange duur wordt een uur', () => {
    expect(normalizeTemplate({ ...good, duration: 99999 })!.duration).toBe(60);
    expect(normalizeTemplate({ ...good, duration: 1 })!.duration).toBe(60);
  });

  test('migrate houdt geldige sjablonen, laat kapotte vallen en begrenst het aantal', () => {
    expect(migrate({ events: [] }).settings.templates).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => ({ ...good, id: `t${i}`, name: `N${i}` }));
    const data = migrate({ settings: { templates: [good, null, 'x', ...many] } });
    expect(data.settings.templates).toHaveLength(50);
    expect(data.settings.templates[0].id).toBe('a');
    expect(migrate({ settings: { templates: 'kapot' } }).settings.templates).toEqual([]);
  });
});
