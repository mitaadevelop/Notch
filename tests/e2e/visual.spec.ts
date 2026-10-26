import { expect, freezeTime, resizeWindow, test } from './fixtures.ts';

// Screenshots verschillen per besturingssysteem (lettertypen, vensterkader): de baseline staat per platform in
// tests/e2e/visual.spec.ts-snapshots/. Deze tests draaien alleen op het platform waarvoor de baseline gemaakt is.
// Baseline bijwerken: npm run test:e2e -- visual --update-snapshots
test.skip(process.platform !== 'darwin', 'de baseline is op macOS gemaakt');

const event = (id: string, title: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  date,
  endDate: date,
  calendarId: 'home',
  ...extra,
});

const SEED = JSON.stringify({
  version: 2,
  events: [
    event('1', 'Tandarts', '2026-10-26', { time: '09:00', endTime: '10:00', location: 'Utrecht' }),
    event('2', 'Teamoverleg', '2026-10-27', { time: '11:00', endTime: '12:30', calendarId: 'work' }),
    event('3', 'Lunch met Sam', '2026-10-27', { time: '12:30', endTime: '13:30' }),
    event('4', 'Congres', '2026-10-28', { endDate: '2026-10-30', calendarId: 'work' }),
    event('5', 'Yoga', '2026-10-26', {
      time: '19:00',
      endTime: '20:00',
      repeat: { freq: 'weekly', interval: 1, until: '' },
    }),
    event('6', 'Verjaardag oma', '2026-10-31', { calendarId: 'birthdays' }),
  ],
});

const FROZEN = '2026-10-26T10:00:00';
const SIZES = { groot: { width: 1400, height: 900 }, klein: { width: 1000, height: 600 } } as const;
const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 } as const;

test.use({ initialFile: SEED });

for (const [name, size] of Object.entries(SIZES)) {
  test.describe(`venster ${name}`, () => {
    test.beforeEach(async ({ mainWindow, electronApp }) => {
      await resizeWindow(electronApp, size.width, size.height);
      await freezeTime(mainWindow, FROZEN);
    });

    test('maandweergave, licht', async ({ mainWindow }) => {
      await mainWindow.emulateMedia({ colorScheme: 'light' });
      await expect(mainWindow).toHaveScreenshot(`maand-${name}-licht.png`, SHOT);
    });

    test('maandweergave, donker', async ({ mainWindow }) => {
      await mainWindow.emulateMedia({ colorScheme: 'dark' });
      await expect(mainWindow).toHaveScreenshot(`maand-${name}-donker.png`, SHOT);
    });

    test('weekweergave', async ({ mainWindow }) => {
      await mainWindow.locator('[data-view="week"]').click();
      // vaste scrollpositie: de weergave onthoudt die tussen renders
      await mainWindow.locator('#view .overflow-y-auto').evaluate((node) => (node.scrollTop = 7 * 48));
      await expect(mainWindow).toHaveScreenshot(`week-${name}.png`, SHOT);
    });
  });
}

test.describe('overige schermen (groot)', () => {
  test.beforeEach(async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, SIZES.groot.width, SIZES.groot.height);
    await freezeTime(mainWindow, FROZEN);
  });

  test('lijst', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="list"]').click();
    await expect(mainWindow).toHaveScreenshot('lijst.png', SHOT);
  });

  test('jaar', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="year"]').click();
    await expect(mainWindow).toHaveScreenshot('jaar.png', SHOT);
  });

  test('afspraakdialoog', async ({ mainWindow }) => {
    await mainWindow.locator('#view [data-okey]', { hasText: 'Tandarts' }).dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow).toHaveScreenshot('dialoog.png', SHOT);
  });
});
