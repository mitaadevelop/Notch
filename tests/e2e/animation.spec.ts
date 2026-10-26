import { expect, freezeTime, test } from './fixtures.ts';

// pad van de module in de pagina; als variabele zodat TypeScript hem niet probeert op te lossen
const STORE = './js/store.js';
const seconds = (value: string) => parseFloat(value.split(',')[0]);

test.describe('animaties', () => {
  test('knoppen hebben een zachte overgang', async ({ mainWindow }) => {
    const duration = await mainWindow.locator('#add').evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(seconds(duration)).toBeCloseTo(0.16, 2);
  });

  test('wisselen van weergave laat de weergave zacht binnenkomen', async ({ mainWindow }) => {
    const running = await mainWindow.evaluate(() => {
      (document.querySelector('[data-view="week"]') as HTMLElement).click();
      return document.getElementById('view')!.getAnimations().length;
    });
    expect(running).toBeGreaterThan(0);
  });

  test('vorige/volgende schuift de weergave in', async ({ mainWindow }) => {
    const running = await mainWindow.evaluate(() => {
      document.getElementById('next')!.click();
      return document.getElementById('view')!.getAnimations().length;
    });
    expect(running).toBeGreaterThan(0);
  });

  test('een dialoog vervaagt in en uit en is daarna echt verborgen', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    const dialog = mainWindow.locator('#event-dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    await mainWindow.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('met "beweging verminderen" zijn de animaties praktisch uit', async ({ mainWindow }) => {
    await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await mainWindow.locator('#add').evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(seconds(duration)).toBeLessThan(0.001);
    const running = await mainWindow.evaluate(() => {
      (document.querySelector('[data-view="week"]') as HTMLElement).click();
      return document.getElementById('view')!.getAnimations().length;
    });
    expect(running).toBe(0);
  });
});

test.describe('afspraken glijden naar hun nieuwe plek', () => {
  test.use({
    initialFile: JSON.stringify({
      version: 2,
      events: [
        { id: '1', title: 'Eendags', date: '2026-10-14', endDate: '2026-10-14', calendarId: 'home' },
        { id: '2', title: 'Lang', date: '2026-10-24', endDate: '2026-10-28', calendarId: 'work' },
      ],
    }),
  });

  test.beforeEach(async ({ mainWindow }) => {
    await freezeTime(mainWindow, '2026-10-26T10:00:00');
    // alle animate()-aanroepen vastleggen: welke sleutelframes kregen welke elementen
    await mainWindow.evaluate(() => {
      const w = window as unknown as { __animations: { title: string; frames: Keyframe[] }[] };
      w.__animations = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        w.__animations.push({ title: this.textContent ?? '', frames: keyframes as Keyframe[] });
        return original.call(this, keyframes, options);
      };
    });
  });

  const animations = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as { __animations: { title: string; frames: Keyframe[] }[] }).__animations);

  test('een meerdaagse afspraak in twee weekrijen krijgt twee verschillende namen', async ({ mainWindow }) => {
    const names = await mainWindow
      .locator('#view [data-okey]')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.flip));
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names.every((name) => /^o-[\w-]+$/.test(name!))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  test('een verplaatste afspraak schuift van zijn oude naar zijn nieuwe plek', async ({ mainWindow }) => {
    await mainWindow
      .locator('#view [data-okey]', { hasText: 'Eendags' })
      .dragTo(mainWindow.locator('#view [data-key="2026-10-16"]'));
    await expect.poll(async () => (await animations(mainWindow)).some((a) => a.title.includes('Eendags'))).toBe(true);
    const slide = (await animations(mainWindow)).find(
      (a) => a.title.includes('Eendags') && String(a.frames[0].transform).startsWith('translate('),
    );
    expect(slide?.frames[1].transform).toBe('none');
    // de afspraak stond twee dagen eerder: de start is een negatieve verschuiving naar links
    expect(String(slide?.frames[0].transform)).toMatch(/translate\(-\d+/);
  });

  test('een nieuwe afspraak verschijnt met een zachte pop', async ({ mainWindow }) => {
    await mainWindow.evaluate(async (path) => {
      const store = await import(path);
      store.addEvent({ title: 'Nieuweling', date: '2026-10-20' });
    }, STORE);
    await expect
      .poll(async () => (await animations(mainWindow)).some((a) => a.title.includes('Nieuweling')))
      .toBe(true);
    const pop = (await animations(mainWindow)).find((a) => a.title.includes('Nieuweling'))!;
    expect(pop.frames[0]).toMatchObject({ opacity: 0 });
    expect(pop.frames[1]).toMatchObject({ opacity: 1 });
  });

  test('een verwijderde afspraak vervaagt als een niet-klikbare kopie en verdwijnt dan helemaal', async ({
    mainWindow,
  }) => {
    await mainWindow.locator('#view [data-okey]', { hasText: 'Eendags' }).click();
    await mainWindow.keyboard.press('Delete');
    // de kopie is aria-hidden, zonder data-okey (anders telt hij mee voor tests en hulpmiddelen) en zonder pointer-events
    const ghost = mainWindow.locator('body > [aria-hidden="true"]', { hasText: 'Eendags' });
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Eendags' })).toHaveCount(0);
    await expect(ghost).toHaveCount(0, { timeout: 2000 });
  });

  test('de pagina blijft tijdens de animatie bedienbaar: een tweede sleepactie meteen erna lukt', async ({
    mainWindow,
  }) => {
    const chip = mainWindow.locator('#view [data-okey]', { hasText: 'Eendags' });
    await chip.dragTo(mainWindow.locator('#view [data-key="2026-10-16"]'));
    await chip.dragTo(mainWindow.locator('#view [data-key="2026-10-21"]'));
    await expect
      .poll(async () =>
        mainWindow.evaluate(
          async () =>
            ((await window.agenda.load()) as { events: { title: string; date: string }[] }).events.find(
              (e) => e.title === 'Eendags',
            )!.date,
        ),
      )
      .toBe('2026-10-21');
  });

  test('meerdere wijzigingen in één tik worden één tekenronde', async ({ mainWindow }) => {
    const renders = await mainWindow.evaluate(async (path) => {
      const view = document.getElementById('view')!;
      let renders = 0;
      const observer = new MutationObserver((records) => (renders += records.length));
      observer.observe(view, { childList: true });
      const store = await import(path);
      store.addEvent({ title: 'A', date: '2026-10-20' });
      store.addEvent({ title: 'B', date: '2026-10-21' });
      store.addEvent({ title: 'C', date: '2026-10-22' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      observer.disconnect();
      return renders;
    }, STORE);
    expect(renders).toBe(1);
    await expect(mainWindow.locator('#view [data-okey]', { hasText: /^C$/ })).toBeVisible();
  });

  test('met "beweging verminderen" wordt er niet geanimeerd maar wel getekend', async ({ mainWindow }) => {
    await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
    await mainWindow.evaluate(async (path) => {
      const store = await import(path);
      (window as unknown as { __animations: unknown[] }).__animations.length = 0;
      store.addEvent({ title: 'Direct', date: '2026-10-20' });
    }, STORE);
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Direct' })).toBeVisible();
    expect(await animations(mainWindow)).toEqual([]);
  });
});
