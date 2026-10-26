// Rooktest op de echt verpakte app (electron-builder, niet ondertekend). Eerst bouwen: `npm run pack:test`
// (of `npm run test:packaged`). Zonder bouwresultaat in release/ worden deze tests overgeslagen.
import { _electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startUpdateServer } from '../helpers/servers.ts';
import { expect, test } from './fixtures.ts';

const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

// zoekt de uitgepakte app in release/: { map, uitvoerbaar bestand, map met app-update.yml }
function findBuild() {
  const root = path.resolve('release');
  if (!existsSync(root)) return null;
  // bij een universele build (mac én mac-arm64) eerst de map die bij deze processor past
  const native = (dir: string) => dir.includes('arm64') === (process.arch === 'arm64');
  for (const dir of readdirSync(root).sort((a, b) => Number(native(b)) - Number(native(a)))) {
    const base = path.join(root, dir);
    const mac = path.join(base, 'Agenda.app');
    if (existsSync(mac))
      return {
        dir: base,
        exe: path.join('Agenda.app', 'Contents', 'MacOS', 'Agenda'),
        resources: path.join('Agenda.app', 'Contents', 'Resources'),
      };
    if (existsSync(path.join(base, 'Agenda.exe'))) return { dir: base, exe: 'Agenda.exe', resources: 'resources' };
    if (existsSync(path.join(base, 'agenda'))) return { dir: base, exe: 'agenda', resources: 'resources' };
  }
  return null;
}

const build = findBuild();
test.skip(!build, 'geen verpakte app in release/ (bouw eerst met `npm run pack:test`)');

let copy = '';

test.beforeAll(() => {
  if (!build) return;
  // werken op een kopie: we schrijven er een eigen app-update.yml in, en de gebouwde app blijft zo ongemoeid
  copy = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-packaged-')));
  if (process.platform === 'win32') cpSync(build.dir, copy, { recursive: true });
  else execFileSync('cp', ['-R', `${build.dir}/.`, copy]);
});

test.afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

// Wijst de verpakte app naar `feed` als updatebron, net zoals het bij het bouwen gemaakte app-update.yml dat doet.
function pointAt(feed: string) {
  const resources = path.join(copy, build!.resources);
  mkdirSync(resources, { recursive: true });
  writeFileSync(
    path.join(resources, 'app-update.yml'),
    `provider: generic\nurl: ${feed}\nupdaterCacheDirName: agenda-packaged-test\n`,
  );
}

async function launchPackaged(env: Record<string, string> = {}) {
  const userData = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-packaged-data-')));
  const app: ElectronApplication = await _electron.launch({
    executablePath: path.join(copy, build!.exe),
    args: [`--user-data-dir=${userData}`, ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<
        string,
        string
      >),
      ...env,
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const close = async () => {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  };
  return { app, window, close };
}

const status = (page: Page) => page.locator('#upd-status');
const checkNow = async (app: ElectronApplication, page: Page) => {
  await app.evaluate(({ Menu }) => {
    type Item = { label: string; click: () => void; submenu?: { items: Item[] } };
    const find = (items: Item[]): Item | undefined => {
      for (const item of items) {
        if (item.label === 'Zoek naar updates…') return item;
        const nested = item.submenu && find(item.submenu.items);
        if (nested) return nested;
      }
    };
    find(Menu.getApplicationMenu()!.items as unknown as Item[])!.click();
  });
  await expect(page.locator('#settings-dialog')).toBeVisible();
};

test.describe('de verpakte app', () => {
  test('start, heet "Agenda" en weet dat hij verpakt is', async () => {
    const server = await startUpdateServer({ version: VERSION });
    pointAt(server.feed);
    const { app, window, close } = await launchPackaged();
    try {
      await expect(window).toHaveTitle('Agenda');
      await expect(window.locator('#view [data-key]').first()).toBeVisible();
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
      expect(await app.evaluate(({ app }) => app.getName())).toBe('Agenda');
      expect(
        await window.evaluate(() =>
          (globalThis as unknown as { agenda: { getUpdateState(): Promise<unknown> } }).agenda.getUpdateState(),
        ),
      ).toMatchObject({
        status: 'idle',
        currentVersion: VERSION,
      });
    } finally {
      await close();
      await server.close();
    }
  });

  test('vindt een nieuwere versie op de updateserver (echte electron-updater, echt app-update.yml)', async () => {
    const server = await startUpdateServer({ version: '9.9.9' });
    pointAt(server.feed);
    const { app, window, close } = await launchPackaged();
    try {
      await checkNow(app, window);
      await expect(status(window)).toContainText('Versie 9.9.9 is beschikbaar');
      await expect(window.locator('#update-pill')).toHaveText('Update 9.9.9');
    } finally {
      await close();
      await server.close();
    }
  });

  test('zelfde versie op de server: je hebt de nieuwste', async () => {
    const server = await startUpdateServer({ version: VERSION });
    pointAt(server.feed);
    const { app, window, close } = await launchPackaged();
    try {
      await checkNow(app, window);
      await expect(status(window)).toContainText('Je hebt de nieuwste versie');
    } finally {
      await close();
      await server.close();
    }
  });

  test('AGENDA_UPDATE_FEED wordt in de verpakte app genegeerd: alleen het adres uit de build telt', async () => {
    const real = await startUpdateServer({ version: '9.9.9' });
    const decoy = await startUpdateServer({ version: '8.8.8' });
    pointAt(real.feed);
    const { app, window, close } = await launchPackaged({ AGENDA_UPDATE_FEED: decoy.feed });
    try {
      await checkNow(app, window);
      await expect(status(window)).toContainText('Versie 9.9.9 is beschikbaar');
      expect(decoy.requests).toEqual([]);
    } finally {
      await close();
      await real.close();
      await decoy.close();
    }
  });

  test('een server die niets heeft staan geeft een leesbare melding', async () => {
    const server = await startUpdateServer({ version: '9.9.9', status: 404 });
    pointAt(server.feed);
    const { app, window, close } = await launchPackaged();
    try {
      await checkNow(app, window);
      await expect(status(window)).toContainText('geen update op de updateserver');
    } finally {
      await close();
      await server.close();
    }
  });

  test('de app controleert zelf, zonder dat iemand iets doet, kort na het opstarten', async () => {
    test.setTimeout(60_000);
    const server = await startUpdateServer({ version: '9.9.9' });
    pointAt(server.feed);
    const { window, close } = await launchPackaged();
    try {
      await expect.poll(() => server.requests.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
      // een stille controle meldt een nieuwe versie met de knop bovenin, zonder dat de voorkeuren opengaan
      await expect(window.locator('#update-pill')).toHaveText('Update 9.9.9');
      await expect(window.locator('#settings-dialog')).toBeHidden();
    } finally {
      await close();
      await server.close();
    }
  });

  test('downloaden: de app haalt het bestand op en komt in "klaar" of een leesbare fout uit', async () => {
    const server = await startUpdateServer({ version: '9.9.9' });
    pointAt(server.feed);
    const { app, window, close } = await launchPackaged();
    try {
      await checkNow(app, window);
      await expect(window.locator('#update-pill')).toHaveText('Update 9.9.9');
      await window.keyboard.press('Escape');
      await window.locator('#update-pill').click();
      await expect(async () => {
        expect((await status(window).textContent()) ?? '').toMatch(/staat klaar|Updaten is mislukt/);
      }).toPass({ timeout: 30_000 });
      test.info().annotations.push({ type: 'uitkomst', description: (await status(window).textContent()) ?? '' });
    } finally {
      await close();
      await server.close();
    }
  });
});
