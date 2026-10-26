import { expect, freezeTime, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      {
        id: '1',
        title: 'Tandarts',
        date: '2026-10-26',
        endDate: '2026-10-26',
        time: '14:00',
        endTime: '15:00',
        location: 'Utrecht',
        alert: 15,
        calendarId: 'home',
      },
    ],
  }),
});

test.beforeEach(async ({ mainWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await freezeTime(mainWindow, '2026-10-26T13:00:00');
});

const card = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Herinnering: Tandarts' });

test.describe('herinneringen met uitstellen', () => {
  test('op het ingestelde moment verschijnt een kaart met de details', async ({ mainWindow }) => {
    await mainWindow.clock.runFor(30 * 60_000);
    await expect(card(mainWindow)).toHaveCount(0);
    await mainWindow.clock.runFor(16 * 60_000); // 13:46: de melding van 13:45 is af
    await expect(card(mainWindow)).toBeVisible();
    await expect(card(mainWindow)).toContainText('Utrecht');
  });

  test('"Over 5 min" laat de kaart verdwijnen en komt na 5 minuten terug', async ({ mainWindow }) => {
    await mainWindow.clock.runFor(46 * 60_000);
    await card(mainWindow).getByRole('button', { name: 'Over 5 min' }).click();
    await expect(card(mainWindow)).toHaveCount(0);
    await mainWindow.clock.runFor(4 * 60_000);
    await expect(card(mainWindow)).toHaveCount(0);
    await mainWindow.clock.runFor(90_000);
    await expect(card(mainWindow)).toBeVisible();
  });

  test('"Sluiten" doet niets terugkomen, en de titel opent de afspraak in de dagweergave', async ({ mainWindow }) => {
    await mainWindow.clock.runFor(46 * 60_000);
    await card(mainWindow).getByRole('button', { name: 'Sluiten' }).click();
    await mainWindow.clock.runFor(2 * 3600_000);
    await expect(card(mainWindow)).toHaveCount(0);
  });

  test('klikken op de titel opent de dag met de afspraak geselecteerd', async ({ mainWindow }) => {
    await mainWindow.clock.runFor(46 * 60_000);
    await card(mainWindow).getByRole('button', { name: 'Tandarts' }).click();
    await expect(card(mainWindow)).toHaveCount(0);
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Tandarts' })).toBeVisible();
  });
});
