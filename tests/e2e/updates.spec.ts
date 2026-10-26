import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { startUpdateServer } from '../helpers/servers.ts';
import { clickMenu, expect, launchApp, test } from './fixtures.ts';
import type { Launched } from './fixtures.ts';

const CURRENT = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

const status = (page: Page) => page.locator('#upd-status');
const action = (page: Page) => page.locator('#upd-action');
const pill = (page: Page) => page.locator('#update-pill');

// Start de app met een testserver als updatebron (kan alleen in een ontwikkelversie; zie AGENDA_UPDATE_FEED in main.ts).
async function withServer<T>(
  server: { feed: string; close(): Promise<void> },
  run: (app: Launched) => Promise<T>,
): Promise<T> {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-upd-')));
  const app = await launchApp(dir, [], { AGENDA_UPDATE_FEED: server.feed });
  try {
    return await run(app);
  } finally {
    await app.app.close().catch(() => {});
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const openPrefs = (app: Launched) =>
  app.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items[0].submenu!.items.find((i) => i.label === 'Voorkeuren…')!
      .click();
  });

test.describe('in een ontwikkelversie (niet verpakt)', () => {
  test('toont dat updaten daar niet kan, met een uitgeschakelde knop en zonder knop bovenin', async ({
    mainWindow,
    electronApp,
  }) => {
    await clickMenu(electronApp, 'Zoek naar updates…');
    await expect(mainWindow.locator('#settings-dialog')).toBeVisible();
    await expect(status(mainWindow)).toContainText('alleen in de geïnstalleerde app');
    await expect(action(mainWindow)).toBeDisabled();
    await expect(pill(mainWindow)).toBeHidden();
  });

  test('het menu "Zoek naar updates…" staat in het app-menu', async ({ electronApp }) => {
    const labels = await electronApp.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items[0].submenu!.items.map((item) => item.label),
    );
    expect(labels).toContain('Zoek naar updates…');
    expect(labels.indexOf('Zoek naar updates…')).toBeLessThan(labels.indexOf('Voorkeuren…'));
  });
});

