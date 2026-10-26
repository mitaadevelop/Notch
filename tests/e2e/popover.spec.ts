import type { Page } from '@playwright/test';
import { expect, freezeTime, settled, test } from './fixtures.ts';

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      {
        id: '1',
        title: 'Tandarts',
        date: '2026-10-14',
        endDate: '2026-10-14',
        calendarId: 'home',
        time: '10:00',
        endTime: '11:00',
        location: 'Utrecht',
        notes: 'Kaartje meenemen',
      },
      { id: '2', title: 'Vrij', date: '2026-10-21', endDate: '2026-10-21', calendarId: 'work' },
    ],
  }),
});

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: title });
const pop = (page: Page) => page.locator('#event-pop');
const events = (page: Page) =>
  page.evaluate(
    async () =>
      ((await window.agenda.load()) as { events: { title: string; date: string; calendarId: string }[] }).events,
  );

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('voorbeeld bij hover', () => {
  test('na een korte pauze verschijnt een kaartje met de details, en het verdwijnt weer', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').hover();
    await expect(pop(mainWindow)).toBeVisible();
    await expect(pop(mainWindow)).toHaveAttribute('role', 'tooltip');
    await expect(pop(mainWindow)).toContainText('Tandarts');
    await expect(pop(mainWindow)).toContainText('10:00–11:00');
    await expect(pop(mainWindow)).toContainText('Utrecht');
    await expect(pop(mainWindow)).toContainText('Kaartje meenemen');
    await expect(pop(mainWindow).getByRole('button')).toHaveCount(0);

    await mainWindow.mouse.move(5, 400);
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('het hover-kaartje onderschept geen muisklikken', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').hover();
    await expect(pop(mainWindow)).toBeVisible();
    const pointerEvents = await pop(mainWindow).evaluate((node) => getComputedStyle(node).pointerEvents);
    expect(pointerEvents).toBe('none');
  });

  test('tijdens slepen verschijnt er geen kaartje', async ({ mainWindow }) => {
    const box = (await chip(mainWindow, 'Vrij').boundingBox())!;
    await mainWindow.mouse.move(box.x + 10, box.y + 8);
    await mainWindow.mouse.down();
    await mainWindow.mouse.move(box.x + 60, box.y + 8, { steps: 5 });
    await mainWindow.waitForTimeout(800);
    await expect(pop(mainWindow)).toHaveCount(0);
    await mainWindow.mouse.up();
  });
});

// één klik selecteert, een tweede klik op de geselecteerde afspraak zet het kaartje met acties vast
async function open(page: Page, title: string) {
  await chip(page, title).click();
  await expect(pop(page)).toHaveCount(0);
  await chip(page, title).click();
  await expect(pop(page)).toHaveAttribute('role', 'dialog');
}

test.describe('een tweede klik zet het kaartje vast met snelle acties', () => {
  test('toont de acties en blijft staan tot je ergens anders klikt', async ({ mainWindow }) => {
    await open(mainWindow, 'Tandarts');
    await expect(pop(mainWindow).getByRole('button')).toHaveText(['Bewerk', 'Dupliceer', 'Kopieer', 'Verwijder']);
    await mainWindow.mouse.move(5, 400);
    await mainWindow.waitForTimeout(300);
    await expect(pop(mainWindow)).toBeVisible();
    await mainWindow.mouse.click(5, 400);
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Escape sluit het kaartje en laat de selectie staan', async ({ mainWindow }) => {
    await open(mainWindow, 'Tandarts');
    await mainWindow.keyboard.press('Escape');
    await expect(pop(mainWindow)).toHaveCount(0);
    await expect(chip(mainWindow, 'Tandarts')).toHaveClass(/ring-2/);
    await mainWindow.keyboard.press('Escape');
    await expect(chip(mainWindow, 'Tandarts')).not.toHaveClass(/ring-2/);
  });

  test('Bewerk opent de dialoog en sluit het kaartje', async ({ mainWindow }) => {
    await open(mainWindow, 'Tandarts');
    await pop(mainWindow).getByRole('button', { name: 'Bewerk' }).click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(mainWindow.locator('#e-title')).toHaveValue('Tandarts');
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('een enkele klik selecteert alleen en dekt de buurafspraak niet af', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').click();
    await mainWindow.waitForTimeout(600);
    await expect(pop(mainWindow)).toHaveCount(0);
    await expect(chip(mainWindow, 'Tandarts')).toHaveClass(/ring-2/);
  });

  test('dubbelklikken op een geselecteerde afspraak opent de dialoog zonder kaartje', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').click();
    await chip(mainWindow, 'Tandarts').dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await mainWindow.waitForTimeout(500);
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('dubbelklikken opent meteen de dialoog zonder kaartje', async ({ mainWindow }) => {
    await chip(mainWindow, 'Tandarts').dblclick();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Dupliceer maakt een kopie', async ({ mainWindow }) => {
    await open(mainWindow, 'Vrij');
    await pop(mainWindow).getByRole('button', { name: 'Dupliceer' }).click();
    await expect(chip(mainWindow, 'Vrij')).toHaveCount(2);
    await expect.poll(async () => (await events(mainWindow)).filter((e) => e.title === 'Vrij').length).toBe(2);
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('Verwijder haalt de afspraak weg en biedt ongedaan maken', async ({ mainWindow }) => {
    await open(mainWindow, 'Vrij');
    await pop(mainWindow).getByRole('button', { name: 'Verwijder' }).click();
    await expect(chip(mainWindow, 'Vrij')).toHaveCount(0);
    await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(chip(mainWindow, 'Vrij')).toBeVisible();
  });

  test('Kopieer meldt dat de afspraak gekopieerd is', async ({ mainWindow }) => {
    await open(mainWindow, 'Vrij');
    await pop(mainWindow).getByRole('button', { name: 'Kopieer' }).click();
    await expect(mainWindow.getByText('Afspraak gekopieerd.')).toBeVisible();
    await expect(pop(mainWindow)).toHaveCount(0);
  });

  test('de agenda kiezen verplaatst de afspraak naar die agenda', async ({ mainWindow }) => {
    await open(mainWindow, 'Tandarts');
    await pop(mainWindow).getByRole('combobox').selectOption({ label: 'Werk' });
    await expect
      .poll(async () => (await events(mainWindow)).find((e) => e.title === 'Tandarts')?.calendarId)
      .toBe('work');
    await expect(mainWindow.getByRole('status')).toContainText('Verplaatst naar Werk');
  });

  test('klikken op een andere afspraak vervangt het kaartje', async ({ mainWindow }) => {
    await open(mainWindow, 'Tandarts');
    await expect(pop(mainWindow)).toContainText('Tandarts');
    await open(mainWindow, 'Vrij');
    await expect(pop(mainWindow)).toHaveCount(1);
    await expect(pop(mainWindow)).toContainText('Vrij');
  });
});
