import { expect, test } from './fixtures.ts';

test.describe('opstarten', () => {
  test('toont het venster "Agenda" zonder console-fouten', async ({ mainWindow, consoleErrors }) => {
    await expect(mainWindow).toHaveTitle('Agenda');
    await expect(mainWindow.locator('#title')).not.toBeEmpty();
    // de maandweergave is getekend
    await expect(mainWindow.locator('#view [data-key]').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("eerste start zonder data: standaardagenda's en een lege maand", async ({ mainWindow }) => {
    const calendars = mainWindow.locator('#cal-list li');
    await expect(calendars).toHaveText(['Privé', 'Werk', 'Verjaardagen', 'Feestdagen NL']);
    await expect(mainWindow.locator('#view [data-okey]:not([data-okey^="h:"])')).toHaveCount(0);
  });

  test('geeft de pagina geen Node-toegang', async ({ mainWindow }) => {
    const globals = await mainWindow.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      agenda: typeof window.agenda,
    }));
    expect(globals).toEqual({ require: 'undefined', process: 'undefined', agenda: 'object' });
  });
});
