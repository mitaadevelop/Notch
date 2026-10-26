import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { calendarText, startCalDav, startFeed, vevent } from '../helpers/servers.ts';
import { choose, clickMenu, expect, freezeTime, launchApp, recordMenus, shownMenus, test } from './fixtures.ts';

const FEED = (title = 'Training') =>
  calendarText('Sportclub', vevent('t1', title, '20261028T190000', ['DTEND:20261028T200000', 'LOCATION:Sporthal']));

const ADD = 'Agenda-account of link toevoegen…';
const REFRESH = 'Vernieuw externe agenda’s';

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: title });
const calendarRow = (page: Page, name: string) => page.locator('#cal-list li', { hasText: name });
const stored = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'events.json'), 'utf8')) as {
    calendars: { name: string; source?: { kind: string; url?: string } }[];
    events: { title: string }[];
  };

async function addFeed(page: Page, app: ElectronApplication, url: string, kind = 'Google Agenda') {
  await clickMenu(app, ADD);
  await expect(page.locator('#source-dialog')).toBeVisible();
  await page.locator('#src-kind').selectOption({ label: kind });
  await page.locator('#src-url').fill(url);
  await page.locator('#src-submit').click();
  await expect(page.locator('#source-dialog')).toBeHidden();
}

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
});

