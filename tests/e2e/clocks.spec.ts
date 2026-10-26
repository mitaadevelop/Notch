import { clickMenu, expect, freezeTime, settled, test } from './fixtures.ts';

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
  await mainWindow.locator('[data-view="week"]').click();
  await settled(mainWindow);
});

test.describe('extra tijdzones', () => {
  test('standaard geen extra kolommen; na kiezen verschijnt een kolom met de plaatsnaam', async ({
    mainWindow,
    electronApp,
  }) => {
    const header = mainWindow.locator('#view > div').first();
    await expect(header).not.toContainText('New York');
    await clickMenu(electronApp, 'Voorkeuren…');
    await mainWindow.locator('#s-clock1').selectOption('America/New_York');
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.locator('#view')).toContainText('New York');
    // de kolommen van de dagen blijven even breed en op één lijn met de kop
    const columns = mainWindow.locator('#view [data-col]');
    await expect(columns).toHaveCount(7);
    const widths = await columns.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
  });

  test('de tijd in de extra kolom klopt met de tijdzone', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Voorkeuren…');
    await mainWindow.locator('#s-clock1').selectOption('Asia/Tokyo');
    await mainWindow.keyboard.press('Escape');
    const expected = await mainWindow.evaluate(() =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(2026, 9, 26, 12)),
    );
    const labels = await mainWindow.locator('#view .overflow-y-auto > div > div:first-child span').allTextContents();
    expect(labels.some((t) => t.startsWith(expected))).toBe(true);
  });

  test('twee zones naast elkaar en weer weghalen', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Voorkeuren…');
    await mainWindow.locator('#s-clock1').selectOption('America/New_York');
    await mainWindow.locator('#s-clock2').selectOption('Asia/Tokyo');
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.locator('#view')).toContainText('New York');
    await expect(mainWindow.locator('#view')).toContainText('Tokio');
    await clickMenu(electronApp, 'Voorkeuren…');
    await mainWindow.locator('#s-clock1').selectOption('');
    await mainWindow.locator('#s-clock2').selectOption('');
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.locator('#view')).not.toContainText('New York');
  });
});
