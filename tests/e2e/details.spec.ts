import type { Page } from '@playwright/test';
import { calendarText, startFeed, vevent } from '../helpers/servers.ts';
import { clickMenu, expect, freezeTime, resizeWindow, settled, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      { id: '1', title: 'Eendags', date: '2026-10-14', endDate: '2026-10-14', calendarId: 'home' },
      {
        id: '2',
        title: 'Tandarts',
        date: '2026-10-27',
        endDate: '2026-10-27',
        calendarId: 'home',
        time: '09:00',
        endTime: '10:00',
      },
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}`) });
const cursor = (page: Page, title: string) => chip(page, title).evaluate((node) => getComputedStyle(node).cursor);

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('cursors', () => {
  test('een afspraak die je kunt oppakken krijgt een open hand', async ({ mainWindow }) => {
    expect(await cursor(mainWindow, 'Eendags')).toBe('grab');
  });

  test('ook de blokken in het uurraster (die met de muis versleept worden)', async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, 1400, 900);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    expect(await cursor(mainWindow, 'Tandarts')).toBe('grab');
    // de greep onderaan om te vergroten
    const handle = chip(mainWindow, 'Tandarts').locator('[data-resize]');
    expect(await handle.evaluate((node) => getComputedStyle(node).cursor)).toBe('ns-resize');
  });

  test('en de grepen van een meerdaagse balk', async ({ mainWindow }) => {
    const handle = chip(mainWindow, 'Eendags').locator('[data-edge="end"]');
    expect(await handle.evaluate((node) => getComputedStyle(node).cursor)).toBe('ew-resize');
  });

  test('een alleen-lezen afspraak is niet te pakken en heeft dus geen hand', async ({ mainWindow, electronApp }) => {
    const feed = await startFeed({ body: calendarText('Extern', vevent('x', 'Alleenlezen', '20261020')) });
    try {
      await clickMenu(electronApp, 'Agenda-account of link toevoegen…');
      await mainWindow.locator('#src-url').fill(feed.calendarUrl);
      await mainWindow.locator('#src-submit').click();
      await expect(chip(mainWindow, 'Alleenlezen')).toBeVisible();
      expect(await cursor(mainWindow, 'Alleenlezen')).not.toBe('grab');
    } finally {
      await feed.close();
    }
  });
});

test.describe('Vandaag scrolt zacht naar het huidige tijdstip', () => {
  test.beforeEach(async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, 1400, 600);
    await mainWindow.locator('[data-view="day"]').click();
    await settled(mainWindow);
  });

  test('vanaf boven in het raster komt het huidige uur in beeld', async ({ mainWindow }) => {
    const scroller = mainWindow.locator('#view .overflow-y-auto');
    await scroller.evaluate((node) => (node.scrollTop = 0));
    await mainWindow.locator('#today').click();
    // het is 10:00 (480 px) en het raster is ~480 px hoog: 1/3 daarvan boven het huidige uur
    await expect
      .poll(() => mainWindow.evaluate(() => document.querySelector('#view .overflow-y-auto')!.scrollTop))
      .toBeGreaterThan(250);
    const top = await mainWindow.evaluate(() => document.querySelector('#view .overflow-y-auto')!.scrollTop);
    expect(top).toBeLessThan(480);
    await expect(mainWindow.locator('[data-nowline]')).toBeInViewport();
  });

  test('het scrollen is geanimeerd (niet in één keer) en bij verminderde beweging wel direct', async ({
    mainWindow,
  }) => {
    const scroller = mainWindow.locator('#view .overflow-y-auto');
    await scroller.evaluate((node) => (node.scrollTop = 0));
    const first = await mainWindow.evaluate(async () => {
      const node = document.querySelector('#view .overflow-y-auto') as HTMLElement;
      document.getElementById('today')!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return node.scrollTop;
    });
    await expect
      .poll(() => mainWindow.evaluate(() => document.querySelector('#view .overflow-y-auto')!.scrollTop))
      .toBeGreaterThan(first);

    await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
    await scroller.evaluate((node) => (node.scrollTop = 0));
    const direct = await mainWindow.evaluate(async () => {
      document.getElementById('today')!.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector('#view .overflow-y-auto')!.scrollTop;
    });
    expect(direct).toBeGreaterThan(250);
  });

  test('in de maandweergave doet "Vandaag" niets geks (geen raster om te scrollen)', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="month"]').click();
    await mainWindow.locator('#today').click();
    await expect(mainWindow.locator('#day-title')).toContainText('maandag 26 oktober');
  });
});

test.describe('overlap in de afspraakdialoog', () => {
  test('waarschuwt live terwijl je de tijd aanpast', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await mainWindow.locator('#e-start-date').fill('2026-10-27');
    await mainWindow.locator('#e-end-date').fill('2026-10-27');
    await mainWindow.locator('#e-start-time').fill('09:30');
    await mainWindow.locator('#e-end-time').fill('10:30');
    await expect(mainWindow.locator('#e-overlap')).toBeVisible();
    await expect(mainWindow.locator('#e-overlap')).toContainText('Overlapt met “Tandarts”');

    await mainWindow.locator('#e-start-time').fill('11:00');
    await expect(mainWindow.locator('#e-overlap')).toBeHidden();
  });

  test('het is een waarschuwing, geen blokkade: bewaren kan gewoon', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await mainWindow.locator('#e-title').fill('Dubbel');
    await mainWindow.locator('#e-start-date').fill('2026-10-27');
    await mainWindow.locator('#e-end-date').fill('2026-10-27');
    await mainWindow.locator('#e-start-time').fill('09:00');
    await mainWindow.locator('#e-end-time').fill('09:30');
    await expect(mainWindow.locator('#e-overlap')).toBeVisible();
    await mainWindow.locator('#e-save').click();
    await expect(mainWindow.locator('#event-dialog')).toBeHidden();
    await expect(chip(mainWindow, 'Dubbel')).toBeVisible();
  });
});

test.describe('voortgang bij het verversen van een externe agenda', () => {
  test('een draaiend icoontje tijdens het ophalen, en weg als het klaar is', async ({ mainWindow, electronApp }) => {
    const feed = await startFeed({ body: calendarText('Traag', vevent('x', 'Later', '20261020')) });
    try {
      await clickMenu(electronApp, 'Agenda-account of link toevoegen…');
      await mainWindow.locator('#src-url').fill(feed.calendarUrl);
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#cal-list')).toContainText('Traag');

      feed.state.delayMs = 1200;
      await clickMenu(electronApp, 'Vernieuw externe agenda’s');
      const spinner = mainWindow.locator('#cal-list').getByRole('img', { name: 'Bezig met vernieuwen' });
      await expect(spinner).toBeVisible();
      await expect(spinner).toHaveCount(0, { timeout: 5000 });
      await expect(mainWindow.getByText('Externe agenda’s zijn bijgewerkt.')).toBeVisible();
    } finally {
      await feed.close();
    }
  });
});
