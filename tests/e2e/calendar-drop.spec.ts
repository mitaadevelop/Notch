import type { Page } from '@playwright/test';
import { expect, freezeTime, resizeWindow, settled, test } from './fixtures.ts';

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
      ev('3', 'Reeks', '2026-10-13', { repeat: { freq: 'weekly', interval: 1, until: '' } }),
      ev('4', 'Uurtje', '2026-10-27', { time: '10:00', endTime: '11:00' }),
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}`) });
const row = (page: Page, name: string) => page.locator('#cal-list li', { hasText: name }).locator('div').first();
const saved = (page: Page) =>
  page.evaluate(
    async () =>
      ((await window.agenda.load()) as { events: { title: string; calendarId: string; date: string; time: string }[] })
        .events,
  );
const calendarOf = async (page: Page, title: string) => (await saved(page)).find((e) => e.title === title)?.calendarId;

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('afspraak op een agenda in de zijbalk slepen', () => {
  test('verplaatst de afspraak naar die agenda en biedt ongedaan maken', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').dragTo(row(mainWindow, 'Werk'));
    await expect.poll(() => calendarOf(mainWindow, 'Een')).toBe('work');
    await expect(mainWindow.getByRole('status')).toContainText('Verplaatst naar Werk');
    await expect(chip(mainWindow, 'Een')).toHaveClass(/border-cal-orange/);

    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(() => calendarOf(mainWindow, 'Een')).toBe('home');
  });

  test('tijdens het slepen licht de agenda op en noemt het label de agenda; daarna is alles weg', async ({
    mainWindow,
  }) => {
    const box = (await chip(mainWindow, 'Een').boundingBox())!;
    const target = (await row(mainWindow, 'Werk').boundingBox())!;
    await mainWindow.mouse.move(box.x + 10, box.y + 8);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(box.x - 20, box.y + 40, { steps: 3 });
    await mainWindow.mouse.move(target.x + 40, target.y + 8, { steps: 8 });
    await expect(row(mainWindow, 'Werk')).toHaveClass(/ring-2/);
    await expect(mainWindow.locator('#drag-label')).toHaveText('Verplaatsen naar “Werk”');
    await mainWindow.mouse.up();
    await expect(row(mainWindow, 'Werk')).not.toHaveClass(/ring-2/);
    await expect(mainWindow.locator('#drag-label')).toHaveCount(0);
  });

  test('een selectie gaat in één keer mee', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').click();
    await chip(mainWindow, 'Twee').click({ modifiers: ['Shift'] });
    await chip(mainWindow, 'Een').dragTo(row(mainWindow, 'Werk'));
    await expect.poll(() => calendarOf(mainWindow, 'Een')).toBe('work');
    await expect.poll(() => calendarOf(mainWindow, 'Twee')).toBe('work');
    await expect(mainWindow.getByRole('status')).toContainText('2 afspraken verplaatst naar Werk');
  });

  test('een herhalende afspraak gaat als hele reeks mee, zonder om het bereik te vragen', async ({ mainWindow }) => {
    await chip(mainWindow, 'Reeks').first().dragTo(row(mainWindow, 'Werk'));
    await expect.poll(() => calendarOf(mainWindow, 'Reeks')).toBe('work');
    await expect(mainWindow.locator('#scope-dialog')).toBeHidden();
    expect((await saved(mainWindow)).filter((e) => e.title === 'Reeks')).toHaveLength(1);
  });

  test("feestdagen en niet-bewerkbare agenda's zijn geen doel", async ({ mainWindow }) => {
    await expect(mainWindow.locator('#cal-list [data-calid]')).toHaveCount(3); // Privé, Werk, Verjaardagen
    await expect(row(mainWindow, 'Feestdagen NL')).not.toHaveAttribute('data-calid', /.+/);
    await chip(mainWindow, 'Een').dragTo(row(mainWindow, 'Feestdagen NL'));
    await mainWindow.waitForTimeout(300);
    expect(await calendarOf(mainWindow, 'Een')).toBe('home');
    await expect(mainWindow.getByRole('status')).toHaveCount(0);
  });

  test('loslaten op de eigen agenda doet niets', async ({ mainWindow }) => {
    await chip(mainWindow, 'Een').dragTo(row(mainWindow, 'Privé'));
    await mainWindow.waitForTimeout(300);
    await expect(mainWindow.getByRole('status')).toHaveCount(0);
    expect(await calendarOf(mainWindow, 'Een')).toBe('home');
  });
});

test.describe('vanuit het uurraster', () => {
  test('een blok naar een agenda in de zijbalk slepen verandert alleen de agenda, niet de tijd', async ({
    mainWindow,
    electronApp,
  }) => {
    await resizeWindow(electronApp, 1400, 900);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    const block = (await chip(mainWindow, 'Uurtje').boundingBox())!;
    const target = (await row(mainWindow, 'Werk').boundingBox())!;
    await mainWindow.mouse.move(block.x + block.width / 2, block.y + 12);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(block.x + block.width / 2 - 100, block.y + 30, { steps: 4 });
    await mainWindow.mouse.move(target.x + 40, target.y + 8, { steps: 8 });
    await expect(mainWindow.locator('#drag-label')).toHaveText('Verplaatsen naar “Werk”');
    await expect(row(mainWindow, 'Werk')).toHaveClass(/ring-2/);
    await mainWindow.mouse.up();

    await expect.poll(() => calendarOf(mainWindow, 'Uurtje')).toBe('work');
    const [uurtje] = (await saved(mainWindow)).filter((e) => e.title === 'Uurtje');
    expect([uurtje.date, uurtje.time]).toEqual(['2026-10-27', '10:00']);
  });
});
