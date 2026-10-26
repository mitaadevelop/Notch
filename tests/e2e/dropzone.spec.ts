import type { Page } from '@playwright/test';
import { expect, freezeTime, settled, test } from './fixtures.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Sportclub',
  'BEGIN:VEVENT',
  'UID:a',
  'SUMMARY:Training',
  'DTSTART:20261028T190000',
  'DTEND:20261028T200000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// Laat een bestand of tekst op het venster vallen, zoals de Finder of een browser dat doet.
async function dropOnWindow(
  page: Page,
  payload: { files?: { name: string; text: string; type?: string }[]; text?: Record<string, string> },
) {
  await page.evaluate((p) => {
    const dt = new DataTransfer();
    for (const f of p.files ?? []) dt.items.add(new File([f.text], f.name, { type: f.type ?? '' }));
    for (const [type, value] of Object.entries(p.text ?? {})) dt.setData(type, value);
    const target = document.getElementById('view')!;
    for (const type of ['dragenter', 'dragover'])
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, payload);
}

const hover = (page: Page, text: Record<string, string> | undefined, files = false) =>
  page.evaluate(
    ([t, withFile]) => {
      const dt = new DataTransfer();
      if (withFile) dt.items.add(new File(['x'], 'x.ics'));
      for (const [type, value] of Object.entries((t as Record<string, string>) ?? {})) dt.setData(type, value);
      document
        .getElementById('view')!
        .dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      document
        .getElementById('view')!
        .dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [text, files] as const,
  );

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
  await settled(mainWindow);
});

test.describe('bestanden en links op het venster laten vallen', () => {
  test('een .ics-bestand wordt geïmporteerd als nieuwe agenda', async ({ mainWindow }) => {
    await dropOnWindow(mainWindow, { files: [{ name: 'rooster.ics', text: ICS, type: 'text/calendar' }] });
    await expect(mainWindow.locator('#cal-list')).toContainText('Sportclub');
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Training' })).toBeVisible();
    await expect(mainWindow.getByRole('status')).toContainText('1 afspraken geïmporteerd.');
  });

  test('tijdens het slepen boven het venster verschijnt een hint, die na het loslaten weg is', async ({
    mainWindow,
  }) => {
    await hover(mainWindow, undefined, true);
    const overlay = mainWindow.locator('#drop-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Laat los');
    expect(await overlay.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    await dropOnWindow(mainWindow, { files: [{ name: 'a.ics', text: ICS }] });
    await expect(overlay).toHaveCount(0);
  });

  test('het venster navigeert niet weg naar het losgelaten bestand', async ({ mainWindow }) => {
    const before = mainWindow.url();
    await dropOnWindow(mainWindow, { files: [{ name: 'foto.png', text: 'x', type: 'image/png' }] });
    await expect(mainWindow.getByRole('status')).toContainText('Alleen .ics-bestanden');
    expect(mainWindow.url()).toBe(before);
    await expect(mainWindow.locator('#view')).toBeVisible();
  });

  test('een webcal-link opent "Agenda toevoegen" met het adres ingevuld', async ({ mainWindow }) => {
    await dropOnWindow(mainWindow, {
      text: { 'text/uri-list': 'webcal://calendar.google.com/calendar/ical/abc/private-x/basic.ics' },
    });
    await expect(mainWindow.locator('#source-dialog')).toBeVisible();
    await expect(mainWindow.locator('#src-kind')).toHaveValue('google');
    await expect(mainWindow.locator('#src-url')).toHaveValue(
      'webcal://calendar.google.com/calendar/ical/abc/private-x/basic.ics',
    );
  });

  test('een gewone weblink geeft een melding en opent niets', async ({ mainWindow }) => {
    await dropOnWindow(mainWindow, { text: { 'text/plain': 'https://voorbeeld.nl/nieuws' } });
    await expect(mainWindow.getByRole('status')).toContainText('Dit is geen agenda-link');
    await expect(mainWindow.locator('#source-dialog')).toBeHidden();
  });

  test('slepen van een eigen afspraak toont de hint niet en werkt zoals voorheen', async ({ mainWindow }) => {
    await mainWindow.evaluate(async () => {
      const path = './js/store.js';
      const store = await import(path);
      store.addEvent({ title: 'Eigen', date: '2026-10-14' });
    });
    const chip = mainWindow.locator('#view [data-okey]', { hasText: 'Eigen' });
    await chip.dragTo(mainWindow.locator('#view [data-key="2026-10-16"]'));
    await expect(mainWindow.locator('#drop-overlay')).toHaveCount(0);
    // de dropzone mag een eigen sleepactie niet voor een bestand of link aanzien
    await expect(mainWindow.getByRole('status')).toContainText('Afspraak verplaatst');
    await expect(mainWindow.getByText('geen agenda-link')).toHaveCount(0);
    await expect(mainWindow.locator('#view [data-okey]', { hasText: 'Eigen' })).toBeVisible();
    const date = await mainWindow.evaluate(
      async () =>
        ((await window.agenda.load()) as { events: { title: string; date: string }[] }).events.find(
          (e) => e.title === 'Eigen',
        )?.date,
    );
    expect(date).toBe('2026-10-16');
  });
});
