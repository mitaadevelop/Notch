import type { Locator, Page } from '@playwright/test';
import { choose, expect, freezeTime, recordMenus, resizeWindow, settled, shownMenus, test } from './fixtures.ts';

const event = (id: string, title: string, date: string, extra: Record<string, unknown> = {}) => ({
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
      event('1', 'Hele dag', '2026-10-14'),
      event('2', 'Overleg', '2026-10-27', { time: '10:00', endTime: '11:00' }),
    ],
  }),
});

type Saved = { events: { title: string; date: string; time: string; endTime: string; repeat: unknown }[] };
const saved = (page: Page) => page.evaluate(async () => (await window.agenda.load()) as Saved);
const titles = async (page: Page, title: string) => (await saved(page)).events.filter((e) => e.title === title);

const day = (page: Page, key: string) => page.locator(`#view [data-key="${key}"]`);
const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: title });

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
});

test.describe('contextmenu op een lege plek', () => {
  test('toont "Nieuwe afspraak" en een uitgeschakelde "Plak", en opent de dialoog op die dag', async ({
    mainWindow,
    electronApp,
  }) => {
    await recordMenus(electronApp);
    await choose(electronApp, 'Nieuwe afspraak');
    await day(mainWindow, '2026-10-20').click({ button: 'right' });

    expect(await shownMenus(electronApp)).toEqual([
      [
        { label: 'Nieuwe afspraak', enabled: true },
        { label: 'Plak', enabled: false },
      ],
    ]);
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-start-date')).toHaveValue('2026-10-20');
    await expect(mainWindow.locator('#e-allday')).toBeChecked();
  });

  test('kopiëren en plakken met alleen de muis', async ({ mainWindow, electronApp }) => {
    await recordMenus(electronApp);
    await choose(electronApp, 'Kopieer');
    await chip(mainWindow, 'Hele dag').click({ button: 'right' });

    await choose(electronApp, 'Plak');
    await day(mainWindow, '2026-10-21').click({ button: 'right' });

    // nu is "Plak" beschikbaar
    const menus = await shownMenus(electronApp);
    expect(menus.at(-1)).toEqual([
      { label: 'Nieuwe afspraak', enabled: true },
      { label: 'Plak', enabled: true },
    ]);
    await expect(chip(mainWindow, 'Hele dag')).toHaveCount(2);
    expect((await titles(mainWindow, 'Hele dag')).map((e) => e.date).sort()).toEqual(['2026-10-14', '2026-10-21']);
  });

  test('in de weekweergave plakt een rechtermuisklik op het uurraster op dat tijdstip', async ({
    mainWindow,
    electronApp,
  }) => {
    await recordMenus(electronApp);
    await mainWindow.locator('[data-view="week"]').click();
    await choose(electronApp, 'Kopieer');
    await chip(mainWindow, 'Overleg').click({ button: 'right' });

    // dinsdag 27 okt = tweede kolom; het uurraster staat standaard vanaf 07:00, dus 13:00 is 6 uur lager
    const block = await chip(mainWindow, 'Overleg').boundingBox();
    const target = { x: block!.x + block!.width / 2, y: block!.y + 3 * 48 + 5 };
    await choose(electronApp, 'Plak');
    await mainWindow.mouse.click(target.x, target.y, { button: 'right' });

    await expect.poll(async () => (await titles(mainWindow, 'Overleg')).length).toBe(2);
    const copy = (await titles(mainWindow, 'Overleg')).find((e) => e.time !== '10:00')!;
    // 3 uur lager dan 10:00 = 13:00, met dezelfde duur van een uur
    expect([copy.time, copy.endTime]).toEqual(['13:00', '14:00']);
  });
});

test.describe('slepen met de muis', () => {
  test('een afspraak naar een andere dag slepen verplaatst hem', async ({ mainWindow }) => {
    await chip(mainWindow, 'Hele dag').dragTo(day(mainWindow, '2026-10-16'));
    await expect.poll(async () => (await titles(mainWindow, 'Hele dag')).map((e) => e.date)).toEqual(['2026-10-16']);
  });

  test('met Alt ingedrukt wordt de afspraak gekopieerd in plaats van verplaatst', async ({ mainWindow }) => {
    await mainWindow.keyboard.down('Alt');
    await chip(mainWindow, 'Hele dag').dragTo(day(mainWindow, '2026-10-16'));
    await mainWindow.keyboard.up('Alt');
    await expect
      .poll(async () => (await titles(mainWindow, 'Hele dag')).map((e) => e.date).sort())
      .toEqual(['2026-10-14', '2026-10-16']);
  });

  test('een afspraak op een dag in de minikalender neerzetten verplaatst hem', async ({ mainWindow }) => {
    const miniDay = mainWindow.locator('#mini-grid button', { hasText: /^22$/ });
    await chip(mainWindow, 'Hele dag').dragTo(miniDay);
    await expect.poll(async () => (await titles(mainWindow, 'Hele dag')).map((e) => e.date)).toEqual(['2026-10-22']);
  });

  test('over meerdere dagen slepen maakt een meerdaagse afspraak', async ({ mainWindow }) => {
    const from = (await day(mainWindow, '2026-10-19').boundingBox())!;
    const to = (await day(mainWindow, '2026-10-21').boundingBox())!;
    await mainWindow.mouse.move(from.x + 20, from.y + 60);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(to.x + 20, to.y + 60, { steps: 8 });
    // tijdens het slepen zijn de dagen gemarkeerd
    await expect(mainWindow.locator('#view [data-key].ring-2')).toHaveCount(3);
    await mainWindow.mouse.up();

    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-start-date')).toHaveValue('2026-10-19');
    await expect(mainWindow.locator('#e-end-date')).toHaveValue('2026-10-21');
    await expect(mainWindow.locator('#e-allday')).toBeChecked();
    // de markering is weer weg
    await expect(mainWindow.locator('#view [data-key].ring-2')).toHaveCount(0);
  });

  test('een gewone klik op een dag maakt geen afspraak', async ({ mainWindow }) => {
    await day(mainWindow, '2026-10-20').click();
    await expect(mainWindow.locator('#event-dialog')).toBeHidden();
  });
});

