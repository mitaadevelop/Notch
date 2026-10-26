import type { Page } from '@playwright/test';
import { expect, freezeTime, settled, test } from './fixtures.ts';

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
      ev('4', 'Vier', '2026-10-14', { time: '10:00', endTime: '11:00' }),
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}`) });
const day = (page: Page, key: string) => page.locator(`#view [data-key="${key}"]`);
const selected = (page: Page) => page.locator('#view [data-okey].ring-accent');
const badge = (page: Page) => page.locator('#sel-info');

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
  await mainWindow.locator('[data-view="month"]').click();
  await settled(mainWindow);
});

async function box(locator: ReturnType<typeof day>) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('geen boundingBox');
  return b;
}

// trekt een kader van de rechteronderhoek van de ene cel naar de linkerbovenhoek van een andere
async function frame(page: Page, from: string, to: string, extra?: 'Meta') {
  const a = await box(day(page, from));
  const b = await box(day(page, to));
  await page.keyboard.down('Shift');
  if (extra) await page.keyboard.down(extra);
  await page.mouse.move(a.x + a.width - 4, a.y + a.height - 4);
  await page.mouse.down();
  await page.mouse.move(b.x + 4, b.y + 4, { steps: 8 });
  return async () => {
    await page.mouse.up();
    if (extra) await page.keyboard.up(extra);
    await page.keyboard.up('Shift');
  };
}

test.describe('selecteren met ⇧ + slepen (maandweergave)', () => {
  test('een kader over meerdere dagen selecteert alle afspraken erin', async ({ mainWindow }) => {
    const release = await frame(mainWindow, '2026-10-15', '2026-10-14');
    await expect(mainWindow.locator('body > div[aria-hidden="true"].border-accent')).toBeVisible(); // het kader zelf
    await release();
    await expect(selected(mainWindow)).toHaveCount(3); // Een, Vier (14e) en Twee (15e)
    await expect(badge(mainWindow)).toHaveText('3 geselecteerd');
    await expect(mainWindow.locator('body > div[aria-hidden="true"].border-accent')).toHaveCount(0);
    await expect(chip(mainWindow, 'Drie')).not.toHaveClass(/ring-accent/);
  });

  test('de dag wordt na het slepen niet gekozen (de selectie blijft)', async ({ mainWindow }) => {
    const release = await frame(mainWindow, '2026-10-15', '2026-10-14');
    await release();
    await expect(selected(mainWindow)).toHaveCount(3);
    await settled(mainWindow);
    await expect(selected(mainWindow)).toHaveCount(3);
  });

  test('een kleiner kader haalt afspraken er weer uit tijdens het slepen', async ({ mainWindow }) => {
    const a = await box(day(mainWindow, '2026-10-15'));
    const b = await box(day(mainWindow, '2026-10-14'));
    await mainWindow.keyboard.down('Shift');
    await mainWindow.mouse.move(a.x + a.width - 4, a.y + a.height - 4);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(b.x + 4, b.y + 4, { steps: 8 });
    await expect(selected(mainWindow)).toHaveCount(3);
    await mainWindow.mouse.move(a.x + a.width - 30, a.y + a.height - 30, { steps: 8 });
    await expect(selected(mainWindow)).toHaveCount(0);
    await mainWindow.mouse.up();
    await mainWindow.keyboard.up('Shift');
  });

  test('met ⇧⌘ wordt de selectie aangevuld in plaats van vervangen', async ({ mainWindow }) => {
    await chip(mainWindow, 'Drie').click();
    await expect(selected(mainWindow)).toHaveCount(1);
    const release = await frame(mainWindow, '2026-10-15', '2026-10-14', 'Meta');
    await release();
    await expect(selected(mainWindow)).toHaveCount(4);
  });

  test('een gewoon ⇧-kader vervangt een bestaande selectie', async ({ mainWindow }) => {
    await chip(mainWindow, 'Drie').click();
    const release = await frame(mainWindow, '2026-10-15', '2026-10-14');
    await release();
    await expect(selected(mainWindow)).toHaveCount(3);
    await expect(chip(mainWindow, 'Drie')).not.toHaveClass(/ring-accent/);
  });

  test('de geselecteerde afspraken kunnen samen verwijderd worden, en ongedaan gemaakt', async ({ mainWindow }) => {
    const release = await frame(mainWindow, '2026-10-15', '2026-10-14');
    await release();
    await mainWindow.keyboard.press('Delete');
    await expect(mainWindow.getByRole('status')).toContainText('3 afspraken verwijderd');
    await expect(chip(mainWindow, 'Een')).toHaveCount(0);
    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(chip(mainWindow, 'Een')).toBeVisible();
  });

  test('zonder ⇧ maakt slepen over dagen nog steeds een meerdaagse afspraak (geen kader)', async ({ mainWindow }) => {
    const a = await box(day(mainWindow, '2026-10-28'));
    const b = await box(day(mainWindow, '2026-10-30'));
    await mainWindow.mouse.move(a.x + a.width - 4, a.y + a.height - 4);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(b.x + 10, b.y + b.height - 4, { steps: 8 });
    await expect(mainWindow.locator('body > div[aria-hidden="true"].border-accent')).toHaveCount(0);
    await mainWindow.mouse.up();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-start-date')).toHaveValue('2026-10-28');
    await expect(mainWindow.locator('#e-end-date')).toHaveValue('2026-10-30');
  });

  test('een gewone klik op een lege plek werkt nog (kiest de dag)', async ({ mainWindow }) => {
    const c = await box(day(mainWindow, '2026-10-30'));
    await mainWindow.mouse.click(c.x + c.width - 6, c.y + c.height - 6);
    await expect(day(mainWindow, '2026-10-30')).toHaveClass(/bg-fill/);
  });

  test('beginnen op een afspraak sleept die (geen kader)', async ({ mainWindow }) => {
    const c = await chip(mainWindow, 'Drie').boundingBox();
    await mainWindow.mouse.move(c!.x + 10, c!.y + 5);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(c!.x + 40, c!.y + 5, { steps: 4 });
    await expect(mainWindow.locator('body > div[aria-hidden="true"].border-accent')).toHaveCount(0);
    await mainWindow.mouse.up();
  });
});

