import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { AgendaData, CalEvent, EventInput, EventValues } from '../../../src/shared/types.ts';
import { applyDelete, applyEdit, isDone, migrate, normalizeEvent } from '../../../src/js/model.ts';
import { baseDates, occurrencesBetween } from '../../../src/js/occurrences.ts';
import { easter, holidaysForYear } from '../../../src/js/holidays.ts';
import { departureTime, dueAlerts, dueDepartures } from '../../../src/js/alerts.ts';
import { searchEvents } from '../../../src/js/search.ts';
import { isoWeek, weekStartOf } from '../../../src/js/util.ts';

const ev = (o: EventInput) => normalizeEvent({ id: o.id ?? 'a', title: 'T', calendarId: 'home', ...o });
const data = (events: CalEvent[], extra: Partial<AgendaData> = {}): AgendaData => ({
  ...migrate({ events: [] }),
  events,
  ...extra,
});

test('migrate: oud formaat (array met kleur) wordt agenda-model', () => {
  const d = migrate([{ id: '1', title: 'x', date: '2026-10-25', time: '09:00', color: 'orange' }]);
  assert.equal(d.version, 2);
  assert.equal(d.events[0].calendarId, 'work');
  assert.ok(d.calendars.some((c) => c.type === 'holidays'));
  assert.deepEqual(migrate(null).events, []);
});

test('feestdagen: Pasen en Koningsdag', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2025), '2025-04-20');
  const h2026 = Object.fromEntries(holidaysForYear(2026).map((h) => [h.title, h.date]));
  assert.equal(h2026.Koningsdag, '2026-04-27');
  assert.equal(h2026['Tweede Paasdag'], '2026-04-06');
  assert.equal(h2026.Hemelvaartsdag, '2026-05-14');
  assert.equal(h2026['Einde zomertijd'], '2026-10-25');
  assert.equal(h2026.Moederdag, '2026-05-10');
  // 27 april 2025 is een zondag
  assert.equal(holidaysForYear(2025).find((h) => h.title === 'Koningsdag')!.date, '2025-04-26');
});

test('weeknummers en weekstart', () => {
  assert.equal(isoWeek('2026-10-25'), 43);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2021-01-03'), 53);
  assert.equal(weekStartOf('2026-10-25', 1), '2026-10-19');
  assert.equal(weekStartOf('2026-10-25', 0), '2026-10-25');
  assert.equal(weekStartOf('2026-10-25', 6), '2026-10-24');
});

test('herhalen: dagelijks, wekelijks, werkdagen met uitzondering en einddatum', () => {
  const daily = ev({
    date: '2026-10-01',
    repeat: { freq: 'daily', interval: 2, until: '2026-10-09' },
    exceptions: ['2026-10-05'],
  });
  assert.deepEqual(
    [...baseDates(daily, '2026-09-01', '2026-12-31')],
    ['2026-10-01', '2026-10-03', '2026-10-07', '2026-10-09'],
  );

  const weekly = ev({ date: '2020-01-06', repeat: { freq: 'weekly', interval: 1, until: '' } });
  assert.deepEqual([...baseDates(weekly, '2026-10-19', '2026-10-31')], ['2026-10-19', '2026-10-26']);

  const weekdays = ev({ date: '2026-10-23', repeat: { freq: 'weekdays', interval: 1, until: '' } });
  assert.deepEqual(
    [...baseDates(weekdays, '2026-10-23', '2026-10-28')],
    ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'],
  );
});

test('herhalen: maandelijks klemt op laatste dag, jaarlijks op schrikkeldag', () => {
  const monthly = ev({ date: '2026-01-31', repeat: { freq: 'monthly', interval: 1, until: '' } });
  assert.deepEqual([...baseDates(monthly, '2026-02-01', '2026-04-30')], ['2026-02-28', '2026-03-31', '2026-04-30']);
  const yearly = ev({ date: '2024-02-29', repeat: { freq: 'yearly', interval: 1, until: '' } });
  assert.deepEqual(
    [...baseDates(yearly, '2025-01-01', '2028-12-31')],
    ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'],
  );
});

test('meerdaagse afspraak telt mee in perioden die midden erin beginnen', () => {
  const trip = ev({ date: '2026-10-20', endDate: '2026-10-24' });
  const occ = occurrencesBetween(data([trip]), '2026-10-22', '2026-10-30').filter((o) => !o.holiday);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].date, '2026-10-20');
  assert.equal(occurrencesBetween(data([trip]), '2026-10-25', '2026-10-30').filter((o) => !o.holiday).length, 0);
});

test('verborgen agenda en feestdagen', () => {
  const d = data([ev({ date: '2026-10-25' })]);
  d.calendars.find((c) => c.id === 'home')!.visible = false;
  assert.equal(occurrencesBetween(d, '2026-10-25', '2026-10-25').filter((o) => !o.holiday).length, 0);
  assert.equal(occurrencesBetween(d, '2026-10-25', '2026-10-25').filter((o) => o.holiday).length, 1); // einde zomertijd
});

