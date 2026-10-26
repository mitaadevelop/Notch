import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// Tabt tot het element met dit id focus heeft (met een bovengrens, zodat een onbereikbaar element de test laat falen)
async function tabTo(page: Page, id: string, max = 150) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.id)) === id) {
      test.info().annotations.push({ type: `Tab-stops tot #${id}`, description: String(i + 1) });
      return i + 1;
    }
  }
  throw new Error(`#${id} is niet met Tab te bereiken (${max} keer geprobeerd)`);
}

test.describe('toetsenbordnavigatie', () => {
  test('afspraak maken met alleen Tab, Enter en tekst', async ({ mainWindow }) => {
    await tabTo(mainWindow, 'add');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#quick')).toBeVisible();
    await expect(mainWindow.locator('#q-input')).toBeFocused();

    await mainWindow.keyboard.type('Toetsenbord test 10:00');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#quick')).toBeHidden();
    await expect(mainWindow.locator('#day-list')).toContainText('Toetsenbord test');
  });

  test('zoeken is met Tab bereikbaar; Enter toont alle resultaten en Escape wist de zoekopdracht', async ({
    mainWindow,
  }) => {
    await tabTo(mainWindow, 'search');
    await mainWindow.keyboard.type('xyz');
    await expect(mainWindow.locator('#search-pop')).toBeVisible();
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#title')).toHaveText('Zoeken');
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.locator('#search')).toHaveValue('');
    await expect(mainWindow.locator('#title')).not.toHaveText('Zoeken');
  });

  test('de weergaveknoppen zijn bereikbaar en werken met Enter', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="week"]').focus();
    await mainWindow.keyboard.press('Tab'); // naar "Maand"
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('[data-view="month"]')).toHaveClass(/bg-seg/);
  });

  test('de afspraakdialoog: focus op de titel, Tab naar de volgende velden, Escape sluit', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await expect(mainWindow.locator('#e-title')).toBeFocused();
    await mainWindow.keyboard.press('Tab');
    await expect(mainWindow.locator('#e-location')).toBeFocused();
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.locator('#event-dialog')).toBeHidden();
  });

  test('Tab blijft binnen een open dialoog', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    for (let i = 0; i < 40; i++) {
      await mainWindow.keyboard.press('Tab');
      const inside = await mainWindow.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')));
      expect(inside, `Tab ${i + 1} verliet de dialoog`).toBe(true);
    }
  });
});