test.describe('in de weekweergave', () => {
  test('met ⇧ een kader trekken selecteert; zonder ⇧ maakt slepen een nieuwe afspraak', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="week"]').click();
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    const col = (key: string) => mainWindow.locator(`#view [data-col="${key}"]`);
    // dinsdag 27 okt: maak een afspraak, in de dagweergave van de week
    await mainWindow.evaluate(async () => {
      const data = (await window.agenda.load()) as { events: unknown[] };
      await window.agenda.save({
        ...data,
        events: [
          ...data.events,
          {
            id: 'w',
            title: 'Weekblok',
            date: '2026-10-27',
            endDate: '2026-10-27',
            time: '10:00',
            endTime: '11:00',
            calendarId: 'home',
          },
        ],
      } as never);
    });
    await mainWindow.reload();
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    await mainWindow.evaluate(() => document.querySelector('#view .overflow-y-auto')!.scrollTo(0, 0));
    const target = await chip(mainWindow, 'Weekblok').boundingBox();
    const c = await col('2026-10-27').boundingBox();
    await mainWindow.keyboard.down('Shift');
    await mainWindow.mouse.move(c!.x + c!.width - 4, target!.y + target!.height + 20);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(c!.x + 4, target!.y - 10, { steps: 8 });
    await mainWindow.mouse.up();
    await mainWindow.keyboard.up('Shift');
    await expect(chip(mainWindow, 'Weekblok')).toHaveClass(/ring-accent/);
    await expect(mainWindow.locator('#event-dialog')).toBeHidden();
  });
});