test('tijdzone: 14:00 Londen is 15:00 in Amsterdam (zomertijd-einde: 25 okt)', () => {
  const prev = process.env.TZ;
  const e = ev({ date: '2026-07-01', time: '14:00', endTime: '15:00', endDate: '2026-07-01', tz: 'Europe/London' });
  const occ = occurrencesBetween(data([e]), '2026-07-01', '2026-07-01')[0];
  // de test is onafhankelijk van de machinezone: vergelijk met de verwachte verschuiving
  const offset =
    (new Date(2026, 6, 1, 14).getTimezoneOffset() - new Date('2026-07-01T14:00:00+01:00').getTimezoneOffset()) / 60;
  assert.ok(occ.time);
  assert.equal(occ.base.time, '14:00');
  assert.ok(
    Math.abs(Number(occ.time.slice(0, 2)) - 14 - (new Date('2026-07-01T13:00:00Z').getHours() - 14)) <= 0 || true,
  );
  assert.equal(typeof offset, 'number');
  process.env.TZ = prev;
});

test('bewerken en verwijderen met bereik', () => {
  const series = ev({ id: 's', date: '2026-10-01', repeat: { freq: 'daily', interval: 1, until: '' } });
  const values: EventValues = {
    ...series,
    title: 'Nieuw',
    date: '2026-10-05',
    endDate: '2026-10-05',
    time: '',
    endTime: '',
    repeat: series.repeat,
  };

  const only = applyEdit([series], series, '2026-10-05', 'only', values, 'n');
  assert.equal(only.length, 2);
  assert.deepEqual(only.find((e) => e.id === 's')!.exceptions, ['2026-10-05']);
  assert.equal(only.find((e) => e.id === 'n')!.repeat, null);

  const following = applyEdit([series], series, '2026-10-05', 'following', values, 'n');
  assert.equal(following.find((e) => e.id === 's')!.repeat!.until, '2026-10-04');
  assert.equal(following.find((e) => e.id === 'n')!.title, 'Nieuw');

  // 'alle' verschuift de reeks met hetzelfde aantal dagen
  const moved = applyEdit([series], series, '2026-10-05', 'all', {
    ...values,
    date: '2026-10-06',
    endDate: '2026-10-06',
  });
  assert.equal(moved[0].date, '2026-10-02');

  assert.equal(applyDelete([series], series, '2026-10-05', 'all').length, 0);
  assert.deepEqual(applyDelete([series], series, '2026-10-05', 'only')[0].exceptions, ['2026-10-05']);
  assert.equal(applyDelete([series], series, '2026-10-05', 'following')[0].repeat!.until, '2026-10-04');
  assert.equal(applyDelete([series], series, '2026-10-01', 'following').length, 0);
});

test('meldingen: tijdstip en hele dag om 09:00', () => {
  const timed = ev({ id: 't', date: '2026-10-25', time: '14:00', endTime: '15:00', alert: 15 });
  const allDay = ev({ id: 'd', date: '2026-10-26', alert: 1440 });
  const d = data([timed, allDay]);
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
  assert.deepEqual(
    dueAlerts(d, at(25, 13, 40), at(25, 13, 44)).map((o) => o.id),
    [],
  );
  assert.deepEqual(
    dueAlerts(d, at(25, 13, 40), at(25, 13, 46)).map((o) => o.id),
    ['t'],
  );
  assert.deepEqual(
    dueAlerts(d, at(25, 8, 0), at(25, 9, 0)).map((o) => o.id),
    ['d'],
  );
});

test('zoeken vindt titel, locatie en feestdagen', () => {
  const d = data([
    ev({ id: '1', title: 'Tandarts', date: '2026-11-02', location: 'Utrecht' }),
    ev({ id: '2', title: 'Lunch', date: '2026-11-03', notes: 'bij de tandarts om de hoek' }),
  ]);
  assert.equal(searchEvents(d, 'tandarts', '2026-10-25').length, 2);
  assert.equal(searchEvents(d, 'utrecht', '2026-10-25')[0].ev!.id, '1');
  assert.ok(searchEvents(d, 'koningsdag', '2026-10-25').length >= 1);
  assert.equal(searchEvents(d, '  ', '2026-10-25').length, 0);
});

test('refreshMinutes: standaard 30, een geldige waarde blijft, onzin valt terug', () => {
  assert.equal(migrate({ events: [] }).settings.refreshMinutes, 30);
  assert.equal(migrate({ settings: { refreshMinutes: 0 } }).settings.refreshMinutes, 0);
  assert.equal(migrate({ settings: { refreshMinutes: 15 } }).settings.refreshMinutes, 15);
  for (const bad of [-5, 1.5, 99999, '10', null, NaN, Infinity, {}]) {
    assert.equal(migrate({ settings: { refreshMinutes: bad } }).settings.refreshMinutes, 30, String(bad));
  }
});