test.describe('agenda via een link (Google, Outlook, iCloud, …)', () => {
  test('toevoegen vanuit het menu: de agenda en zijn afspraken verschijnen', async ({ mainWindow, electronApp }) => {
    const feed = await startFeed({ body: FEED() });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await expect(calendarRow(mainWindow, 'Sportclub')).toBeVisible(); // naam uit de feed
      await expect(chip(mainWindow, 'Training')).toBeVisible();
      expect(feed.requests.map((r) => r.path)).toEqual(['/agenda.ics']);
    } finally {
      await feed.close();
    }
  });

  test('een afspraak uit de feed is alleen-lezen: bekijken kan, slepen en bewerken niet', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED() });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await expect(chip(mainWindow, 'Training')).toBeVisible();
      await expect(chip(mainWindow, 'Training')).not.toHaveAttribute('draggable', 'true');

      await chip(mainWindow, 'Training').dblclick();
      await expect(mainWindow.locator('#event-dialog')).toBeVisible();
      await expect(mainWindow.locator('#e-readonly')).toContainText('Alleen-lezen');
      await expect(mainWindow.locator('#e-title')).toHaveValue('Training');
      await expect(mainWindow.locator('#e-location')).toHaveValue('Sporthal');
      await expect(mainWindow.locator('#e-save')).toBeHidden();
      await expect(mainWindow.locator('#e-delete')).toBeHidden();
      await mainWindow.keyboard.press('Escape');

      // Delete op een geselecteerde externe afspraak verwijdert niets
      await chip(mainWindow, 'Training').click();
      await mainWindow.keyboard.press('Delete');
      await expect(mainWindow.getByText('kan hier niet worden verwijderd')).toBeVisible();
      await expect(chip(mainWindow, 'Training')).toBeVisible();
    } finally {
      await feed.close();
    }
  });

  test('het contextmenu biedt bekijken, dupliceren en kopiëren, en plakken maakt een eigen kopie', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    const feed = await startFeed({ body: FEED() });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await recordMenus(electronApp);
      await choose(electronApp, 'Kopieer');
      await chip(mainWindow, 'Training').click({ button: 'right' });
      expect((await shownMenus(electronApp))[0].map((i) => i.label)).toEqual(['Bekijk…', 'Dupliceer', 'Kopieer']);

      await choose(electronApp, 'Plak');
      await mainWindow.locator('#view [data-key="2026-10-30"]').click({ button: 'right' });
      await expect(chip(mainWindow, 'Training')).toHaveCount(2);
      await expect.poll(() => stored(userDataDir).events.length).toBe(2);
    } finally {
      await feed.close();
    }
  });

  test('vernieuwen haalt wijzigingen op en laat verdwenen afspraken verdwijnen', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED('Oud') });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await expect(chip(mainWindow, 'Oud')).toBeVisible();

      feed.state.body = FEED('Nieuw');
      await clickMenu(electronApp, REFRESH);
      await expect(mainWindow.getByText('Externe agenda’s zijn bijgewerkt.')).toBeVisible();
      await expect(chip(mainWindow, 'Nieuw')).toBeVisible();
      await expect(chip(mainWindow, 'Oud')).toHaveCount(0);
    } finally {
      await feed.close();
    }
  });

  test('een mislukte verversing toont een waarschuwing en laat de oude afspraken staan', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED() });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      feed.state.status = 500;
      await clickMenu(electronApp, REFRESH);
      await expect(mainWindow.getByText('Vernieuwen mislukt voor: Sportclub.')).toBeVisible();
      await expect(
        calendarRow(mainWindow, 'Sportclub').getByRole('img', {
          name: /Vernieuwen mislukt: De server gaf een fout \(500\)/,
        }),
      ).toBeVisible();
      await expect(chip(mainWindow, 'Training')).toBeVisible();

      // herstel: de waarschuwing verdwijnt weer
      feed.state.status = 200;
      await clickMenu(electronApp, REFRESH);
      await expect(calendarRow(mainWindow, 'Sportclub').getByRole('img')).toHaveCount(0);
    } finally {
      await feed.close();
    }
  });

  test('bij een fout bij het toevoegen blijft de dialoog open met uitleg', async ({ mainWindow, electronApp }) => {
    const feed = await startFeed({ status: 404, body: 'weg' });
    try {
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-url').fill(feed.calendarUrl);
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#src-error')).toContainText('bestaat niet');
      await expect(mainWindow.locator('#source-dialog')).toBeVisible();
      await expect(mainWindow.locator('#cal-list li')).toHaveCount(4);
    } finally {
      await feed.close();
    }
  });

  test('geen agenda (een webpagina) wordt herkend', async ({ mainWindow, electronApp }) => {
    const feed = await startFeed({ body: '<html>Log in</html>' });
    try {
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-url').fill(feed.calendarUrl);
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#src-error')).toContainText('geen agenda');
    } finally {
      await feed.close();
    }
  });

  test('de agenda blijft na een herstart en wordt bij het opstarten meteen ververst', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    const feed = await startFeed({ body: FEED('Voor herstart') });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await expect.poll(() => stored(userDataDir).calendars.some((c) => c.source?.url === feed.calendarUrl)).toBe(true);
      await electronApp.close();

      feed.state.body = FEED('Na herstart');
      const again = await launchApp(userDataDir);
      await freezeTime(again.window, '2026-10-26T10:00:00');
      await expect(chip(again.window, 'Na herstart')).toBeVisible();
      await again.app.close();
    } finally {
      await feed.close();
    }
  });

  test('de agenda verwijderen haalt ook zijn afspraken weg', async ({ mainWindow, electronApp, userDataDir }) => {
    const feed = await startFeed({ body: FEED() });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await recordMenus(electronApp);
      await choose(electronApp, 'Verwijder…');
      await calendarRow(mainWindow, 'Sportclub').click({ button: 'right' });
      await expect(mainWindow.locator('#calendar-dialog')).toBeVisible();
      await mainWindow.locator('#c-delete').click();
      await mainWindow.locator('#c-delete').click(); // bevestigen: "Zeker? n afspraken gaan mee"
      await expect(calendarRow(mainWindow, 'Sportclub')).toHaveCount(0);
      await expect(chip(mainWindow, 'Training')).toHaveCount(0);
      await expect.poll(() => stored(userDataDir).events.length).toBe(0);
    } finally {
      await feed.close();
    }
  });
});