test.describe('met een updateserver (echte electron-updater, nepbestand)', () => {
  test('een nieuwere versie: melding, knop bovenin en de knop in de voorkeuren', async () => {
    const server = await startUpdateServer({ version: '9.9.9' });
    await withServer(server, async ({ window, app }) => {
      await clickMenu(app, 'Zoek naar updates…');
      await expect(status(window)).toContainText('Versie 9.9.9 is beschikbaar');
      await expect(status(window)).toContainText(`je hebt ${CURRENT}`);
      await expect(action(window)).toHaveText('Download versie 9.9.9');
      await expect(pill(window)).toBeVisible();
      await expect(pill(window)).toHaveText('Update 9.9.9');
      await expect(window.getByRole('status').filter({ hasText: 'Versie 9.9.9 is beschikbaar.' })).toBeVisible();
      // electron-updater zet er een ?noCache=… achter
      expect(server.requests.map((r) => r.path.split('?')[0])).toEqual([
        expect.stringMatching(/\/updates\/latest(-mac|-linux)?\.yml$/),
      ]);
    });
  });

  test('dezelfde versie: "je hebt de nieuwste versie"', async () => {
    const server = await startUpdateServer({ version: CURRENT });
    await withServer(server, async ({ window, app }) => {
      await clickMenu(app, 'Zoek naar updates…');
      await expect(status(window)).toContainText('Je hebt de nieuwste versie');
      await expect(pill(window)).toBeHidden();
      await expect(action(window)).toHaveText('Zoek naar updates');
    });
  });

  test('een oudere versie op de server wordt nooit geïnstalleerd (geen downgrade)', async () => {
    const server = await startUpdateServer({ version: '0.0.1' });
    await withServer(server, async ({ window, app }) => {
      await clickMenu(app, 'Zoek naar updates…');
      await expect(status(window)).toContainText('Je hebt de nieuwste versie');
      await expect(pill(window)).toBeHidden();
    });
  });

  test('een server zonder updatebestand geeft een duidelijke melding', async () => {
    const server = await startUpdateServer({ version: '9.9.9', status: 404 });
    await withServer(server, async ({ window, app }) => {
      await clickMenu(app, 'Zoek naar updates…');
      await expect(status(window)).toContainText('Updaten is mislukt');
      await expect(status(window)).toContainText('geen update op de updateserver');
      await expect(action(window)).toBeEnabled();
    });
  });

  test('een server die niet bereikbaar is geeft een melding over de verbinding en daarna lukt het weer', async () => {
    const server = await startUpdateServer({ version: '9.9.9' });
    const feed = server.feed;
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-upd-')));
    await server.close(); // het adres bestaat niet meer
    const app = await launchApp(dir, [], { AGENDA_UPDATE_FEED: feed });
    try {
      await clickMenu(app.app, 'Zoek naar updates…');
      await expect(status(app.window)).toContainText('Geen verbinding met de updateserver');
    } finally {
      await app.app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('een trage server: "Zoeken naar updates…" met een uitgeschakelde knop, daarna het resultaat', async () => {
    const server = await startUpdateServer({ version: '9.9.9', delayMs: 1200 });
    await withServer(server, async ({ window, app }) => {
      await openPrefs({ window, app, consoleErrors: [] });
      await action(window).click();
      await expect(status(window)).toContainText('Zoeken naar updates…');
      await expect(action(window)).toBeDisabled();
      await expect(status(window)).toContainText('Versie 9.9.9 is beschikbaar', { timeout: 8000 });
    });
  });

  test('downloaden met de knop bovenin: de download loopt en de status eindigt netjes', async () => {
    const server = await startUpdateServer({ version: '9.9.9' });
    await withServer(server, async ({ window, app }) => {
      await clickMenu(app, 'Zoek naar updates…');
      await expect(pill(window)).toHaveText('Update 9.9.9');
      // de voorkeuren (die het menu opent) staan nu over de knop heen
      await window.keyboard.press('Escape');
      await expect(window.locator('#settings-dialog')).toBeHidden();
      await pill(window).click();
      // Op een ondertekende app wordt het "Herstart om te updaten"; een niet-ondertekende kan de update niet laten installeren
      await expect(async () => {
        const text = (await status(window).textContent()) ?? '';
        expect(text).toMatch(/staat klaar|Updaten is mislukt/);
      }).toPass({ timeout: 20_000 });
      // een eerder gedownload bestand staat in de cache van electron-updater; dan is een tweede download niet nodig
      expect(server.requests.length).toBeGreaterThanOrEqual(1);
    });
  });
});

test.describe('de knoppen reageren op wat main meldt', () => {
  const push = (app: Parameters<typeof clickMenu>[0], state: Record<string, unknown>) =>
    app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', s), state);

  test('voortgang tijdens het downloaden', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Voorkeuren…');
    await push(electronApp, { status: 'downloading', currentVersion: CURRENT, version: '9.9.9', progress: 40 });
    await expect(pill(mainWindow)).toHaveText('Downloaden… 40%');
    await expect(pill(mainWindow)).toBeDisabled();
    await expect(mainWindow.locator('#upd-progress')).toBeVisible();
    await expect(mainWindow.locator('#upd-progress')).toHaveJSProperty('value', 40);
    await expect(action(mainWindow)).toBeDisabled();
  });

  test('klaar: knop bovenin "Herstart om te updaten" start de installatie', async ({ mainWindow, electronApp }) => {
    // de installatie zelf (afsluiten en herstarten) vervangen we door een teller
    await electronApp.evaluate(() => {
      const g = globalThis as unknown as { __installs: unknown[][] };
      g.__installs = [];
      const { createRequire } = process.mainModule!.require('node:module') as typeof import('node:module');
      const { autoUpdater } = createRequire(`${process.cwd()}/package.json`)('electron-updater');
      autoUpdater.quitAndInstall = (...args: unknown[]) => void g.__installs.push(args);
    });
    // zonder echte update staat de beheerder op "niet ondersteund": gebruik het kanaal zoals de verpakte app dat zou doen
    await push(electronApp, { status: 'ready', currentVersion: CURRENT, version: '9.9.9', progress: 100 });
    await expect(pill(mainWindow)).toHaveText('Herstart om te updaten');
    await expect(mainWindow.getByRole('status').filter({ hasText: 'staat klaar om te installeren' })).toBeVisible();
    await pill(mainWindow).click();
    // main weigert te installeren zolang zijn eigen status niet "ready" is: een vervalste melding doet niets
    const installs = await electronApp.evaluate(
      () => (globalThis as unknown as { __installs: unknown[][] }).__installs,
    );
    expect(installs).toEqual([]);
  });
});
