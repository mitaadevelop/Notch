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
      ev('t1', 'Belasting doen', '2026-10-27', { task: true }),
      ev('t2', 'Plant water', '2026-10-26', { task: true, repeat: { freq: 'daily', interval: 1, until: '' } }),
      ev('a', 'Overleg', '2026-10-28', { time: '10:00', endTime: '11:30' }),
      ev('b', 'Lunch', '2026-10-28', { time: '12:00', endTime: '13:00', calendarId: 'work' }),
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: title }).first();
const stored = (page: Page) =>
  page.evaluate(
    async () =>
      (await window.agenda.load()) as { events: Record<string, unknown>[]; settings: Record<string, unknown> },
  );

async function palette(page: Page, app: Parameters<typeof clickMenu>[0], query: string) {
  await clickMenu(app, 'Commandopalet…');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.type(query);
}

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
  await mainWindow.locator('[data-view="month"]').click();
  await settled(mainWindow);
});

test.describe('taken', () => {
  test('een taak heeft een rondje; klikken vinkt af (doorgestreept) en ongedaan maken opent weer', async ({
    mainWindow,
  }) => {
    const task = chip(mainWindow, 'Belasting doen');
    await expect(task.locator('[data-task-check]')).toHaveText('');
    await task.locator('[data-task-check]').click();
    await expect(mainWindow.getByRole('status')).toContainText('Taak afgevinkt');
    await expect(task.locator('[data-task-check]')).toHaveText('✓');
    await expect(task).toHaveClass(/line-through/);
    expect((await stored(mainWindow)).events.find((e) => e.id === 't1')?.doneOn).toEqual(['2026-10-27']);
    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(task.locator('[data-task-check]')).toHaveText('');
  });

  test('bij een herhalende taak wordt alleen die dag afgevinkt', async ({ mainWindow }) => {
    const cells = mainWindow.locator('#view [data-okey]', { hasText: 'Plant water' });
    await cells.nth(2).locator('[data-task-check]').click(); // de 28e
    await expect(cells.nth(2).locator('[data-task-check]')).toHaveText('✓');
    await expect(cells.nth(1).locator('[data-task-check]')).toHaveText('');
    expect((await stored(mainWindow)).events.find((e) => e.id === 't2')?.doneOn).toEqual(['2026-10-28']);
  });

  test('het contextmenu biedt "Markeer als gedaan" bij een taak en niet bij een gewone afspraak', async ({
    mainWindow,
    electronApp,
  }) => {
    await recordMenus(electronApp);
    await chip(mainWindow, 'Overleg').click({ button: 'right' });
    await expect
      .poll(() =>
        electronApp.evaluate(() => (globalThis as unknown as { __menus: { label: string }[][] }).__menus.length),
      )
      .toBe(1);
    const plain = await electronApp.evaluate(() =>
      (globalThis as unknown as { __menus: { label: string }[][] }).__menus[0].map((i) => i.label),
    );
    expect(plain).not.toContain('Markeer als gedaan');

    await choose(electronApp, 'Markeer als gedaan');
    await chip(mainWindow, 'Belasting doen').click({ button: 'right' });
    await expect(chip(mainWindow, 'Belasting doen').locator('[data-task-check]')).toHaveText('✓');
  });

  test('"Nieuwe taak" in het palet opent de dialoog met Taak aangevinkt en hele dag', async ({
    mainWindow,
    electronApp,
  }) => {
    await palette(mainWindow, electronApp, 'nieuwe taak');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-task')).toBeChecked();
    await expect(mainWindow.locator('#e-allday')).toBeChecked();
    await mainWindow.locator('#e-title').fill('Rapport schrijven');
    await mainWindow.locator('#e-save').click();
    await expect(chip(mainWindow, 'Rapport schrijven').locator('[data-task-check]')).toBeVisible();
  });
});

test.describe('sjablonen', () => {
  test('bewaren vanuit een afspraak en daarna maken met het palet', async ({ mainWindow, electronApp }) => {
    await chip(mainWindow, 'Overleg').dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await mainWindow.getByRole('button', { name: 'Bewaar als sjabloon' }).click();
    await expect(mainWindow.getByRole('status')).toContainText('Sjabloon “Overleg” bewaard');
    await expect.poll(async () => (await stored(mainWindow)).settings.templates).toHaveLength(1);
    await mainWindow.keyboard.press('Escape');

    await mainWindow.locator('#view [data-key="2026-10-30"]').click();
    await palette(mainWindow, electronApp, 'sjabloon overleg');
    await expect(mainWindow.locator('#palette').getByRole('option').first()).toContainText('Sjabloon: Overleg');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Overleg');
    await expect(mainWindow.locator('#e-start-date')).toHaveValue('2026-10-30');
    await expect(mainWindow.locator('#e-start-time')).toHaveValue('10:00');
    await expect(mainWindow.locator('#e-end-time')).toHaveValue('11:30');
    await mainWindow.locator('#e-save').click();
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Overleg' })).toHaveCount(2);
  });

  test('sjablonen staan in de voorkeuren en zijn te verwijderen; ze blijven na een herstart', async ({
    mainWindow,
    electronApp,
  }) => {
    await chip(mainWindow, 'Overleg').dblclick();
    await mainWindow.getByRole('button', { name: 'Bewaar als sjabloon' }).click();
    await mainWindow.keyboard.press('Escape');
    await mainWindow.reload();
    await clickMenu(electronApp, 'Voorkeuren…');
    await expect(mainWindow.locator('#tpl-list')).toContainText('Overleg');
    await mainWindow.getByRole('button', { name: 'Sjabloon Overleg verwijderen' }).click();
    await expect(mainWindow.locator('#tpl-list')).toContainText('Nog geen sjablonen.');
    await expect.poll(async () => (await stored(mainWindow)).settings.templates).toHaveLength(0);
  });
});

test.describe('statistieken', () => {
  test('het palet opent het scherm met de uren van deze week', async ({ mainWindow, electronApp }) => {
    await palette(mainWindow, electronApp, 'statistieken');
    await mainWindow.keyboard.press('Enter');
    const body = mainWindow.locator('#st-body');
    await expect(mainWindow.locator('#stats-dialog')).toBeVisible();
    await expect(body).toContainText('2u 30m'); // Overleg 1u30 + Lunch 1u
    await expect(body).toContainText('Drukste dag: woensdag 28 oktober');
    await expect(body).toContainText('Privé');
    await expect(body).toContainText('Werk');
    await mainWindow.locator('#st-period').selectOption('last-week');
    await expect(body).toContainText('Geen afspraken');
    await mainWindow.locator('#st-close').click();
    await expect(mainWindow.locator('#stats-dialog')).toBeHidden();
  });
});

test.describe('overlap oplossen', () => {
  test('"Zoek een vrij moment" verplaatst naar het eerstvolgende gat', async ({ mainWindow }) => {
    await chip(mainWindow, 'Lunch').dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await mainWindow.locator('#e-calendar').selectOption({ label: 'Privé' });
    await mainWindow.locator('#e-start-time').fill('11:00');
    await mainWindow.locator('#e-start-time').dispatchEvent('change');
    await expect(mainWindow.locator('#e-overlap')).toContainText('Overlapt met “Overleg”');
    await mainWindow.getByRole('button', { name: 'Zoek een vrij moment' }).click();
    await expect(mainWindow.locator('#e-start-time')).toHaveValue('11:30');
    await expect(mainWindow.locator('#e-end-time')).toHaveValue('12:30');
    await expect(mainWindow.locator('#e-overlap')).toBeHidden();
  });
});
