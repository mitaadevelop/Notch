import type { Page } from '@playwright/test';
import { clickMenu, expect, freezeTime, settled, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      {
        id: '1',
        title: 'Tandarts',
        date: '2026-11-02',
        endDate: '2026-11-02',
        calendarId: 'home',
        time: '14:00',
        endTime: '15:00',
      },
    ],
  }),
});

const palette = (page: Page) => page.locator('#palette');
const input = (page: Page) => page.getByRole('combobox', { name: /Zoek een opdracht/ });
const options = (page: Page) => palette(page).getByRole('option');

async function open(page: Page, app: Parameters<typeof clickMenu>[0]) {
  await clickMenu(app, 'Commandopalet…');
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('commandopalet (⌘K)', () => {
  test('opent met alle opdrachten en sluit met Escape', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    expect(await options(mainWindow).count()).toBeGreaterThan(10);
    await expect(options(mainWindow).first()).toHaveAttribute('aria-selected', 'true');
    await mainWindow.keyboard.press('Escape');
    await expect(palette(mainWindow)).toBeHidden();
  });

  test('een opdracht typen en met Enter uitvoeren: naar de weekweergave', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('weergave week');
    await expect(options(mainWindow).first()).toContainText('Weergave: week');
    await mainWindow.keyboard.press('Enter');
    await expect(palette(mainWindow)).toBeHidden();
    await expect(mainWindow.locator('[data-view="week"]')).toHaveClass(/bg-seg/);
  });

  test('naar een datum springen', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('ga naar 3 november');
    await expect(options(mainWindow).first()).toContainText('Ga naar dinsdag 3 november');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#day-title')).toContainText('dinsdag 3 november');
    await expect(mainWindow.locator('#title')).toContainText('november');
  });

  test('een afspraak zoeken en openen', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('tandarts');
    await expect(options(mainWindow).first()).toContainText('Tandarts');
    await expect(options(mainWindow).first()).toContainText('2 nov');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Tandarts');
  });

  test('in gewone taal een afspraak maken, met melding en ongedaan maken', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('Lunch met Sam morgen 12:30');
    await expect(options(mainWindow).first()).toContainText('Maak afspraak “Lunch met Sam”');
    await expect(options(mainWindow).first()).toContainText('12:30');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Lunch met Sam' })).toBeVisible();
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak toegevoegd');
    await expect(mainWindow.locator('#day-title')).toContainText('dinsdag 27 oktober');

    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Lunch met Sam' })).toHaveCount(0);
  });

  test('met de pijltjes kiezen, de muis werkt ook', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.press('ArrowDown');
    await expect(options(mainWindow).nth(1)).toHaveAttribute('aria-selected', 'true');
    await mainWindow.keyboard.press('ArrowUp');
    await mainWindow.keyboard.press('ArrowUp'); // rondom naar het laatste
    const count = await options(mainWindow).count();
    await expect(options(mainWindow).nth(count - 1)).toHaveAttribute('aria-selected', 'true');
    await options(mainWindow).filter({ hasText: 'Weergave: jaar' }).click();
    await expect(mainWindow.locator('[data-view="year"]')).toHaveClass(/bg-seg/);
  });

  test('buiten het palet klikken sluit het', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    await mainWindow.mouse.click(5, 5);
    await expect(palette(mainWindow)).toBeHidden();
  });

  test('met een andere dialoog open opent het palet niet', async ({ mainWindow, electronApp }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await clickMenu(electronApp, 'Commandopalet…');
    await mainWindow.waitForTimeout(300);
    await expect(palette(mainWindow)).toBeHidden();
  });

  test('opdrachten die van de weergave afhangen: uurhoogte alleen in dag en week', async ({
    mainWindow,
    electronApp,
  }) => {
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('uren');
    await expect(options(mainWindow).filter({ hasText: 'Uren groter' })).toHaveCount(0);
    await mainWindow.keyboard.press('Escape');
    await mainWindow.locator('[data-view="week"]').click();
    await open(mainWindow, electronApp);
    await mainWindow.keyboard.type('uren');
    await expect(options(mainWindow).filter({ hasText: 'Uren groter' })).toHaveCount(1);
  });
});
