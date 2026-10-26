import type { Page } from '@playwright/test';
import { expect, freezeTime, resizeWindow, settled, test } from './fixtures.ts';

const events = Array.from({ length: 9 }, (_, i) => ({
  id: String(i + 1),
  title: `Afspraak ${i + 1}`,
  date: '2026-10-21',
  endDate: '2026-10-21',
  calendarId: i % 2 ? 'work' : 'home',
  time: `${String(8 + i).padStart(2, '0')}:00`,
  endTime: `${String(9 + i).padStart(2, '0')}:00`,
}));

test.use({ initialFile: JSON.stringify({ version: 2, events }) });

const more = (page: Page) => page.getByRole('button', { name: /^\d+ meer…$/ });
const pop = (page: Page) => page.locator('#event-pop');

test.beforeEach(async ({ mainWindow, electronApp }) => {
  await resizeWindow(electronApp, 1000, 600);
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('"N meer…" in de maandweergave', () => {
  test('toont alle afspraken van die dag in een lijstje, zonder van weergave te wisselen', async ({ mainWindow }) => {
    await more(mainWindow).click();
    await expect(pop(mainWindow)).toBeVisible();
    await expect(pop(mainWindow)).toHaveAttribute('role', 'dialog');
    await expect(pop(mainWindow)).toContainText('woensdag 21 oktober');
    await expect(pop(mainWindow).getByRole('listitem')).toHaveCount(9);
    await expect(pop(mainWindow).getByRole('listitem').first()).toContainText('Afspraak 1');
    await expect(pop(mainWindow).getByRole('listitem').first()).toContainText('08:00–09:00');
    // nog steeds de maandweergave
    await expect(mainWindow.locator('[data-view="month"]')).toHaveClass(/bg-seg/);
  });

  test('een afspraak in het lijstje aanklikken opent hem en sluit het lijstje', async ({ mainWindow }) => {
    await more(mainWindow).click();
    await pop(mainWindow)
      .getByRole('button', { name: /Afspraak 8/ })
      .click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Afspraak 8');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('"Ga naar deze dag" opent de dagweergave', async ({ mainWindow }) => {
    await more(mainWindow).click();
    await pop(mainWindow).getByRole('button', { name: 'Ga naar deze dag' }).click();
    await expect(mainWindow.locator('[data-view="day"]')).toHaveClass(/bg-seg/);
    await expect(mainWindow.locator('#title')).toContainText('21 oktober');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Escape en buiten klikken sluiten het lijstje', async ({ mainWindow }) => {
    await more(mainWindow).click();
    await expect(pop(mainWindow)).toBeVisible();
    await mainWindow.keyboard.press('Escape');
    await expect(pop(mainWindow)).toHaveCount(0);
    await more(mainWindow).click();
    await mainWindow.mouse.click(5, 300);
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('het lijstje blijft binnen het venster', async ({ mainWindow }) => {
    await more(mainWindow).click();
    const box = (await pop(mainWindow).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
  });
});
