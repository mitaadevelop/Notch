import { choose, expect, freezeTime, recordMenus, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [{ id: '1', title: 'Tandarts', date: '2026-10-14', endDate: '2026-10-14', calendarId: 'home' }],
  }),
});

const chip = (page: import('@playwright/test').Page, title: string) =>
  page.locator('#view [data-okey]', { hasText: title });
const dateOf = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => ((await window.agenda.load()) as { events: { date: string }[] }).events[0]?.date);

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
});

test.describe('melding met "Ongedaan maken"', () => {
  test('na het verplaatsen zet de knop de afspraak terug', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').dragTo(mainWindow.locator('#view [data-key="2026-10-16"]'));
    const toast = mainWindow.getByRole('status');
    await expect(toast).toContainText('Afspraak verplaatst');
    await expect.poll(() => dateOf(mainWindow)).toBe('2026-10-16');

    await toast.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(() => dateOf(mainWindow)).toBe('2026-10-14');
    await expect(toast).toBeHidden();
    await expect(chip(mainWindow, 'Tandarts')).toBeVisible();
  });

  test('na verwijderen komt de afspraak terug met één klik', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').click();
    await mainWindow.keyboard.press('Delete');
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak verwijderd');
    await expect(chip(mainWindow, 'Tandarts')).toHaveCount(0);
    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(chip(mainWindow, 'Tandarts')).toBeVisible();
  });

  test('een nieuwe melding vervangt de vorige', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').dragTo(mainWindow.locator('#view [data-key="2026-10-15"]'));
    await expect(mainWindow.getByRole('status')).toContainText('verplaatst');
    await chip(mainWindow, 'Tandarts').click();
    await mainWindow.keyboard.press('Delete');
    await expect(mainWindow.getByRole('status')).toHaveCount(1);
    await expect(mainWindow.getByRole('status')).toContainText('verwijderd');
  });

  test('plakken en kopiëren melden dat ook', async ({ mainWindow, electronApp }) => {
    await recordMenus(electronApp);
    await choose(electronApp, 'Kopieer');
    await chip(mainWindow, 'Tandarts').click({ button: 'right' });
    await choose(electronApp, 'Plak');
    await mainWindow.locator('#view [data-key="2026-10-20"]').click({ button: 'right' });
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak geplakt');
  });

  test('de melding verdwijnt vanzelf', async ({ mainWindow }) => {
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Snel', date: '2026-10-20' });
    });
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak toegevoegd');
    await expect(mainWindow.getByRole('status')).toBeHidden({ timeout: 9000 });
  });
});
