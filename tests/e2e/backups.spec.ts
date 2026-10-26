import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clickMenu, expect, test } from './fixtures.ts';

const doc = (titles: string[]) =>
  JSON.stringify({
    version: 2,
    events: titles.map((title, i) => ({
      id: String(i),
      title,
      date: '2026-10-26',
      endDate: '2026-10-26',
      calendarId: 'home',
    })),
  });

test.use({ initialFile: doc(['Eerste', 'Tweede']) });

test.describe('back-ups', () => {
  test('de eerste wijziging bewaart de stand van vlak ervoor', async ({ mainWindow, userDataDir }) => {
    await mainWindow.evaluate(async () => {
      const data = (await window.agenda.load()) as { events: unknown[] };
      await window.agenda.save({ ...data, events: [] } as never);
    });
    const dir = path.join(userDataDir, 'backups');
    await expect.poll(() => (existsSync(dir) ? readdirSync(dir).length : 0)).toBe(1);
    const saved = JSON.parse(readFileSync(path.join(dir, readdirSync(dir)[0]), 'utf8'));
    expect(saved.events.map((e: { title: string }) => e.title)).toEqual(['Eerste', 'Tweede']);
  });

  test('terugzetten via de voorkeuren brengt de afspraken terug', async ({ mainWindow, electronApp }) => {
    await mainWindow.evaluate(async () => {
      const data = (await window.agenda.load()) as { events: unknown[] };
      await window.agenda.save({ ...data, events: [] } as never);
    });
    await mainWindow.reload();
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Eerste' })).toHaveCount(0);

    // het bevestigingsvenster van het systeem: "Herstel"
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
    });
    await clickMenu(electronApp, 'Voorkeuren…');
    await expect(mainWindow.locator('#bak-list option')).toHaveCount(1);
    await expect(mainWindow.locator('#bak-list option')).toContainText('2 afspraken');
    await mainWindow.locator('#bak-restore').click();
    // de pagina herlaadt na het terugzetten: een poging die precies dan valt telt niet, de volgende wel
    await expect
      .poll(() =>
        mainWindow
          .evaluate(async () => ((await window.agenda.load()) as { events: unknown[] }).events.length)
          .catch(() => -1),
      )
      .toBe(2);
  });

  test('annuleren in het bevestigingsvenster laat de agenda zoals hij is', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await mainWindow.evaluate(async () => {
      const data = (await window.agenda.load()) as { events: unknown[] };
      await window.agenda.save({ ...data, events: [] } as never);
    });
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    });
    await clickMenu(electronApp, 'Voorkeuren…');
    await expect(mainWindow.locator('#bak-list option')).toHaveCount(1);
    await mainWindow.locator('#bak-restore').click();
    await expect(mainWindow.locator('#bak-status')).toHaveText('Niet teruggezet.');
    expect(JSON.parse(readFileSync(path.join(userDataDir, 'events.json'), 'utf8')).events).toHaveLength(0);
  });
});
