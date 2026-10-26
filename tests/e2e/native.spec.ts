import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clickMenu, expect, test } from './fixtures.ts';

test.describe('IPC vanuit de pagina', () => {
  test('save en load komen bij main aan en geven hetzelfde terug', async ({ mainWindow }) => {
    const loaded = await mainWindow.evaluate(async () => {
      await window.agenda.save({ version: 2, calendars: [], events: [], settings: {} } as never);
      return window.agenda.load();
    });
    expect(loaded).toEqual({ version: 2, calendars: [], events: [], settings: {} });
  });

  test('ongeldige input geeft een fout terug in plaats van op te slaan', async ({ mainWindow, userDataDir }) => {
    const message = await mainWindow.evaluate(async () => {
      try {
        await window.agenda.save('geen object' as never);
        return 'geen fout';
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain('data moet een object of array zijn');
    expect(existsSync(path.join(userDataDir, 'events.json'))).toBe(false);
  });

  test('popup-menu met ongeldige input geeft null', async ({ mainWindow }) => {
    expect(await mainWindow.evaluate(() => window.agenda.popupMenu('nee' as never))).toBeNull();
  });
});

test.describe('menu en sneltoetsen', () => {
  test("de menubalk bevat de verwachte menu's", async ({ electronApp }) => {
    const labels = await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label));
    expect(labels).toEqual(expect.arrayContaining(['Bestand', 'Bewerken', 'Weergave']));
  });

  test('"Week" in het menu schakelt de weergave en ⌘/Ctrl+N is gekoppeld', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Week');
    await expect(mainWindow.locator('[data-view="week"]')).toHaveClass(/bg-seg/);
    const accelerator = await electronApp.evaluate(({ Menu }) => {
      type Item = { label: string; accelerator?: string; submenu?: { items: Item[] } };
      const flat = (items: Item[]): Item[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu.items) : [])]);
      return flat(Menu.getApplicationMenu()!.items as unknown as Item[]).find((i) => i.label === 'Nieuwe afspraak')
        ?.accelerator;
    });
    expect(accelerator).toBe('CmdOrCtrl+N');
  });

  test('"Nieuwe afspraak" opent snel invoeren', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Nieuwe afspraak');
    await expect(mainWindow.locator('#quick')).toBeVisible();
  });
});

test.describe('dialogen voor bestanden (gemockt in main)', () => {
  test('exporteren schrijft een .ics-bestand en toont een melding', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-input').fill('Export test 10:00');
    await mainWindow.locator('#q-input').press('Enter');

    const target = path.join(userDataDir, 'uit.ics');
    await electronApp.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, target);
    await clickMenu(electronApp, 'Exporteer alles…');

    await expect(mainWindow.getByText('1 afspraken geëxporteerd.')).toBeVisible();
    expect(readFileSync(target, 'utf8')).toContain('SUMMARY:Export test');
  });

  test('annuleren van het opslaan-dialoogvenster maakt geen bestand', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-input').fill('Niet bewaard 10:00');
    await mainWindow.locator('#q-input').press('Enter');
    await electronApp.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
    });
    await clickMenu(electronApp, 'Exporteer alles…');
    await mainWindow.waitForTimeout(300);
    await expect(mainWindow.getByText('afspraken geëxporteerd')).toHaveCount(0);
    expect(existsSync(path.join(userDataDir, 'uit.ics'))).toBe(false);
  });

  test('importeren leest een .ics-bestand in een nieuwe agenda', async ({ mainWindow, electronApp }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agenda-ics-'));
    const file = path.join(dir, 'Sportclub.ics');
    writeFileSync(
      file,
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'SUMMARY:Training',
        'DTSTART:20261028T190000',
        'DTEND:20261028T200000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    await electronApp.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, file);
    await clickMenu(electronApp, 'Importeer…');
    await expect(mainWindow.getByText('1 afspraken geïmporteerd.')).toBeVisible();
    await expect(mainWindow.locator('#cal-list')).toContainText('Sportclub');
  });

  test('een ics-bestand zonder afspraken geeft een duidelijke melding', async ({ mainWindow, electronApp }) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'agenda-ics-')), 'leeg.ics');
    writeFileSync(file, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
    await electronApp.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, file);
    await clickMenu(electronApp, 'Importeer…');
    await expect(mainWindow.getByText('Geen afspraken gevonden in het bestand.')).toBeVisible();
  });
});

test.describe('notificaties', () => {
  test('notify maakt een melding en een klik opent de dag in de app', async ({ mainWindow, electronApp }) => {
    const supported = await electronApp.evaluate(({ Notification }) => Notification.isSupported());
    test.skip(!supported, 'meldingen worden op dit systeem niet ondersteund');

    // de echte melding zou in het systeem verschijnen: vang show() af en houd het object vast voor een nep-klik
    await electronApp.evaluate(({ Notification }) => {
      const g = globalThis as unknown as { __shown: InstanceType<typeof Notification>[] };
      g.__shown = [];
      Notification.prototype.show = function show(this: InstanceType<typeof Notification>) {
        g.__shown.push(this);
      };
    });

    await mainWindow.evaluate(() =>
      window.agenda.notify({ title: 'Tandarts', body: '14:00', id: null, date: '2026-10-28' }),
    );
    const shown = await electronApp.evaluate(() =>
      (globalThis as unknown as { __shown: { title: string; body: string }[] }).__shown.map((n) => ({
        title: n.title,
        body: n.body,
      })),
    );
    expect(shown).toEqual([{ title: 'Tandarts', body: '14:00' }]);

    await electronApp.evaluate(() =>
      (globalThis as unknown as { __shown: { emit: (event: string) => void }[] }).__shown[0].emit('click'),
    );
    await expect(mainWindow.locator('#title')).toContainText('28 oktober');
    await expect(mainWindow.locator('[data-view="day"]')).toHaveClass(/bg-seg/);
  });
});

test.describe('venster', () => {
  test('heeft een minimale grootte en blijft op één venster', async ({ electronApp }) => {
    const info = await electronApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return { count: wins.length, min: wins[0].getMinimumSize() };
    });
    expect(info).toEqual({ count: 1, min: [1000, 600] });
  });
});
