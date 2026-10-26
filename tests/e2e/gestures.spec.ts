import type { Page } from '@playwright/test';
import { clickMenu, expect, freezeTime, launchApp, resizeWindow, settled, test } from './fixtures.ts';

const title = (page: Page) => page.locator('#title');

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('veeg met twee vingers', () => {
  test('naar links vegen gaat naar de volgende maand, naar rechts terug', async ({ mainWindow }) => {
    await expect(title(mainWindow)).toContainText('oktober');
    await mainWindow.mouse.move(700, 400);
    await mainWindow.mouse.wheel(120, 0);
    await expect(title(mainWindow)).toContainText('november');
    await mainWindow.waitForTimeout(300);
    await mainWindow.mouse.wheel(-120, 0);
    await expect(title(mainWindow)).toContainText('oktober');
  });

  test('een lange veeg (veel events, ook het uitrollen) is één stap', async ({ mainWindow }) => {
    await mainWindow.mouse.move(700, 400);
    for (let i = 0; i < 20; i++) {
      await mainWindow.mouse.wheel(25, 0);
      await mainWindow.waitForTimeout(16);
    }
    await expect(title(mainWindow)).toContainText('november');
    await mainWindow.waitForTimeout(100);
    await expect(title(mainWindow)).not.toContainText('december');
  });

  test('de weergave schuift mee (animatie loopt)', async ({ mainWindow }) => {
    await mainWindow.mouse.move(700, 400);
    const running = await mainWindow.evaluate(async () => {
      const view = document.getElementById('view')!;
      view.dispatchEvent(new WheelEvent('wheel', { deltaX: 150, deltaY: 0, bubbles: true, cancelable: true }));
      return view.getAnimations().length;
    });
    expect(running).toBeGreaterThan(0);
  });

  test('verticaal scrollen of een kleine beweging doet niets', async ({ mainWindow }) => {
    await mainWindow.mouse.move(700, 400);
    await mainWindow.mouse.wheel(0, 200);
    await mainWindow.mouse.wheel(30, 5);
    await mainWindow.waitForTimeout(200);
    await expect(title(mainWindow)).toContainText('oktober');
  });

  test('in de weekweergave gaat een veeg een week verder', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="week"]').click();
    const firstDay = () => mainWindow.locator('#view [data-col]').first().getAttribute('data-col');
    await expect.poll(firstDay).toBe('2026-10-26');
    await mainWindow.mouse.move(700, 400);
    await mainWindow.mouse.wheel(120, 0);
    await expect.poll(firstDay).toBe('2026-11-02');
  });

  test('met een open dialoog gebeurt er niets', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await mainWindow.mouse.wheel(150, 0);
    await mainWindow.waitForTimeout(200);
    await expect(title(mainWindow)).toContainText('oktober');
  });
});

test.describe('knijpen om de uren te zoomen', () => {
  const columnHeight = (page: Page) =>
    page
      .locator('#view [data-col]')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height);
  const pinch = (page: Page, deltaY: number, y = 400) =>
    page.evaluate(
      ([dy, clientY]) => {
        const view = document.getElementById('view')!;
        view.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: dy,
            ctrlKey: true,
            clientX: 700,
            clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [deltaY, y] as const,
    );

  test.beforeEach(async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, 1400, 900);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
  });

  test('uit elkaar knijpen maakt de uren hoger, samenknijpen lager, tussen een minimum en maximum', async ({
    mainWindow,
  }) => {
    expect(await columnHeight(mainWindow)).toBe(24 * 48);
    await pinch(mainWindow, -40);
    await expect.poll(() => columnHeight(mainWindow)).toBeGreaterThan(24 * 48);
    const bigger = await columnHeight(mainWindow);

    await pinch(mainWindow, 80);
    await expect.poll(() => columnHeight(mainWindow)).toBeLessThan(bigger);

    for (let i = 0; i < 12; i++) {
      await pinch(mainWindow, 100);
      await mainWindow.waitForTimeout(20);
    }
    await expect.poll(() => columnHeight(mainWindow)).toBe(24 * 28); // minimum
    for (let i = 0; i < 20; i++) {
      await pinch(mainWindow, -100);
      await mainWindow.waitForTimeout(20);
    }
    await expect.poll(() => columnHeight(mainWindow)).toBe(24 * 120); // maximum
  });

  test('het tijdstip onder de cursor blijft op zijn plek', async ({ mainWindow }) => {
    const scroller = mainWindow.locator('#view .overflow-y-auto');
    const rect = (await scroller.boundingBox())!;
    const cursorY = rect.y + 200;
    const minutesAtCursor = () =>
      mainWindow.evaluate((y) => {
        const col = document.querySelector('#view [data-col]') as HTMLElement;
        return ((y - col.getBoundingClientRect().top) / (col.getBoundingClientRect().height / 24)) * 60;
      }, cursorY);
    const before = await minutesAtCursor();
    await pinch(mainWindow, -60, cursorY);
    await expect.poll(() => columnHeight(mainWindow)).toBeGreaterThan(24 * 48);
    expect(Math.abs((await minutesAtCursor()) - before)).toBeLessThan(10);
  });

  test('afspraken en de tijdlijn gaan mee met de nieuwe hoogte', async ({ mainWindow }) => {
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Uurtje', date: '2026-10-27', time: '10:00', endTime: '11:00' });
    });
    const block = mainWindow.locator('#view [data-okey]', { hasText: 'Uurtje' });
    await expect(block).toBeVisible();
    await settled(mainWindow);
    expect(Math.round((await block.boundingBox())!.height)).toBe(47); // 48 px per uur, min. 1 px rand
    await pinch(mainWindow, -60);
    // het blok wordt tijdens het hertekenen heel even vervangen: dan is er (nog) geen boundingBox
    await expect.poll(async () => (await block.boundingBox())?.height ?? 0).toBeGreaterThan(60);
  });

  test('de hoogte blijft na een herstart, en "Standaard uurhoogte" zet hem terug', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await pinch(mainWindow, -60);
    await expect.poll(() => columnHeight(mainWindow)).toBeGreaterThan(24 * 48);
    const zoomed = await columnHeight(mainWindow);
    await electronApp.close();

    const again = await launchApp(userDataDir);
    await again.window.locator('[data-view="week"]').click();
    await settled(again.window);
    expect(await columnHeight(again.window)).toBe(zoomed);

    await clickMenu(again.app, 'Standaard uurhoogte');
    await expect.poll(() => columnHeight(again.window)).toBe(24 * 48);
    await again.app.close();
  });

  test('de menu-items "Uren groter" en "Uren kleiner" werken ook', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Uren groter');
    await expect.poll(() => columnHeight(mainWindow)).toBe(24 * 60);
    await clickMenu(electronApp, 'Uren kleiner');
    await expect.poll(() => columnHeight(mainWindow)).toBe(24 * 48);
  });

  test('in de maandweergave doet knijpen niets (en zoomt de pagina niet)', async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="month"]').click();
    const prevented = await mainWindow.evaluate(() => {
      const view = document.getElementById('view')!;
      const event = new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true });
      view.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow); // de weergave zoomt zacht in; meten kan pas als dat klaar is
    expect(await columnHeight(mainWindow)).toBe(24 * 48);
  });
});
