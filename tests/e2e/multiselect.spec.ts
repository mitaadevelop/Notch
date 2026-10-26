import type { Page } from '@playwright/test';
import { choose, clickMenu, expect, freezeTime, recordMenus, settled, test } from './fixtures.ts';

const ev = (id: string, title: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  date,
  endDate: date,
  calendarId: 'home',
  ...extra,
});

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      ev('1', 'Een', '2026-10-14'),
      ev('2', 'Twee', '2026-10-15'),
      ev('3', 'Drie', '2026-10-21'),
      ev('4', 'Reeks', '2026-10-13', { repeat: { freq: 'weekly', interval: 1, until: '' } }),
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}`) });
const day = (page: Page, key: string) => page.locator(`#view [data-key="${key}"]`);
const stored = (page: Page) =>
  page.evaluate(async () => ((await window.agenda.load()) as { events: { title: string; date: string }[] }).events);
const datesOf = async (page: Page, title: string) =>
  (await stored(page))
    .filter((e) => e.title === title)
    .map((e) => e.date)
    .sort();
const badge = (page: Page) => page.locator('#sel-info');

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('selecteren van meerdere afspraken', () => {
  test('⇧-klik telt afspraken op, een gewone klik vervangt de selectie, Escape wist hem', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await expect(chip(mainWindow, 'Een')).toHaveClass(/ring-2/);
    await expect(chip(mainWindow, 'Twee')).toHaveClass(/ring-2/);
    await expect(badge(mainWindow)).toHaveText('2 geselecteerd');
    await mainWindow.waitForTimeout(500);
    await expect(mainWindow.locator('#event-pop')).toHaveCount(0); // geen kaartje bij meerdere

    await chip(mainWindow, 'Drie').click({ modifiers: ['Meta'] });
    await expect(badge(mainWindow)).toHaveText('3 geselecteerd');
    // nog een keer: weer eraf
    await chip(mainWindow, 'Drie').click({ modifiers: ['Meta'] });
    await expect(badge(mainWindow)).toHaveText('2 geselecteerd');
    await expect(chip(mainWindow, 'Drie')).not.toHaveClass(/ring-2/);

    await chip(mainWindow, 'Drie').click();
    await expect(chip(mainWindow, 'Een')).not.toHaveClass(/ring-2/);
    await expect(badge(mainWindow)).toBeHidden();

    await mainWindow.keyboard.press('Escape'); // selectie
    await expect(chip(mainWindow, 'Drie')).not.toHaveClass(/ring-2/);
  });

  test('⌘A (menu Selecteer alles) selecteert alles wat te zien is', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Selecteer alles');
    const count = await mainWindow.locator('#view [data-okey].ring-2').count();
    expect(count).toBeGreaterThanOrEqual(4);
    await expect(badge(mainWindow)).toHaveText(`${count} geselecteerd`);
  });

  test('Delete verwijdert de hele selectie in één stap met één melding en één ongedaan maken', async ({
    mainWindow,
  }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await mainWindow.keyboard.press('Delete');
    await expect(mainWindow.getByRole('status').filter({ hasText: 'afspraken verwijderd' })).toContainText(
      '2 afspraken verwijderd',
    );
    await expect(chip(mainWindow, 'Een')).toHaveCount(0);
    await expect(chip(mainWindow, 'Twee')).toHaveCount(0);
    await expect(chip(mainWindow, 'Drie')).toBeVisible();

    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(chip(mainWindow, 'Een')).toBeVisible();
    await expect(chip(mainWindow, 'Twee')).toBeVisible();
  });

  test('een van de selectie slepen verhuist ze allemaal evenveel dagen', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await chip(mainWindow, 'Een').dragTo(day(mainWindow, '2026-10-16')); // twee dagen verder
    await expect.poll(() => datesOf(mainWindow, 'Een')).toEqual(['2026-10-16']);
    await expect.poll(() => datesOf(mainWindow, 'Twee')).toEqual(['2026-10-17']);
    await expect(mainWindow.getByRole('status')).toContainText('2 afspraken verplaatst');

    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(() => datesOf(mainWindow, 'Een')).toEqual(['2026-10-14']);
    await expect.poll(() => datesOf(mainWindow, 'Twee')).toEqual(['2026-10-15']);
  });

  test('met Alt slepen kopieert de hele selectie', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await mainWindow.keyboard.down('Alt');
    await chip(mainWindow, 'Een').dragTo(day(mainWindow, '2026-10-19'));
    await mainWindow.keyboard.up('Alt');
    await expect.poll(() => datesOf(mainWindow, 'Een')).toEqual(['2026-10-14', '2026-10-19']);
    await expect.poll(() => datesOf(mainWindow, 'Twee')).toEqual(['2026-10-15', '2026-10-20']);
    await expect(mainWindow.getByRole('status')).toContainText('2 kopieën gemaakt');
  });

  test('kopiëren en plakken behoudt de afstand tussen de afspraken', async ({ mainWindow, electronApp }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await clickMenu(electronApp, 'Kopieer');
    await expect(mainWindow.getByText('2 afspraken gekopieerd.')).toBeVisible();

    await recordMenus(electronApp);
    await choose(electronApp, 'Plak');
    await day(mainWindow, '2026-10-22').click({ button: 'right' });
    await expect.poll(() => datesOf(mainWindow, 'Een')).toEqual(['2026-10-14', '2026-10-22']);
    await expect.poll(() => datesOf(mainWindow, 'Twee')).toEqual(['2026-10-15', '2026-10-23']);
    await expect(mainWindow.getByRole('status')).toContainText('2 afspraken geplakt');
  });

  test('een herhalende afspraak in de selectie vraagt één keer om het bereik', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Reeks')
      .first()
      .click({ modifiers: ['Shift'] });
    await mainWindow.keyboard.press('Delete');
    const scope = mainWindow.locator('#scope-dialog');
    await expect(scope).toBeVisible();
    await scope.getByRole('button', { name: 'Alle afspraken' }).click();
    await expect(chip(mainWindow, 'Een')).toHaveCount(0);
    await expect(chip(mainWindow, 'Reeks')).toHaveCount(0);
    await expect.poll(async () => (await stored(mainWindow)).map((e) => e.title).sort()).toEqual(['Drie', 'Twee']);
  });

  test('annuleren in de bereikkeuze laat alles staan', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Reeks')
      .first()
      .click({ modifiers: ['Shift'] });
    await mainWindow.keyboard.press('Delete');
    await mainWindow.locator('#scope-dialog').getByRole('button', { name: 'Annuleer' }).click();
    await expect(chip(mainWindow, 'Een')).toBeVisible();
    expect((await stored(mainWindow)).length).toBe(4);
  });

  test('de selectie overleeft een verversing van de weergave', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Erbij', date: '2026-10-22' });
    });
    await expect(chip(mainWindow, 'Erbij')).toBeVisible();
    await expect(chip(mainWindow, 'Een')).toHaveClass(/ring-2/);
    await expect(chip(mainWindow, 'Twee')).toHaveClass(/ring-2/);
    await expect(badge(mainWindow)).toHaveText('2 geselecteerd');
  });

  test('een andere dag kiezen wist de selectie', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await day(mainWindow, '2026-10-20').click();
    await expect(badge(mainWindow)).toBeHidden();
    await expect(chip(mainWindow, 'Een')).not.toHaveClass(/ring-2/);
  });
});
