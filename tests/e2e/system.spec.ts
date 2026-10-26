import { expect, test } from './fixtures.ts';

test.describe('menubalk, sneltoets en e-mail (echte Electron)', () => {
  test('de menubalk kan aan en uit zonder fouten', async ({ mainWindow, consoleErrors }) => {
    await mainWindow.evaluate(() =>
      window.agenda.updateTray({
        enabled: true,
        title: 'Tandarts · over 12 min',
        tooltip: 'Volgende: Tandarts',
        items: [{ label: 'Vandaag 14:00 · Tandarts', date: '2026-10-26', id: 'e1' }],
      }),
    );
    await mainWindow.evaluate(() => window.agenda.updateTray({ enabled: false, title: '', tooltip: '', items: [] }));
    await mainWindow.evaluate(() => window.agenda.updateTray('onzin' as never));
    expect(consoleErrors).toEqual([]);
  });

  test('een globale sneltoets registreren, vervangen en uitzetten; onzin wordt geweigerd', async ({
    mainWindow,
    electronApp,
  }) => {
    const accelerator = 'CommandOrControl+Alt+Shift+F9';
    expect(await mainWindow.evaluate((a) => window.agenda.setShortcut(a), accelerator)).toBe(true);
    expect(await electronApp.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator)).toBe(
      true,
    );
    expect(await mainWindow.evaluate(() => window.agenda.setShortcut('N'))).toBe(false);
    expect(await electronApp.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator)).toBe(
      false,
    );
    expect(await mainWindow.evaluate((a) => window.agenda.setShortcut(a), accelerator)).toBe(true);
    expect(await mainWindow.evaluate(() => window.agenda.setShortcut(''))).toBe(true);
    expect(await electronApp.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator)).toBe(
      false,
    );
  });

  test('de sneltoeteninstelling in de voorkeuren registreert echt een sneltoets', async ({
    mainWindow,
    electronApp,
  }) => {
    await electronApp.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!
        .items[0].submenu!.items.find((i) => i.label === 'Voorkeuren…')!
        .click(),
    );
    await mainWindow.locator('#s-shortcut').focus();
    await mainWindow.keyboard.press('Meta+Alt+Shift+F8');
    await expect(mainWindow.locator('#s-shortcut-status')).toHaveText(/Werkt ook als de app/);
    await expect
      .poll(() =>
        electronApp.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+Shift+F8')),
      )
      .toBe(true);
    await mainWindow.locator('#s-shortcut-clear').click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+Shift+F8')),
      )
      .toBe(false);
  });

  test('"Uitnodiging mailen" opent de mail-app met de uitnodiging', async ({ mainWindow, electronApp }) => {
    await electronApp.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __opened: string[] };
      g.__opened = [];
      shell.openExternal = (async (url: string) => void g.__opened.push(url)) as never;
    });
    await mainWindow.locator('[data-view="month"]').click();
    await mainWindow.locator('#view [data-key]').nth(10).dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await mainWindow.locator('#e-title').fill('Lunch');
    await mainWindow.locator('#e-invitee-input').fill('sam@example.com');
    await mainWindow.locator('#e-invitee-input').press('Enter');
    await mainWindow.getByRole('button', { name: 'Uitnodiging mailen…' }).click();
    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.length))
      .toBe(1);
    const [url] = await electronApp.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);
    expect(url).toMatch(/^mailto:sam%40example\.com\?subject=Uitnodiging%3A%20Lunch&body=/);
    expect(decodeURIComponent(url)).toContain('Hierbij nodig ik je uit voor: Lunch');
  });
});
