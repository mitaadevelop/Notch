import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { startWeather } from '../helpers/servers.ts';
import { clickMenu, expect, freezeTime, launchApp, settled, test } from './fixtures.ts';
import type { Launched } from './fixtures.ts';

async function withWeather<T>(run: (app: Launched, weather: Awaited<ReturnType<typeof startWeather>>) => Promise<T>) {
  const weather = await startWeather();
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-wx-')));
  const app = await launchApp(dir, [], { AGENDA_WEATHER_GEO: weather.url, AGENDA_WEATHER_API: weather.url });
  try {
    await freezeTime(app.window, '2026-10-26T10:00:00');
    await settled(app.window);
    return await run(app, weather);
  } finally {
    await app.app.close().catch(() => {});
    await weather.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const openPrefs = (app: Launched) => clickMenu(app.app, 'Voorkeuren…');
const badges = (page: Page) => page.locator('#view [role="img"][aria-label^="Weer:"]');

async function choosePlace(app: Launched, name = 'Utrecht') {
  await openPrefs(app);
  await app.window.locator('#s-wx-city').fill(name);
  await app.window.locator('#s-wx-search').click();
}

test.describe('weer per dag', () => {
  test('standaard staat het weer uit', async () => {
    await withWeather(async (app, weather) => {
      await app.window.locator('[data-view="month"]').click();
      await expect(badges(app.window)).toHaveCount(0);
      expect(weather.requests).toHaveLength(0); // niets naar buiten zonder dat de gebruiker erom vraagt
    });
  });

  test('een plaats kiezen toont het weer in de maand- en weekweergave, met uitleg bij de muis', async () => {
    await withWeather(async (app) => {
      await choosePlace(app);
      await expect(app.window.locator('#s-wx-status')).toHaveText('Weer voor Utrecht, Nederland.');
      await app.window.keyboard.press('Escape');
      await app.window.locator('[data-view="month"]').click();
      await expect(badges(app.window).first()).toBeVisible();
      await expect(badges(app.window)).toHaveCount(7); // 26 okt t/m 1 nov staan in dit maandoverzicht; verder weg is er nog geen verwachting
      const today = badges(app.window).first();
      await expect(today).toContainText('☀️ 14°');
      await expect(today).toHaveAttribute('title', 'helder, 14° / 6°, 10% kans op neerslag');
      await app.window.locator('[data-view="week"]').click();
      await expect(badges(app.window)).toHaveCount(7);
      await expect(badges(app.window).nth(1)).toContainText('🌧️ 13°');
    });
  });

  test('de plaats blijft na een herstart en het weer wordt weer opgehaald', async () => {
    await withWeather(async (app, weather) => {
      await choosePlace(app);
      await expect(app.window.locator('#s-wx-status')).toHaveText('Weer voor Utrecht, Nederland.');
      const before = weather.requests.filter((r) => r.path.startsWith('/v1/forecast')).length;
      await app.window.reload();
      await freezeTime(app.window, '2026-10-26T10:00:00');
      await app.window.locator('[data-view="month"]').click();
      await expect(badges(app.window).first()).toBeVisible();
      expect(weather.requests.filter((r) => r.path.startsWith('/v1/forecast')).length).toBeGreaterThan(before);
    });
  });

  test('een onbekende plaats geeft een melding en laat het weer uit', async () => {
    await withWeather(async (app) => {
      await choosePlace(app, 'Nergensburg');
      await expect(app.window.locator('#s-wx-status')).toContainText('Geen plaats gevonden');
      await app.window.keyboard.press('Escape');
      await app.window.locator('[data-view="month"]').click();
      await expect(badges(app.window)).toHaveCount(0);
    });
  });

  test('"Uit" haalt het weer weg; een weerdienst die uitvalt breekt de agenda niet', async () => {
    await withWeather(async (app, weather) => {
      await choosePlace(app);
      await app.window.keyboard.press('Escape');
      await app.window.locator('[data-view="month"]').click();
      await expect(badges(app.window).first()).toBeVisible();
      await openPrefs(app);
      await app.window.locator('#s-wx-off').click();
      await app.window.keyboard.press('Escape');
      await expect(badges(app.window)).toHaveCount(0);

      weather.state.forecastStatus = 500;
      await choosePlace(app);
      await expect(app.window.locator('#s-wx-status')).toHaveText('Weer voor Utrecht, Nederland.');
      await app.window.keyboard.press('Escape');
      await expect(app.window.locator('#view')).toBeVisible();
      await expect(badges(app.window)).toHaveCount(0);
      expect(app.consoleErrors).toEqual([]);
    });
  });
});
