import { afterEach, describe, expect, test } from 'vitest';
import { fetchForecast, geocode, validCoordinates } from '../../../src/weather.ts';
import { startWeather } from '../../helpers/servers.ts';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const weather = async () => {
  const s = await startWeather();
  servers.push(s);
  return s;
};

describe('validCoordinates', () => {
  test.each([
    [52.1, 5.1],
    [0, 0],
    [-90, 180],
    [90, -180],
  ])('geldig: %f, %f', (a, b) => expect(validCoordinates(a, b)).toBe(true));
  test.each([
    [91, 0],
    [0, 181],
    [NaN, 0],
    [Infinity, 0],
    ['52', '5'],
    [null, 5],
    [undefined, undefined],
  ])('ongeldig: %j, %j', (a, b) => expect(validCoordinates(a, b)).toBe(false));
});

describe('geocode', () => {
  test('zoekt een plaats en geeft naam, breedte- en lengtegraad (afgerond)', async () => {
    const s = await weather();
    expect(await geocode('  Utrecht ', s.url)).toEqual({ city: 'Utrecht, Nederland', lat: 52.091, lon: 5.122 });
    expect(s.requests[0].path).toContain('name=Utrecht');
    expect(s.requests[0].path).toContain('language=nl');
  });

  test('de regio staat erbij als die anders is dan de plaats', async () => {
    const s = await weather();
    s.state.places.deventer = {
      name: 'Deventer',
      admin1: 'Overijssel',
      country: 'Nederland',
      latitude: 52.25,
      longitude: 6.16,
    };
    expect((await geocode('Deventer', s.url)).city).toBe('Deventer, Overijssel, Nederland');
  });

  test('een onbekende plaats, te korte of te lange invoer en onzin worden geweigerd zonder netwerk', async () => {
    const s = await weather();
    await expect(geocode('Nergensburg', s.url)).rejects.toThrow('Geen plaats gevonden');
    for (const bad of ['', 'a', '  ', 'x'.repeat(101), null, undefined, 5, {}]) {
      await expect(geocode(bad, s.url)).rejects.toThrow('Typ de naam');
    }
    expect(s.requests).toHaveLength(1); // alleen "Nergensburg" ging naar buiten
  });

  test('een kapotte of foute respons geeft een duidelijke melding', async () => {
    const s = await weather();
    s.state.geoStatus = 500;
    await expect(geocode('Utrecht', s.url)).rejects.toThrow('(500)');
    s.state.geoStatus = 429;
    await expect(geocode('Utrecht', s.url)).rejects.toThrow('Te veel verzoeken');
    s.state.geoStatus = 200;
    s.state.places.kapot = { name: 'Kapot', latitude: 'x', longitude: 5 };
    await expect(geocode('kapot', s.url)).rejects.toThrow('Geen plaats gevonden');
  });

  test('speciale tekens in de naam gaan veilig mee in de zoekopdracht', async () => {
    const s = await weather();
    await geocode('Zürich & omgeving?x=1', s.url).catch(() => {});
    const url = new URL(s.requests[0].path, 'http://x');
    expect(url.searchParams.get('name')).toBe('Zürich & omgeving?x=1');
    expect([...url.searchParams.keys()].sort()).toEqual(['count', 'format', 'language', 'name']);
  });
});

describe('fetchForecast', () => {
  test('veertien dagen met code, temperaturen en neerslagkans, als hele getallen', async () => {
    const s = await weather();
    const days = await fetchForecast(52.091, 5.122, s.url);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: '2026-10-26', code: 0, max: 14, min: 6, rain: 10 });
    expect(days[1]).toEqual({ date: '2026-10-27', code: 61, max: 13, min: 5, rain: 80 });
    expect(s.requests[0].path).toContain('latitude=52.091');
    expect(s.requests[0].path).toContain('timezone=auto');
  });

  test('onbruikbare dagen worden overgeslagen; zonder bruikbare dagen een fout', async () => {
    const s = await weather();
    s.state.days = {
      daily: {
        time: ['2026-10-26', 'morgen', '2026-10-28'],
        weather_code: [1, 2, null],
        temperature_2m_max: [10.6, 11, 12],
        temperature_2m_min: [3.4, 4, 5],
        precipitation_probability_max: [150, 20, 30],
      },
    };
    expect(await fetchForecast(1, 1, s.url)).toEqual([{ date: '2026-10-26', code: 1, max: 11, min: 3, rain: 100 }]);
    s.state.days = { daily: { time: [] } };
    await expect(fetchForecast(1, 1, s.url)).rejects.toThrow('geen voorspelling');
    s.state.days = {};
    await expect(fetchForecast(1, 1, s.url)).rejects.toThrow('geen voorspelling');
  });

  test('ongeldige locatie gaat niet naar buiten; serverfouten worden gemeld', async () => {
    const s = await weather();
    await expect(fetchForecast(200, 5, s.url)).rejects.toThrow('Ongeldige locatie');
    await expect(fetchForecast('52', '5', s.url)).rejects.toThrow('Ongeldige locatie');
    expect(s.requests).toHaveLength(0);
    s.state.forecastStatus = 503;
    await expect(fetchForecast(52, 5, s.url)).rejects.toThrow('(503)');
  });
});