test.describe('slepen in het uurraster', () => {
  async function dragBlock(page: Page, block: Locator, dy: number, alt: boolean) {
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 12 + dy / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + 12 + dy, { steps: 4 });
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  }

  test.beforeEach(async ({ mainWindow, electronApp }) => {
    await resizeWindow(electronApp, 1400, 900);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
  });

  test('een afspraak een uur naar beneden slepen verschuift hem', async ({ mainWindow }) => {
    await dragBlock(mainWindow, chip(mainWindow, 'Overleg'), 48, false);
    await expect.poll(async () => (await titles(mainWindow, 'Overleg')).map((e) => e.time)).toEqual(['11:00']);
  });

  test('tijdens het slepen toont een label dag en tijd, en na het loslaten is het weg', async ({ mainWindow }) => {
    const box = (await chip(mainWindow, 'Overleg').boundingBox())!;
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + 12);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + 12 + 48, { steps: 6 });
    const label = mainWindow.locator('#drag-label');
    await expect(label).toHaveText('di 27 okt · 11:00–12:00');
    await mainWindow.mouse.up();
    await expect(label).toHaveCount(0);
  });

  test('met Alt ingedrukt noemt het label dat het een kopie wordt', async ({ mainWindow }) => {
    const box = (await chip(mainWindow, 'Overleg').boundingBox())!;
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + 12);
    await mainWindow.mouse.down();
    await mainWindow.keyboard.down('Alt');
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + 12 + 48, { steps: 6 });
    await expect(mainWindow.locator('#drag-label')).toHaveText(/^Kopie · di 27 okt/);
    await mainWindow.mouse.up();
    await mainWindow.keyboard.up('Alt');
  });

  test('vergroten toont de nieuwe eindtijd met de duur', async ({ mainWindow }) => {
    const box = (await chip(mainWindow, 'Overleg').boundingBox())!;
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + box.height - 2 + 24, { steps: 5 });
    await expect(mainWindow.locator('#drag-label')).toHaveText('10:00–11:30 (1 u 30 min)');
    await mainWindow.mouse.up();
    await expect.poll(async () => (await titles(mainWindow, 'Overleg'))[0].endTime).toBe('11:30');
  });

  test('bij de onderrand van het raster scrollt het vanzelf mee en schuift de afspraak mee', async ({
    mainWindow,
    electronApp,
  }) => {
    // een laag venster, zodat er ruimte is om te scrollen (24 uur = 1152 px)
    await resizeWindow(electronApp, 1400, 520);
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
    const scroller = mainWindow.locator('#view .overflow-y-auto');
    const rect = (await scroller.boundingBox())!;
    const before = await scroller.evaluate((node) => node.scrollTop);
    const box = (await chip(mainWindow, 'Overleg').boundingBox())!;
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + 12);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(box.x + box.width / 2, rect.y + rect.height - 10, { steps: 6 });
    await mainWindow.waitForTimeout(700);
    await mainWindow.mouse.up();

    // vers opvragen: na het loslaten wordt het raster opnieuw getekend en is het oude element al losgekoppeld
    await expect
      .poll(() => mainWindow.evaluate(() => document.querySelector('#view .overflow-y-auto')?.scrollTop ?? -1))
      .toBeGreaterThan(before + 100);
    // de afspraak is aanzienlijk later geworden dan alleen de zichtbare afstand verklaart
    const [moved] = await titles(mainWindow, 'Overleg');
    expect(moved.time > '15:00').toBe(true);
  });

  test('met Alt ingedrukt bij het loslaten blijft het origineel staan en komt er een kopie', async ({ mainWindow }) => {
    await dragBlock(mainWindow, chip(mainWindow, 'Overleg'), 48, true);
    await expect
      .poll(async () => (await titles(mainWindow, 'Overleg')).map((e) => e.time).sort())
      .toEqual(['10:00', '11:00']);
  });
});
