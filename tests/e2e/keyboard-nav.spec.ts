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
      ev('1', 'Maandag', '2026-10-19'),
      ev('2', 'Dinsdag', '2026-10-20'),
      ev('3', 'Dinsdag later', '2026-10-20', { time: '15:00', endTime: '16:00' }),
      ev('4', 'Woensdag', '2026-10-21'),
      ev('5', 'Volgende week', '2026-10-27'),
    ],
  }),
});

// de titel, eventueel gevolgd door de tijd (afspraken met een tijd tonen die erachter)
const chip = (page: Page, title: string) =>
  page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}(\\d{1,2}:\\d{2}.*)?$`) });
const selected = (page: Page) => page.locator('#view [data-okey].ring-2');
const dayTitle = (page: Page) => page.locator('#day-title');

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('pijltjestoetsen zonder selectie: door de dagen', () => {
  test('links/rechts een dag, omhoog/omlaag een week', async ({ mainWindow }) => {
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
    await mainWindow.keyboard.press('ArrowRight');
    await expect(dayTitle(mainWindow)).toContainText('dinsdag 27 oktober');
    await mainWindow.keyboard.press('ArrowDown');
    await expect(dayTitle(mainWindow)).toContainText('dinsdag 3 november');
    await mainWindow.keyboard.press('ArrowUp');
    await mainWindow.keyboard.press('ArrowLeft');
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
  });

  test('de dag over een maandgrens heen werkt ook', async ({ mainWindow }) => {
    for (let i = 0; i < 6; i++) await mainWindow.keyboard.press('ArrowRight');
    await expect(dayTitle(mainWindow)).toContainText('zondag 1 november');
    await expect(mainWindow.locator('#title')).toContainText('november');
  });
});

test.describe('pijltjestoetsen met een geselecteerde afspraak: van afspraak naar afspraak', () => {
  test('rechts gaat naar de afspraak op de volgende dag, het focusrandje volgt', async ({ mainWindow }) => {
    await chip(mainWindow, 'Maandag').click();
    await mainWindow.keyboard.press('ArrowRight');
    await expect(selected(mainWindow)).toHaveCount(1);
    await expect(chip(mainWindow, 'Dinsdag')).toHaveClass(/ring-2/);
    await expect(chip(mainWindow, 'Dinsdag')).toBeFocused();
    await mainWindow.keyboard.press('ArrowRight');
    await expect(chip(mainWindow, 'Woensdag')).toHaveClass(/ring-2/);
    await mainWindow.keyboard.press('ArrowLeft');
    await mainWindow.keyboard.press('ArrowLeft');
    await expect(chip(mainWindow, 'Maandag')).toHaveClass(/ring-2/);
  });

  test('omlaag gaat naar de afspraak onder de huidige en uiteindelijk naar de volgende week', async ({
    mainWindow,
  }) => {
    await chip(mainWindow, 'Dinsdag').click();
    await mainWindow.keyboard.press('ArrowDown');
    await expect(chip(mainWindow, 'Dinsdag later')).toHaveClass(/ring-2/);
    await mainWindow.keyboard.press('ArrowDown');
    await expect(chip(mainWindow, 'Volgende week')).toHaveClass(/ring-2/);
    await mainWindow.keyboard.press('ArrowUp');
    await expect(chip(mainWindow, 'Dinsdag later')).toHaveClass(/ring-2/);
  });

  test('is er niets meer in die richting, dan schuift de gekozen dag op en vervalt de selectie', async ({
    mainWindow,
  }) => {
    await chip(mainWindow, 'Maandag').click();
    await mainWindow.keyboard.press('ArrowLeft'); // links van maandag 19 okt ligt niets
    await expect(selected(mainWindow)).toHaveCount(0);
    await expect(dayTitle(mainWindow)).toContainText('zondag 25 oktober');
  });

  test('Enter opent de geselecteerde afspraak', async ({ mainWindow }) => {
    await chip(mainWindow, 'Woensdag').click();
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Woensdag');
  });

  test('de spatie opent het kaartje met de focus op de eerste actie; Escape sluit en geeft de focus terug', async ({
    mainWindow,
  }) => {
    await chip(mainWindow, 'Woensdag').click();
    await mainWindow.keyboard.press('Space');
    const pop = mainWindow.locator('#event-pop');
    await expect(pop).toHaveAttribute('role', 'dialog');
    await expect(pop.getByRole('button', { name: 'Bewerk' })).toBeFocused();
    await mainWindow.keyboard.press('Tab');
    await expect(pop.getByRole('button', { name: 'Dupliceer' })).toBeFocused();
    await mainWindow.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(chip(mainWindow, 'Woensdag')).toBeFocused();
    await expect(chip(mainWindow, 'Woensdag')).toHaveClass(/ring-2/); // de selectie blijft
  });

  test('Enter op een actie in het kaartje voert de actie uit', async ({ mainWindow }) => {
    await chip(mainWindow, 'Woensdag').click();
    await mainWindow.keyboard.press('Space');
    await mainWindow.keyboard.press('Enter'); // "Bewerk"
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
  });
});

test.describe('wanneer de toetsen niet meedoen', () => {
  test('in een invoerveld blijven de pijltjes voor de cursor', async ({ mainWindow }) => {
    await mainWindow.locator('#search').focus();
    await mainWindow.keyboard.type('abc');
    await mainWindow.keyboard.press('ArrowLeft');
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
    await expect(mainWindow.locator('#search')).toHaveValue('abc');
  });

  test('met een open dialoog doen ze niets met de agenda', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await mainWindow.locator('#e-title').blur();
    await mainWindow.keyboard.press('ArrowRight');
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
  });

  test('een knop met focus houdt zijn eigen toetsen (spatie klikt, geen kaartje)', async ({ mainWindow }) => {
    await chip(mainWindow, 'Woensdag').click();
    await mainWindow.locator('#today').focus();
    await mainWindow.keyboard.press('ArrowRight');
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
    await expect(mainWindow.locator('#event-pop')).toHaveCount(0);
  });

  test('met een toetscombinatie (⌘/Ctrl/Alt/Shift) gebeurt er niets', async ({ mainWindow }) => {
    await mainWindow.keyboard.press('Shift+ArrowRight');
    await mainWindow.keyboard.press('Alt+ArrowRight');
    await expect(dayTitle(mainWindow)).toContainText('maandag 26 oktober');
  });
});

test.describe('in de weekweergave', () => {
  test('pijltjes lopen ook langs de blokken in het uurraster', async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, 1400, 900);
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Ochtend', date: '2026-10-27', time: '09:00', endTime: '10:00' });
      store.addEvent({ title: 'Middag', date: '2026-10-27', time: '14:00', endTime: '15:00' });
    });
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    await chip(mainWindow, 'Ochtend').click();
    await mainWindow.keyboard.press('ArrowDown');
    await expect(chip(mainWindow, 'Middag')).toHaveClass(/ring-2/);
    await expect(chip(mainWindow, 'Middag')).toBeFocused();
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#e-title')).toHaveValue('Middag');
  });
});
