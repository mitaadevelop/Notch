import type { Page } from '@playwright/test';
import { describeViolations, runAxe } from './axe.ts';
import { clickMenu, expect, test } from './fixtures.ts';

// BEKENDE PROBLEMEN (gevonden door axe, niet gerepareerd: de tests mogen productiecode niet aanpassen).
// De tests slagen zolang er geen NIEUWE soorten problemen bijkomen; haal een regel hier weg zodra het gerepareerd is.
const KNOWN: Record<string, string> = {
  'color-contrast': 'gedempte tekst (--muted) heeft te weinig contrast, o.a. weekdagen, uren en dagen buiten de maand',
  'scrollable-region-focusable': 'het uurraster in dag/week scrolt maar is niet met het toetsenbord te bereiken',
  label: 'de datum- en tijdvelden in de afspraakdialoog hebben geen label',
};

async function expectNoNewViolations(page: Page) {
  const violations = await runAxe(page);
  const unknown = violations.filter((v) => !(v.id in KNOWN));
  for (const v of violations) {
    if (v.id in KNOWN) test.info().annotations.push({ type: `bekend: ${v.id}`, description: KNOWN[v.id] });
  }
  expect(describeViolations(unknown), 'nieuwe toegankelijkheidsproblemen').toEqual([]);
}

test.describe('toegankelijkheid (axe)', () => {
  test('maandweergave, licht en donker', async ({ mainWindow }) => {
    await expectNoNewViolations(mainWindow);
    await mainWindow.emulateMedia({ colorScheme: 'dark' });
    await expectNoNewViolations(mainWindow);
  });

  for (const view of ['day', 'week', 'year', 'list']) {
    test(`${view}-weergave`, async ({ mainWindow }) => {
      await mainWindow.locator(`[data-view="${view}"]`).click();
      await expectNoNewViolations(mainWindow);
    });
  }

  test('snel invoeren', async ({ mainWindow }) => {
    await mainWindow.locator('#add').click();
    await expect(mainWindow.locator('#quick')).toBeVisible();
    await expectNoNewViolations(mainWindow);
  });

  test('afspraakdialoog en voorkeuren', async ({ mainWindow, electronApp }) => {
    await mainWindow.locator('#add').click();
    await mainWindow.locator('#q-more').click();
    await expect(mainWindow.locator('#event-dialog')).toBeVisible();
    await expectNoNewViolations(mainWindow);
    await mainWindow.keyboard.press('Escape');

    await electronApp.evaluate(({ Menu }) => {
      const app = Menu.getApplicationMenu()!.items[0].submenu!.items.find((i) => i.label === 'Voorkeuren…')!;
      app.click();
    });
    await expect(mainWindow.locator('#settings-dialog')).toBeVisible();
    await expectNoNewViolations(mainWindow);
  });

  test('agenda toevoegen (alle soorten)', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Agenda-account of link toevoegen…');
    await expect(mainWindow.locator('#source-dialog')).toBeVisible();
    for (const kind of ['Google Agenda', 'iCloud', 'CalDAV-server']) {
      await mainWindow.locator('#src-kind').selectOption({ label: kind });
      await expectNoNewViolations(mainWindow);
    }
    // alle velden hebben een label, ook de verborgen rijen (axe controleert alleen zichtbare, dus ook per soort hierboven)
    const unlabeled = await mainWindow
      .locator('#source-form input, #source-form select')
      .evaluateAll((nodes) =>
        nodes.filter((node) => !(node as HTMLInputElement).labels?.length).map((node) => node.id),
      );
    expect(unlabeled).toEqual([]);
  });

  test('commandopalet', async ({ mainWindow, electronApp }) => {
    await clickMenu(electronApp, 'Commandopalet…');
    await expect(mainWindow.locator('#palette')).toBeVisible();
    await expectNoNewViolations(mainWindow);
    await mainWindow.keyboard.type('week');
    await expectNoNewViolations(mainWindow);
  });

  test('alle knoppen en velden hebben een toegankelijke naam', async ({ mainWindow }) => {
    // strenger dan de bekende-lijst: deze regels hoeven niet te falen en horen dat ook niet te doen
    const violations = await runAxe(mainWindow, {
      runOnly: [
        'button-name',
        'link-name',
        'aria-valid-attr',
        'aria-valid-attr-value',
        'duplicate-id',
        'html-has-lang',
        'document-title',
      ],
    });
    expect(describeViolations(violations)).toEqual([]);
  });
});
