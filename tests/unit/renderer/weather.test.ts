import { fireEvent } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;
beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});
afterEach(() => vi.useRealTimers());

const place = { city: 'Utrecht, Nederland', lat: 52.091, lon: 5.122 };
const forecast = [
  { date: '2026-10-26', code: 0, max: 14, min: 6, rain: 10 },
  { date: '2026-10-27', code: 61, max: 13, min: 5, rain: 80 },
];

async function setup(withPlace = true) {
  const ctx = await freshModules();
  if (withPlace) ctx.state.data.settings.weather = place;
  const weather = await import('../../../src/js/weather.ts');
  return { ...ctx, weather };
}

describe('describeWeather', () => {
  test.each([
    [0, '☀️', 'helder'],
    [2, '🌤️', 'half bewolkt'],
    [3, '☁️', 'bewolkt'],
    [45, '🌫️', 'mist'],
    [53, '🌦️', 'motregen'],
    [63, '🌧️', 'regen'],
    [73, '🌨️', 'sneeuw'],
    [81, '🌧️', 'buien'],
    [86, '🌨️', 'sneeuwbuien'],
    [95, '⛈️', 'onweer'],
    [99, '⛈️', 'onweer'],
    [30, '☁️', 'wisselend'],
  ])('code %i -> %s %s', async (code, icon, label) => {
    const { weather } = await setup();
    expect(weather.describeWeather(code)).toEqual({ icon, label });
  });
});

describe('laden en tonen', () => {
  test('haalt de voorspelling op voor de gekozen plaats en tekent opnieuw', async () => {
    agenda.getForecast.mockResolvedValue(forecast);
    const { weather, state } = await setup();
    await weather.loadWeather();
    expect(agenda.getForecast).toHaveBeenCalledWith(52.091, 5.122);
    expect(weather.weatherFor('2026-10-27')).toMatchObject({ code: 61, max: 13 });
    expect(weather.weatherFor('2026-11-30')).toBeUndefined();
    expect(state.hooks.render).toHaveBeenCalled();
  });

  test('het blokje toont icoon en maximum, met een uitleg voor muis en schermlezer', async () => {
    agenda.getForecast.mockResolvedValue(forecast);
    const { weather } = await setup();
    await weather.loadWeather();
    const badge = weather.weatherBadge('2026-10-27', 'extra')!;
    expect(badge.textContent).toBe('🌧️ 13°');
    expect(badge.title).toBe('regen, 13° / 5°, 80% kans op neerslag');
    expect(badge.getAttribute('aria-label')).toBe('Weer: regen, 13 graden, 80 procent kans op neerslag');
    expect(badge.className).toContain('extra');
    expect(weather.weatherBadge('2026-12-01')).toBeNull();
  });

  test('zonder plaats: niets ophalen en geen blokje', async () => {
    const { weather } = await setup(false);
    await weather.loadWeather();
    expect(agenda.getForecast).not.toHaveBeenCalled();
    expect(weather.weatherBadge('2026-10-26')).toBeNull();
  });

  test('niet opnieuw ophalen zolang de voorspelling vers is, wel na een half uur of met force', async () => {
    agenda.getForecast.mockResolvedValue(forecast);
    const { weather } = await setup();
    await weather.loadWeather(false, 1_000_000);
    await weather.loadWeather(false, 1_000_000 + 29 * 60_000);
    expect(agenda.getForecast).toHaveBeenCalledTimes(1);
    await weather.loadWeather(false, 1_000_000 + 31 * 60_000);
    expect(agenda.getForecast).toHaveBeenCalledTimes(2);
    await weather.loadWeather(true, 1_000_000 + 32 * 60_000);
    expect(agenda.getForecast).toHaveBeenCalledTimes(3);
  });

  test('twee verzoeken tegelijk worden één', async () => {
    let release: (v: unknown) => void = () => {};
    agenda.getForecast.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { weather } = await setup();
    const a = weather.loadWeather();
    const b = weather.loadWeather(true);
    release(forecast);
    await Promise.all([a, b]);
    expect(agenda.getForecast).toHaveBeenCalledTimes(1);
  });

  test('een fout (geen internet) laat de agenda gewoon werken en probeert het later opnieuw', async () => {
    agenda.getForecast.mockRejectedValueOnce(new Error('geen verbinding'));
    const { weather } = await setup();
    await expect(weather.loadWeather()).resolves.toBeUndefined();
    expect(weather.weatherBadge('2026-10-26')).toBeNull();
    agenda.getForecast.mockResolvedValue(forecast);
    await weather.loadWeather();
    expect(weather.weatherFor('2026-10-26')).toBeDefined();
  });

  test('de plaats uitzetten wist het weer meteen', async () => {
    agenda.getForecast.mockResolvedValue(forecast);
    const { weather, state } = await setup();
    await weather.loadWeather();
    state.data.settings.weather = null;
    await weather.loadWeather();
    expect(weather.weatherFor('2026-10-26')).toBeUndefined();
  });

  test('een voorspelling voor een inmiddels vervangen plaats wordt weggegooid', async () => {
    let release: (v: unknown) => void = () => {};
    agenda.getForecast.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { weather, state } = await setup();
    const pending = weather.loadWeather();
    state.data.settings.weather = { city: 'Rome', lat: 41.9, lon: 12.5 };
    release(forecast);
    await pending;
    expect(weather.weatherFor('2026-10-26')).toBeUndefined();
  });
});

