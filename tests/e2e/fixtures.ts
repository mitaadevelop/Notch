import { _electron, expect, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd(); // npm-scripts draaien vanuit de projectmap

export interface Launched {
  app: ElectronApplication;
  window: Page;
  consoleErrors: string[];
}

// Start de gebouwde app met een eigen userData-map, zodat nooit echte gebruikersdata geraakt wordt.
export async function launchApp(
  userDataDir: string,
  extraArgs: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<Launched> {
  const consoleErrors: string[] = [];
  const app = await _electron.launch({
    cwd: root,
    // '.' laadt "main" uit package.json (dist/main.js)
    args: [
      '.',
      `--user-data-dir=${userDataDir}`,
      // op Linux-CI draait Chromium zonder SUID-sandbox
      ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []),
      ...extraArgs,
    ],
    // standaard op de achtergrond (geen venster dat de focus pakt); AGENDA_VISIBLE=1 laat het venster zien
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ...(process.env.AGENDA_VISIBLE ? {} : { AGENDA_BACKGROUND: '1' }),
      ...extraEnv,
    },
  });
  // luisteraars vóór het laden van de pagina aanhaken, anders missen we fouten bij het opstarten
  app.on('window', (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
  });
  // vangnet: tests mogen nooit de echte gebruikersdata raken
  const actual = await app.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actual) !== path.resolve(userDataDir)) {
    await app.close();
    throw new Error(`userData wijst naar ${actual} in plaats van ${userDataDir}`);
  }
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, consoleErrors };
}

// zet de binnenkant van het venster op een vaste grootte (voor responsive- en screenshottests)
export async function resizeWindow(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

// zet de klok van de pagina op een vast moment en laadt opnieuw, zodat "vandaag" en de tijdlijn stilstaan
export async function freezeTime(page: Page, iso: string) {
  await page.clock.install({ time: new Date(iso) });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// wacht tot alle lopende animaties klaar zijn, zodat posities die een test meet ook echt blijven staan
export async function settled(page: Page) {
  await page.evaluate(async () => {
    // oneindige animaties (de pulserende "nu"-bol, een draaiende vernieuwknop) zijn nooit "klaar": die slaan we over
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
  });
}

// klikt een menu-item (op label) in de menubalk van de app, zoals een gebruiker zou doen
export function clickMenu(app: ElectronApplication, label: string) {
  return app.evaluate(({ Menu }, wanted) => {
    type Item = { label: string; click: () => void; submenu?: { items: Item[] } };
    const find = (items: Item[]): Item | undefined => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const nested = item.submenu && find(item.submenu.items);
        if (nested) return nested;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()!.items as unknown as Item[]);
    if (!item) throw new Error(`menu-item "${wanted}" bestaat niet`);
    item.click();
  }, label);
}

// Vervangt het native contextmenu door een opname: welke items werden getoond, en kies er automatisch één.
export async function recordMenus(app: ElectronApplication) {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as unknown as { __menus: { label: string; enabled: boolean }[][]; __choose: string | null };
    g.__menus = [];
    g.__choose = null;
    const original = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => {
      const menu = original(template);
      menu.popup = (options) => {
        g.__menus.push(
          template
            .filter((t) => t.type !== 'separator')
            .map((t) => ({ label: String(t.label), enabled: t.enabled !== false })),
        );
        const pick = template.find((t) => t.label === g.__choose);
        if (pick && pick.enabled !== false) (pick.click as () => void)();
        else options?.callback?.();
      };
      return menu;
    };
  });
}
export const choose = (app: ElectronApplication, label: string | null) =>
  app.evaluate((_, l) => ((globalThis as unknown as { __choose: string | null }).__choose = l), label);
export const shownMenus = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __menus: { label: string; enabled: boolean }[][] }).__menus);

interface Fixtures {
  /** Lege tijdelijke userData-map (wordt na afloop verwijderd). */
  userDataDir: string;
  /** Inhoud van events.json vóór de start (ruwe tekst, zodat ook kapotte bestanden kunnen). Standaard: geen bestand. */
  initialFile: string | undefined;
  /** Extra omgevingsvariabelen voor de app (bijv. AGENDA_UPDATE_FEED). */
  appEnv: Record<string, string>;
  launched: Launched;
  electronApp: ElectronApplication;
  mainWindow: Page;
  consoleErrors: string[];
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright eist een destructuring-patroon
  userDataDir: async ({}, use) => {
    // realpath: op macOS is /var een symlink naar /private/var
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-e2e-')));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  initialFile: [undefined, { option: true }],
  appEnv: [{}, { option: true }],
  launched: async ({ userDataDir, initialFile, appEnv }, use) => {
    if (initialFile !== undefined) writeFileSync(path.join(userDataDir, 'events.json'), initialFile);
    const launched = await launchApp(userDataDir, [], appEnv);
    await use(launched);
    await launched.app.close().catch(() => {});
  },
  electronApp: async ({ launched }, use) => use(launched.app),
  mainWindow: async ({ launched }, use) => use(launched.window),
  consoleErrors: async ({ launched }, use) => use(launched.consoleErrors),
});

export { expect };
