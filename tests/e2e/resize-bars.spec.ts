import type { Page } from '@playwright/test';
import { calendarText, startFeed, vevent } from '../helpers/servers.ts';
import { clickMenu, expect, freezeTime, settled, test } from './fixtures.ts';

const ev = (id: string, title: string, date: string, endDate = date, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  date,
  endDate,
  calendarId: 'home',
  ...extra,
});

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      ev('1', 'Reis', '2026-10-20', '2026-10-22'),
      ev('2', 'Dag', '2026-10-14'),
      ev('3', 'Reeks', '2026-10-06', '2026-10-07', { repeat: { freq: 'weekly', interval: 1, until: '' } }),
      ev('4', 'Congres', '2026-10-27', '2026-10-28'),
    ],
  }),
});

const chip = (page: Page, title: string) =>
  page.locator('#view [data-okey]', { hasText: new RegExp(`^${title}`) }).first();
const day = (page: Page, key: string) => page.locator(`#view [data-key="${key}"]`);
const eventById = async (page: Page, id: string) =>
  (
    await page.evaluate(
      async () => ((await window.agenda.load()) as { events: { id: string; date: string; endDate: string }[] }).events,
    )
  ).find((e) => e.id === id)!;
const reis = (page: Page) => eventById(page, '1');

async function dragEdge(page: Page, title: string, edge: 'start' | 'end', toKey: string, release = true) {
  await settled(page); // na een vorige wijziging schuift de balk nog even: pas meten als hij stilstaat
  const handle = chip(page, title).locator(`[data-edge="${edge}"]`);
  const from = (await handle.boundingBox())!;
  const to = (await day(page, toKey).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 8 });
  if (release) await page.mouse.up();
}

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('meerdaagse balk vergroten en verkleinen (maand)', () => {
  test('de rechterrand naar rechts slepen verlengt de afspraak, met label en ongedaan maken', async ({
    mainWindow,
  }) => {
    await dragEdge(mainWindow, 'Reis', 'end', '2026-10-24', false);
    await expect(mainWindow.locator('#drag-label')).toHaveText('di 20 okt – za 24 okt (5 dagen)');
    await expect(mainWindow.locator('#view [data-key].ring-2')).toHaveCount(5);
    await mainWindow.mouse.up();
    await expect.poll(async () => (await reis(mainWindow)).endDate).toBe('2026-10-24');
    expect((await reis(mainWindow)).date).toBe('2026-10-20');
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak aangepast');
    await expect(mainWindow.locator('#view [data-key].ring-2')).toHaveCount(0);

    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(async () => (await reis(mainWindow)).endDate).toBe('2026-10-22');
  });

  test('de linkerrand naar links verlengt aan het begin; naar rechts verkort', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Reis', 'start', '2026-10-19');
    await expect.poll(async () => (await reis(mainWindow)).date).toBe('2026-10-19');
    expect((await reis(mainWindow)).endDate).toBe('2026-10-22');

    await dragEdge(mainWindow, 'Reis', 'start', '2026-10-21');
    await expect.poll(async () => (await reis(mainWindow)).date).toBe('2026-10-21');
  });

  test('de balk blijft minstens één dag lang, ook als je voorbij de andere rand sleept', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Reis', 'end', '2026-10-17');
    await expect.poll(async () => (await reis(mainWindow)).endDate).toBe('2026-10-20');
    expect((await reis(mainWindow)).date).toBe('2026-10-20');
  });

  test('loslaten op dezelfde dag verandert niets en geeft geen melding', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Reis', 'end', '2026-10-22');
    await mainWindow.waitForTimeout(300);
    expect((await reis(mainWindow)).endDate).toBe('2026-10-22');
    await expect(mainWindow.getByRole('status')).toHaveCount(0);
  });

  test('over een weekgrens heen slepen werkt', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Reis', 'end', '2026-10-28');
    await expect.poll(async () => (await reis(mainWindow)).endDate).toBe('2026-10-28');
  });

  test('de balk zelf slepen verplaatst hem nog steeds als geheel', async ({ mainWindow }) => {
    await chip(mainWindow, 'Reis').dragTo(day(mainWindow, '2026-10-08'), { sourcePosition: { x: 60, y: 8 } });
    await expect.poll(async () => (await reis(mainWindow)).date).not.toBe('2026-10-20');
    const moved = await reis(mainWindow);
    expect(moved.endDate > moved.date).toBe(true);
    // de lengte van drie dagen blijft
    expect(new Date(moved.endDate).getTime() - new Date(moved.date).getTime()).toBe(2 * 86400000);
  });

  test('een enkele hele-dag-afspraak kan ook over meerdere dagen worden uitgerekt', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Dag', 'end', '2026-10-16');
    await expect
      .poll(async () => {
        const events = await mainWindow.evaluate(
          async () => ((await window.agenda.load()) as { events: { id: string; endDate: string }[] }).events,
        );
        return events.find((e) => e.id === '2')!.endDate;
      })
      .toBe('2026-10-16');
  });

  test('bij een herhalende afspraak vraagt de app om het bereik', async ({ mainWindow }) => {
    await dragEdge(mainWindow, 'Reeks', 'end', '2026-10-09');
    const scope = mainWindow.locator('#scope-dialog');
    await expect(scope).toBeVisible();
    await scope.getByRole('button', { name: 'Annuleer' }).click();
    const events = await mainWindow.evaluate(
      async () => ((await window.agenda.load()) as { events: { id: string; endDate: string }[] }).events,
    );
    expect(events.find((e) => e.id === '3')!.endDate).toBe('2026-10-07');
  });

  test('een feestdag en een alleen-lezen afspraak hebben geen grepen', async ({ mainWindow, electronApp }) => {
    await expect(mainWindow.locator('#view [data-edge]').first()).toBeVisible(); // wel bij eigen afspraken
    const holiday = mainWindow.locator('#view button', { hasText: 'Einde zomertijd' });
    await expect(holiday).toBeVisible();
    await expect(holiday.locator('[data-edge]')).toHaveCount(0);

    const feed = await startFeed({
      body: calendarText('Extern', vevent('x', 'Conferentie', '20261027', ['DTEND;VALUE=DATE:20261030'])),
    });
    try {
      await clickMenu(electronApp, 'Agenda-account of link toevoegen…');
      await mainWindow.locator('#src-url').fill(feed.calendarUrl);
      await mainWindow.locator('#src-submit').click();
      await expect(chip(mainWindow, 'Conferentie')).toBeVisible();
      await expect(chip(mainWindow, 'Conferentie').locator('[data-edge]')).toHaveCount(0);
    } finally {
      await feed.close();
    }
  });
});