test.describe('account met inloggen (iCloud, CalDAV)', () => {
  // De echte sleutelhanger zou om toestemming vragen en op CI ontbreken: vervang de versleuteling door een nepversie.
  async function fakeEncryption(app: ElectronApplication) {
    await app.evaluate(({ safeStorage }) => {
      Object.assign(safeStorage, {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text: string) => Buffer.from([...text].reverse().join('')),
        decryptString: (data: Buffer) => [...data.toString()].reverse().join(''),
      });
    });
  }

  test('verbinden, agenda kiezen, afspraken zien; het wachtwoord staat nergens leesbaar', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    const PASSWORD = 'geheim-wachtwoord-123';
    const server = await startCalDav({
      user: 'sam',
      password: PASSWORD,
      events: [
        vevent('a', 'Overleg', '20261028T100000', ['DTEND:20261028T110000']),
        vevent('b', 'Lunch', '20261029T120000'),
      ],
    });
    try {
      await fakeEncryption(electronApp);
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-kind').selectOption({ label: 'CalDAV-server' });
      await mainWindow.locator('#src-server').fill(server.url);
      await mainWindow.locator('#src-user').fill('sam');
      await mainWindow.locator('#src-pass').fill(PASSWORD);
      await mainWindow.locator('#src-submit').click();

      // stap 2: kies uit de gevonden agenda's
      await expect(mainWindow.locator('#src-calendars')).toBeVisible();
      await expect(mainWindow.getByRole('checkbox', { name: 'Werk & Co' })).toBeChecked();
      await expect(mainWindow.locator('#src-pass')).toHaveValue('');
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#source-dialog')).toBeHidden();

      await expect(calendarRow(mainWindow, 'Werk & Co')).toBeVisible();
      await expect(chip(mainWindow, 'Overleg')).toBeVisible();
      await expect(chip(mainWindow, 'Lunch')).toBeVisible();

      // het wachtwoord is nergens leesbaar: niet in events.json, niet in accounts.json, niet in de pagina
      await expect.poll(() => existsSync(path.join(userDataDir, 'accounts.json'))).toBe(true);
      expect(readFileSync(path.join(userDataDir, 'events.json'), 'utf8')).not.toContain(PASSWORD);
      const accounts = readFileSync(path.join(userDataDir, 'accounts.json'), 'utf8');
      expect(accounts).not.toContain(PASSWORD);
      expect(accounts).toContain('sam');
      expect(
        await mainWindow.evaluate(() => document.documentElement.outerHTML.includes('geheim-wachtwoord-123')),
      ).toBe(false);

      // de gekozen kleur en bron zijn bewaard
      const calendar = stored(userDataDir).calendars.find((c) => c.name === 'Werk & Co')!;
      expect(calendar.source?.kind).toBe('caldav');
    } finally {
      await server.close();
    }
  });

  test('een verkeerd wachtwoord toont een melding en bewaart niets', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    const server = await startCalDav({ user: 'sam', password: 'goed', events: [] });
    try {
      await fakeEncryption(electronApp);
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-kind').selectOption({ label: 'CalDAV-server' });
      await mainWindow.locator('#src-server').fill(server.url);
      await mainWindow.locator('#src-user').fill('sam');
      await mainWindow.locator('#src-pass').fill('fout');
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#src-error')).toContainText('Inloggen mislukt');
      await expect(mainWindow.locator('#src-calendars')).toBeHidden();
      expect(existsSync(path.join(userDataDir, 'accounts.json'))).toBe(false);
    } finally {
      await server.close();
    }
  });

  test('zonder beveiligde opslag op het systeem wordt er niet ingelogd', async ({ mainWindow, electronApp }) => {
    const server = await startCalDav({ user: 'sam', password: 'goed', events: [] });
    try {
      await electronApp.evaluate(({ safeStorage }) => {
        Object.assign(safeStorage, { isEncryptionAvailable: () => false });
      });
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-kind').selectOption({ label: 'CalDAV-server' });
      await mainWindow.locator('#src-server').fill(server.url);
      await mainWindow.locator('#src-user').fill('sam');
      await mainWindow.locator('#src-pass').fill('goed');
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#src-error')).toContainText('veilig opslaan');
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  test('annuleren na het verbinden ruimt het account op', async ({ mainWindow, electronApp, userDataDir }) => {
    const server = await startCalDav({ user: 'sam', password: 'goed', events: [] });
    try {
      await fakeEncryption(electronApp);
      await clickMenu(electronApp, ADD);
      await mainWindow.locator('#src-kind').selectOption({ label: 'CalDAV-server' });
      await mainWindow.locator('#src-server').fill(server.url);
      await mainWindow.locator('#src-user').fill('sam');
      await mainWindow.locator('#src-pass').fill('goed');
      await mainWindow.locator('#src-submit').click();
      await expect(mainWindow.locator('#src-calendars')).toBeVisible();
      await expect.poll(() => existsSync(path.join(userDataDir, 'accounts.json'))).toBe(true);
      await mainWindow.locator('#src-cancel').click();
      await expect
        .poll(
          () => Object.keys(JSON.parse(readFileSync(path.join(userDataDir, 'accounts.json'), 'utf8')) as object).length,
        )
        .toBe(0);
    } finally {
      await server.close();
    }
  });
});

test.describe('de sidebar-knop', () => {
  test('"+" naast Agenda\'s biedt nieuwe agenda en externe agenda toevoegen', async ({ mainWindow, electronApp }) => {
    await recordMenus(electronApp);
    await choose(electronApp, 'Google, Outlook, iCloud of link toevoegen…');
    await mainWindow.locator('#cal-add').click();
    expect((await shownMenus(electronApp))[0].map((i) => i.label)).toEqual([
      'Nieuwe agenda…',
      'Google, Outlook, iCloud of link toevoegen…',
    ]);
    await expect(mainWindow.locator('#source-dialog')).toBeVisible();
  });
});

test.describe('vernieuwen: knop en interval', () => {
  const button = (page: Page) => page.getByRole('button', { name: 'Vernieuw externe agenda’s' });
  const openPrefs = (page: Page, app: ElectronApplication) =>
    clickMenu(app, 'Voorkeuren…').then(() => expect(page.locator('#settings-dialog')).toBeVisible());

  test('de knop bovenin haalt wijzigingen meteen op en draait zolang het duurt', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED('Oud') });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await expect(chip(mainWindow, 'Oud')).toBeVisible();

      feed.state.body = FEED('Nieuw');
      feed.state.delayMs = 400; // lang genoeg om de draaiende knop te zien
      await button(mainWindow).click();
      await expect(button(mainWindow)).toHaveAttribute('aria-busy', 'true');
      await expect(mainWindow.locator('#refresh-icon')).toHaveClass(/animate-spin/);
      await expect(mainWindow.getByText('Externe agenda’s zijn bijgewerkt.')).toBeVisible();
      await expect(chip(mainWindow, 'Nieuw')).toBeVisible();
      await expect(button(mainWindow)).toHaveAttribute('aria-busy', 'false');
      await expect(mainWindow.locator('#refresh-icon')).not.toHaveClass(/animate-spin/);
    } finally {
      await feed.close();
    }
  });

  test("zonder externe agenda's legt de knop uit dat er niets te vernieuwen is", async ({ mainWindow }) => {
    await button(mainWindow).click();
    await expect(mainWindow.getByText('Er zijn geen externe agenda’s om te vernieuwen.')).toBeVisible();
  });

  test('de knop is bereikbaar met het toetsenbord en heeft een toegankelijke naam', async ({ mainWindow }) => {
    await button(mainWindow).focus();
    await expect(button(mainWindow)).toBeFocused();
    await expect(button(mainWindow)).toHaveAttribute('title', /⌘R/);
  });

  test('automatisch vernieuwen: standaard 30 minuten, instelbaar, en bewaard', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await openPrefs(mainWindow, electronApp);
    await expect(mainWindow.locator('#s-refresh')).toHaveValue('30');
    await mainWindow.locator('#s-refresh').selectOption({ label: 'Elke 5 minuten' });
    await expect
      .poll(() => JSON.parse(readFileSync(path.join(userDataDir, 'events.json'), 'utf8')).settings.refreshMinutes)
      .toBe(5);
  });

  test('het ingestelde interval werkt echt: na 5 minuten wordt er vanzelf opgehaald, daarvoor niet', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED('Oud') });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await openPrefs(mainWindow, electronApp);
      await mainWindow.locator('#s-refresh').selectOption({ label: 'Elke 5 minuten' });
      await mainWindow.keyboard.press('Escape');
      const before = feed.requests.length;

      feed.state.body = FEED('Nieuw');
      await mainWindow.clock.runFor(4 * 60_000);
      expect(feed.requests.length).toBe(before);
      await expect(chip(mainWindow, 'Oud')).toBeVisible();

      await mainWindow.clock.runFor(70_000);
      await expect(chip(mainWindow, 'Nieuw')).toBeVisible();
      expect(feed.requests.length).toBe(before + 1);
    } finally {
      await feed.close();
    }
  });

  test('"Uit": er wordt niets vanzelf opgehaald, ook niet na langer dan de oude standaard', async ({
    mainWindow,
    electronApp,
  }) => {
    const feed = await startFeed({ body: FEED('Oud') });
    try {
      await addFeed(mainWindow, electronApp, feed.calendarUrl);
      await openPrefs(mainWindow, electronApp);
      await mainWindow.locator('#s-refresh').selectOption({ label: 'Uit (alleen met de knop)' });
      await mainWindow.keyboard.press('Escape');
      const before = feed.requests.length;
      await mainWindow.clock.runFor(45 * 60_000);
      expect(feed.requests.length).toBe(before);
      await button(mainWindow).click(); // met de hand blijft werken
      await expect.poll(() => feed.requests.length).toBe(before + 1);
    } finally {
      await feed.close();
    }
  });
});
