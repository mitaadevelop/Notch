import { expect, test } from './fixtures.ts';

// De app volgt het systeemthema (prefers-color-scheme); beide varianten moeten werken.
const canvas = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    background: getComputedStyle(document.querySelector('main')!).backgroundColor,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
  }));

test.describe('licht en donker thema', () => {
  test('licht: witte achtergrond', async ({ mainWindow }) => {
    await mainWindow.emulateMedia({ colorScheme: 'light' });
    expect(await canvas(mainWindow)).toEqual({ background: 'rgb(255, 255, 255)', dark: false });
  });

  test('donker: donkere achtergrond', async ({ mainWindow }) => {
    await mainWindow.emulateMedia({ colorScheme: 'dark' });
    expect(await canvas(mainWindow)).toEqual({ background: 'rgb(30, 30, 30)', dark: true });
  });

  test('wisselen tijdens het draaien past meteen aan, zonder fouten', async ({ mainWindow, consoleErrors }) => {
    await mainWindow.emulateMedia({ colorScheme: 'dark' });
    await mainWindow.emulateMedia({ colorScheme: 'light' });
    await expect(mainWindow.locator('#view [data-key]').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('responsive', () => {
  for (const [name, size] of [
    ['klein (minimum)', { width: 1000, height: 600 }],
    ['groot', { width: 1600, height: 1000 }],
  ] as const) {
    test(`${name}: geen horizontale scroll en de kernbediening is zichtbaar`, async ({ mainWindow, electronApp }) => {
      await electronApp.evaluate(
        ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height),
        size,
      );
      await expect(mainWindow.locator('#add')).toBeVisible();
      await expect(mainWindow.locator('#search')).toBeVisible();
      await expect(mainWindow.locator('[data-view="month"]')).toBeVisible();
      const overflow = await mainWindow.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
