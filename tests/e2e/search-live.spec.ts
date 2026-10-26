import type { Page } from '@playwright/test';
import { expect, freezeTime, settled, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      {
        id: '1',
        title: 'Tandarts Utrecht',
        date: '2026-11-02',
        endDate: '2026-11-02',
        calendarId: 'home',
        time: '14:00',
        endTime: '15:00',
      },
      { id: '2', title: 'Overleg tandarts', date: '2026-11-03', endDate: '2026-11-03', calendarId: 'work' },
      { id: '3', title: 'Lunch', date: '2026-11-04', endDate: '2026-11-04', calendarId: 'home' },
    ],
  }),
});

const pop = (page: Page) => page.locator('#search-pop');
const options = (page: Page) => pop(page).getByRole('option');

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('zoeken terwijl je typt', () => {
  test('verschijnt meteen onder het zoekveld met de gevonden letters gemarkeerd', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await expect(pop(mainWindow)).toBeVisible();
    await expect(options(mainWindow)).toHaveCount(2);
    await expect(options(mainWindow).first().locator('mark')).toHaveText('Tand');
    // de weergave zelf blijft de maand: pas Enter schakelt over naar de lijst met resultaten
    await expect(mainWindow.locator('#title')).not.toHaveText('Zoeken');
    const input = (await mainWindow.locator('#search').boundingBox())!;
    const box = (await pop(mainWindow).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(input.y + input.height);
    expect(box.x + box.width).toBeLessThanOrEqual(1180);
  });

  test('pijl omlaag + Enter opent die afspraak', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await mainWindow.keyboard.press('ArrowDown');
    await expect(options(mainWindow).first()).toHaveAttribute('aria-selected', 'true');
    await mainWindow.keyboard.press('ArrowDown');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Overleg tandarts');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Enter zonder keuze toont alle resultaten als lijst, en daarna volgt de lijst het typen', async ({
    mainWindow,
  }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#title')).toHaveText('Zoeken');
    await expect(mainWindow.locator('#view')).toContainText('2 resultaten voor “tand”');
    await expect(pop(mainWindow)).toHaveCount(0);

    await mainWindow.keyboard.type('arts u');
    await expect(mainWindow.locator('#view')).toContainText('1 resultaat voor “tandarts u”');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('klikken op een treffer opent hem, ook al verliest het veld normaal de focus', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('lunch');
    await options(mainWindow).first().click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Lunch');
  });

  test('"Alle resultaten tonen" onderaan werkt met de muis', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await pop(mainWindow)
      .getByText(/Resultaten als lijst tonen|Alle \d+ resultaten/)
      .click();
    await expect(mainWindow.locator('#title')).toHaveText('Zoeken');
  });

  test('niets gevonden en het veld leegmaken sluiten de lijst netjes', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('bestaatniet');
    await expect(pop(mainWindow)).toContainText('Niets gevonden.');
    await mainWindow.locator('#search').fill('');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Escape sluit de lijst en wist het veld; wegklikken sluit alleen de lijst', async ({ mainWindow }) => {
    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await mainWindow.keyboard.press('Escape');
    await expect(pop(mainWindow)).toHaveCount(0);
    await expect(mainWindow.locator('#search')).toHaveValue('');

    await mainWindow.locator('#search').click();
    await mainWindow.keyboard.type('tand');
    await mainWindow.locator('#title').click();
    await expect(pop(mainWindow)).toHaveCount(0);
    await expect(mainWindow.locator('#search')).toHaveValue('tand');
  });

  test('de zoekopdracht via het menu (⌘F) focust het veld en de lijst werkt direct', async ({
    mainWindow,
    electronApp,
  }) => {
    await electronApp.evaluate(({ Menu }) => {
      type Item = { label: string; click: () => void; submenu?: { items: Item[] } };
      const find = (items: Item[]): Item | undefined => {
        for (const item of items) {
          if (item.label === 'Zoek') return item;
          const nested = item.submenu && find(item.submenu.items);
          if (nested) return nested;
        }
      };
      find(Menu.getApplicationMenu()!.items as unknown as Item[])!.click();
    });
    await expect(mainWindow.locator('#search')).toBeFocused();
    await mainWindow.keyboard.type('lunch');
    await expect(options(mainWindow)).toHaveCount(1);
  });
});