describe('voorkeuren', () => {
  const city = () => document.getElementById('s-wx-city') as HTMLInputElement;
  const status = () => document.getElementById('s-wx-status')!.textContent;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('zoeken bewaart de plaats en haalt direct het weer op', async () => {
    agenda.getForecast.mockResolvedValue(forecast);
    const { weather, state } = await setup(false);
    weather.initWeather();
    city().value = 'Utrecht';
    fireEvent.click(document.getElementById('s-wx-search')!);
    await flush();
    expect(agenda.geocode).toHaveBeenCalledWith('Utrecht');
    expect(state.data.settings.weather).toEqual({ city: 'Utrecht, Nederland', lat: 52.09, lon: 5.12 });
    expect(status()).toBe('Weer voor Utrecht, Nederland.');
    expect(agenda.getForecast).toHaveBeenCalled();
  });

  test('Enter in het veld zoekt ook; een te korte naam krijgt uitleg zonder netwerk', async () => {
    const { weather } = await setup(false);
    weather.initWeather();
    city().value = 'U';
    fireEvent.keyDown(city(), { key: 'Enter' });
    await flush();
    expect(agenda.geocode).not.toHaveBeenCalled();
    expect(status()).toBe('Typ de naam van een plaats.');
    city().value = 'Utrecht';
    fireEvent.keyDown(city(), { key: 'Enter' });
    await flush();
    expect(agenda.geocode).toHaveBeenCalledTimes(1);
  });

  test('een onbekende plaats toont de melding van main en bewaart niets', async () => {
    agenda.geocode.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'weather:geocode': Error: Geen plaats gevonden met de naam “Nergensburg”.",
      ),
    );
    const { weather, state } = await setup(false);
    weather.initWeather();
    city().value = 'Nergensburg';
    fireEvent.click(document.getElementById('s-wx-search')!);
    await flush();
    expect(status()).toBe('Geen plaats gevonden met de naam “Nergensburg”.');
    expect(state.data.settings.weather).toBeNull();
    expect((document.getElementById('s-wx-search') as HTMLButtonElement).disabled).toBe(false);
  });

  test('"Uit" zet het weer uit', async () => {
    const { weather, state } = await setup();
    weather.initWeather();
    weather.showWeatherSettings();
    expect(city().value).toBe('Utrecht, Nederland');
    fireEvent.click(document.getElementById('s-wx-off')!);
    expect(state.data.settings.weather).toBeNull();
    expect(status()).toBe('Het weer staat uit.');
    expect(city().value).toBe('');
  });
});
