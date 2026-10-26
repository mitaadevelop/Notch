import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clickMenu, expect, launchApp, test } from './fixtures.ts';

const saved = (userDataDir: string) =>
  JSON.parse(readFileSync(path.join(userDataDir, 'events.json'), 'utf8')) as {
    version: number;
    events: { title: string }[];
    settings: { weekNumbers: boolean };
  };

test.describe('geen bestand (eerste start)', () => {
  test("start met standaardagenda's en maakt pas een bestand na een wijziging", async ({ mainWindow, userDataDir }) => {
    await expect(mainWindow.locator('#cal-list li')).toHaveCount(4);
    expect(existsSync(path.join(userDataDir, 'events.json'))).toBe(false);

    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-input').fill('Eerste afspraak 10:00');
    await mainWindow.locator('#q-input').press('Enter');
    await expect(mainWindow.locator('#day-list')).toContainText('Eerste afspraak');

    await expect.poll(() => existsSync(path.join(userDataDir, 'events.json'))).toBe(true);
    expect(saved(userDataDir).version).toBe(2);
    // atomisch schrijven: geen tijdelijk bestand achtergelaten
    expect(readdirSync(userDataDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

test.describe('kapot bestand', () => {
  for (const [name, content] of [
    ['geen JSON', '{ dit is geen json'],
    ['JSON maar geen object', '42'],
    ['leeg bestand', ''],
  ] as const) {
    test.describe(name, () => {
      test.use({ initialFile: content });
      test('start met een lege agenda zonder fouten', async ({ mainWindow, consoleErrors }) => {
        await expect(mainWindow.locator('#cal-list li')).toHaveCount(4);
        await expect(mainWindow.locator('#title')).not.toBeEmpty();
        expect(consoleErrors).toEqual([]);
      });
    });
  }
});

test.describe('oud formaat', () => {
  test.use({
    initialFile: JSON.stringify([
      { id: '1', title: 'Oude afspraak', date: '2026-10-28', time: '09:00', color: 'orange' },
    ]),
  });

  test('wordt omgezet en bij de volgende wijziging als versie 2 opgeslagen', async ({ mainWindow, userDataDir }) => {
    await mainWindow.locator('[data-view="list"]').click();
    await expect(mainWindow.locator('#view')).toContainText('Oude afspraak');
    // kleur oranje hoort bij de agenda "Werk"
    await expect(mainWindow.locator('#view')).toContainText('Werk');

    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-input').fill('Nieuw 11:00');
    await mainWindow.locator('#q-input').press('Enter');
    await expect.poll(() => saved(userDataDir).version).toBe(2);
    expect(
      saved(userDataDir)
        .events.map((e) => e.title)
        .sort(),
    ).toEqual(['Nieuw', 'Oude afspraak']);
  });
});

test.describe('instellingen', () => {
  test('een instelling blijft bewaard na een herstart', async ({ electronApp, userDataDir }) => {
    await clickMenu(electronApp, 'Toon weeknummers');
    await expect
      .poll(() => (existsSync(path.join(userDataDir, 'events.json')) ? saved(userDataDir).settings.weekNumbers : null))
      .toBe(true);
    await electronApp.close();

    const again = await launchApp(userDataDir);
    const settings = await again.window.evaluate(
      async () => ((await window.agenda.load()) as { settings: { weekNumbers: boolean } }).settings,
    );
    expect(settings.weekNumbers).toBe(true);
    await again.app.close();
  });
});