test.describe('hele-dag-rij in de weekweergave', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await mainWindow.locator('[data-view="week"]').click();
    await settled(mainWindow);
  });

  test('een balk heeft grepen en laat zich met de muis verlengen', async ({ mainWindow }) => {
    const handle = chip(mainWindow, 'Congres').locator('[data-edge="end"]');
    await expect(handle).toBeVisible();
    const from = (await handle.boundingBox())!;
    const target = (await day(mainWindow, '2026-10-30').boundingBox())!;
    await mainWindow.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(target.x + target.width / 2, target.y + 8, { steps: 8 });
    await mainWindow.mouse.up();
    await expect.poll(async () => (await eventById(mainWindow, '4')).endDate).toBe('2026-10-30');
  });

  test('over meerdere dagen slepen in de hele-dag-rij maakt een meerdaagse afspraak', async ({ mainWindow }) => {
    // vr 30 okt t/m zo 1 nov: een deel van de rij zonder balken
    const start = (await day(mainWindow, '2026-10-30').boundingBox())!;
    const end = (await day(mainWindow, '2026-11-01').boundingBox())!;
    await mainWindow.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
    await expect(mainWindow.locator('#view [data-key].ring-2')).toHaveCount(3);
    await mainWindow.mouse.up();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-start-date')).toHaveValue('2026-10-30');
    await expect(mainWindow.locator('#e-end-date')).toHaveValue('2026-11-01');
    await expect(mainWindow.locator('#e-allday')).toBeChecked();
  });
});