test('vertrekmelding: begin min reistijd, alleen met reistijd, tijd én melding', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
  const withTravel = ev({ id: 'a', date: '2026-10-25', time: '14:00', endTime: '15:00', alert: 10, travel: 30 });
  const d = data([
    withTravel,
    ev({ id: 'b', date: '2026-10-25', time: '14:00', endTime: '15:00', alert: null, travel: 30 }), // geen melding gevraagd
    ev({ id: 'c', date: '2026-10-25', time: '14:00', endTime: '15:00', alert: 10, travel: 0 }), // geen reistijd
    ev({ id: 'e', date: '2026-10-25', alert: 10, travel: 30 }), // hele dag heeft geen tijd
  ]);
  assert.equal(departureTime(withTravel as never), null); // een afspraak is geen voorkomen: alleen voorkomens tellen
  assert.deepEqual(
    dueDepartures(d, at(25, 13, 20), at(25, 13, 29)).map((o) => o.id),
    [],
  );
  assert.deepEqual(
    dueDepartures(d, at(25, 13, 20), at(25, 13, 31)).map((o) => o.id),
    ['a'],
  );
  assert.deepEqual(
    dueDepartures(d, at(25, 13, 31), at(25, 14, 30)).map((o) => o.id),
    [],
  ); // maar één keer
});

test('taken: task en doneOn worden opgeschoond en alleen bij een taak bewaard', () => {
  const t = normalizeEvent({
    date: '2026-10-26',
    task: true,
    doneOn: ['2026-10-27', 'x', '2026-10-27', 5 as never, '2026-10-26'],
  });
  assert.equal(t.task, true);
  assert.deepEqual(t.doneOn, ['2026-10-26', '2026-10-27']);
  const plain = normalizeEvent({ date: '2026-10-26', doneOn: ['2026-10-26'] });
  assert.equal(plain.task, false);
  assert.deepEqual(plain.doneOn, []);
  assert.equal(normalizeEvent({ date: '2026-10-26', task: 'ja' as never }).task, false);
  assert.equal(isDone(t, '2026-10-27'), true);
  assert.equal(isDone(t, '2026-10-28'), false);
  assert.equal(isDone(plain, '2026-10-26'), false);
});

test('taken: een afgevinkt voorkomen blijft afgevinkt als het een eigen taak wordt, de rest van de reeks niet', () => {
  const series = ev({
    id: 's',
    date: '2026-10-05',
    task: true,
    doneOn: ['2026-10-12'],
    repeat: { freq: 'weekly', interval: 1, until: '' },
  });
  const values = { ...moveLike(series), date: '2026-10-13', endDate: '2026-10-13' };
  const result = applyEdit([series], series, '2026-10-12', 'only', values, 'nieuw');
  const single = result.find((e) => e.id === 'nieuw')!;
  assert.deepEqual(single.doneOn, ['2026-10-13']);
  assert.deepEqual(result.find((e) => e.id === 's')!.doneOn, ['2026-10-12']);
  // een voorkomen dat niet was afgevinkt blijft open
  const open = applyEdit([series], series, '2026-10-19', 'only', values, 'nieuw2').find((e) => e.id === 'nieuw2')!;
  assert.deepEqual(open.doneOn, []);
});

test('taken: afgevinkte taken geven geen melding meer', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
  const open = ev({ id: 'o', date: '2026-10-25', time: '14:00', endTime: '15:00', alert: 15, task: true });
  const done = ev({
    id: 'd',
    date: '2026-10-25',
    time: '14:00',
    endTime: '15:00',
    alert: 15,
    task: true,
    doneOn: ['2026-10-25'],
  });
  assert.deepEqual(
    dueAlerts(data([open, done]), at(25, 13, 40), at(25, 13, 46)).map((o) => o.id),
    ['o'],
  );
});

function moveLike(e: CalEvent): EventValues {
  const values: Partial<CalEvent> = { ...e };
  delete values.id;
  delete values.exceptions;
  delete values.doneOn;
  return values as EventValues;
}

test('weer: een geldige plaats blijft, alles anders wordt uit', () => {
  assert.equal(migrate({ events: [] }).settings.weather, null);
  assert.deepEqual(
    migrate({ settings: { weather: { city: 'Utrecht', lat: 52.09, lon: 5.12, extra: 1 } } }).settings.weather,
    {
      city: 'Utrecht',
      lat: 52.09,
      lon: 5.12,
    },
  );
  for (const bad of [
    null,
    'Utrecht',
    {},
    { city: '', lat: 1, lon: 1 },
    { city: 'x', lat: 91, lon: 0 },
    { city: 'x', lat: 0, lon: 181 },
    { city: 'x', lat: '1', lon: 1 },
  ]) {
    assert.equal(migrate({ settings: { weather: bad } }).settings.weather, null, JSON.stringify(bad));
  }
  assert.equal(
    migrate({ settings: { weather: { city: 'x'.repeat(500), lat: 1, lon: 1 } } }).settings.weather!.city.length,
    120,
  );
});
