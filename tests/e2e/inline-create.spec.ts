import type { Page } from '@playwright/test';
import { expect, freezeTime, resizeWindow, settled, test } from './fixtures.ts';

type Saved = { events: { title: string; date: string; time: string; endTime: string; calendarId: string }[] };
// ontbreekt events.json nog (er is niets bewaard), dan is het resultaat een lege lijst
const saved = (page: Page) => page.evaluate(async () => ((await window.agenda.load()) ?? { events: [] }) as Saved);

const column = (page: Page, key: string) => page.locator(`#view [data-col="${key}"]`);
// y-positie in het venster voor een tijdstip (minuten sinds middernacht) in een kolom
async function yAt(page: Page, key: string, minutes: number) {
  // na een wijziging wordt het raster via een View Transition vervangen: even wachten tot de kolom er weer staat
  let box = null;
  await expect
    .poll(async () => (box = await column(page, key).boundingBox()), { message: `kolom ${key}` })
    .not.toBeNull();
  const { x, y, width } = box!;
  return { x: x + width / 2, y: y + (minutes * 48) / 60 };
}

test.beforeEach(async ({ mainWindow, electronApp }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await resizeWindow(electronApp, 1400, 900);
  await mainWindow.locator('[data-view="week"]').click();
  await settled(mainWindow);
});

const inline = (page: Page) => page.locator('[data-inline]');

async function dragCreate(page: Page, key: string, from: number, to: number) {
  const start = await yAt(page, key, from + 7); // 7 min onder de rand: de start rondt af op 15 minuten
  const end = await yAt(page, key, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

test.describe('titel direct in het raster typen', () => {
  test('slepen maakt een blok met een invoerveld; Enter bewaart de afspraak', async ({ mainWindow }) => {
    await dragCreate(mainWindow, '2026-10-27', 10 * 60, 11 * 60 + 30);
    await expect(inline(mainWindow)).toBeVisible();
    await expect(inline(mainWindow).getByRole('textbox', { name: 'Titel van de nieuwe afspraak' })).toBeFocused();
    await expect(inline(mainWindow)).toContainText('10:00–11:30');
    await expect(mainWindow.locator('#event-dialog')).toBeHidden(); // geen dialoog meer

    await mainWindow.keyboard.type('Overleg met Sam');
    await mainWindow.keyboard.press('Enter');
    await expect(inline(mainWindow)).toHaveCount(0);
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Overleg met Sam' })).toBeVisible();
    const [event] = (await saved(mainWindow)).events;
    expect(event).toMatchObject({
      title: 'Overleg met Sam',
      date: '2026-10-27',
      time: '10:00',
      endTime: '11:30',
      calendarId: 'home',
    });
  });

  test('Escape annuleert zonder iets te bewaren', async ({ mainWindow }) => {
    await dragCreate(mainWindow, '2026-10-27', 9 * 60, 10 * 60);
    await mainWindow.keyboard.type('Niet bewaren');
    await mainWindow.keyboard.press('Escape');
    await expect(inline(mainWindow)).toHaveCount(0);
    expect((await saved(mainWindow)).events).toEqual([]);
  });

  test('wegklikken met een titel bewaart; zonder titel verdwijnt het blok', async ({ mainWindow }) => {
    await dragCreate(mainWindow, '2026-10-28', 13 * 60, 14 * 60);
    await mainWindow.keyboard.type('Via wegklikken');
    await mainWindow.locator('#title').click();
    await expect(inline(mainWindow)).toHaveCount(0);
    await expect.poll(async () => (await saved(mainWindow)).events.map((e) => e.title)).toEqual(['Via wegklikken']);

    await dragCreate(mainWindow, '2026-10-29', 13 * 60, 14 * 60);
    await expect(inline(mainWindow)).toBeVisible();
    await mainWindow.locator('#title').click();
    await expect(inline(mainWindow)).toHaveCount(0);
    expect((await saved(mainWindow)).events).toHaveLength(1);
  });

  test('dubbelklikken maakt een blok van een uur op het dichtstbijzijnde halve uur', async ({ mainWindow }) => {
    const at = await yAt(mainWindow, '2026-10-30', 14 * 60 + 10);
    await mainWindow.mouse.dblclick(at.x, at.y);
    await expect(inline(mainWindow)).toContainText('14:00–15:00');
    await mainWindow.keyboard.type('Dubbelklik');
    await mainWindow.keyboard.press('Enter');
    await expect
      .poll(async () => (await saved(mainWindow)).events[0])
      .toMatchObject({ date: '2026-10-30', time: '14:00', endTime: '15:00' });
  });

  test('Ctrl+Enter opent het volledige formulier met de titel al ingevuld', async ({ mainWindow }) => {
    await dragCreate(mainWindow, '2026-10-27', 15 * 60, 16 * 60);
    await mainWindow.keyboard.type('Meer opties');
    await mainWindow.keyboard.press('Control+Enter');
    await expect(inline(mainWindow)).toHaveCount(0);
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Meer opties');
    await expect(mainWindow.locator('#e-start-time')).toHaveValue('15:00');
    await expect(mainWindow.locator('#e-end-time')).toHaveValue('16:00');
    expect((await saved(mainWindow)).events).toEqual([]);
  });

  test('sneltoetsen van de app doen niets terwijl je typt (Delete en Backspace wissen tekst, niet afspraken)', async ({
    mainWindow,
  }) => {
    await dragCreate(mainWindow, '2026-10-27', 8 * 60, 9 * 60);
    await mainWindow.keyboard.type('abc');
    await mainWindow.keyboard.press('Backspace');
    await expect(inline(mainWindow).getByRole('textbox')).toHaveValue('ab');
  });

  test('een verversing tijdens het typen wist het invoerveld niet; ze wordt daarna alsnog uitgevoerd', async ({
    mainWindow,
  }) => {
    await dragCreate(mainWindow, '2026-10-27', 10 * 60, 11 * 60);
    await mainWindow.keyboard.type('Half getypt');
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Van elders', date: '2026-10-28', time: '09:00', endTime: '10:00' });
    });
    await expect(inline(mainWindow).getByRole('textbox')).toHaveValue('Half getypt');
    await expect(inline(mainWindow).getByRole('textbox')).toBeFocused();
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Van elders' })).toHaveCount(0);

    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Van elders' })).toBeVisible();
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Half getypt' })).toBeVisible();
  });

  test('de nieuwe afspraak gebruikt de standaardmelding uit de voorkeuren', async ({ mainWindow }) => {
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.updateSettings({ defaultAlert: 15 });
    });
    await dragCreate(mainWindow, '2026-10-27', 10 * 60, 11 * 60);
    await mainWindow.keyboard.type('Met melding');
    await mainWindow.keyboard.press('Enter');
    await expect
      .poll(async () => ((await saved(mainWindow)).events[0] as { alert?: number } | undefined)?.alert)
      .toBe(15);
  });
});
