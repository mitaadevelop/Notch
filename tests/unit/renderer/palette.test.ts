import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => vi.useRealTimers());

const NOW = new Date(2026, 9, 26, 10, 0); // maandag 26 oktober 2026

async function setup() {
  const ctx = await freshModules();
  // het palet leest de dialoog-elementen bij het laden: eerst de dialogen (quickEventFromText), dan het palet
  await import('../../../src/js/dialogs.ts');
  const palette = await import('../../../src/js/palette.ts');
  const run = {
    today: vi.fn(),
    week: vi.fn(),
    settings: vi.fn(),
  };
  palette.setCommands(() => [
    { id: 'today', label: 'Ga naar vandaag', keywords: 'vandaag nu', run: run.today },
    { id: 'view-week', label: 'Weergave: week', keywords: 'toon weergave', run: run.week },
    { id: 'settings', label: 'Voorkeuren…', keywords: 'instellingen', run: run.settings },
  ]);
  ctx.store.addEvent({ title: 'Tandarts', date: '2026-11-02', time: '14:00', endTime: '15:00' });
  const selectDate = vi.fn();
  const openSearchResult = vi.fn();
  ctx.state.hooks.selectDate = selectDate;
  ctx.state.hooks.openSearchResult = openSearchResult;
  return {
    ...ctx,
    palette,
    run,
    selectDate,
    openSearchResult,
    user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
  };
}

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('resultaten', () => {
  test('zonder tekst alle opdrachten', async () => {
    const { palette } = await setup();
    expect(labels(palette.buildItems('', NOW))).toEqual(['Ga naar vandaag', 'Weergave: week', 'Voorkeuren…']);
  });

  test('filtert opdrachten op alle woorden, ook in de zoekwoorden, ongeacht hoofdletters', async () => {
    const { palette } = await setup();
    expect(labels(palette.buildItems('WEEK', NOW))).toContain('Weergave: week');
    expect(labels(palette.buildItems('instellingen', NOW))).toContain('Voorkeuren…');
    expect(labels(palette.buildItems('toon week', NOW))).toContain('Weergave: week');
    expect(labels(palette.buildItems('toon voorkeuren', NOW)).filter((l) => l === 'Voorkeuren…')).toEqual([]);
  });

  test('een datum geeft "Ga naar" bovenaan, ook met "ga naar" ervoor', async () => {
    const { palette, selectDate } = await setup();
    for (const text of ['3 november', 'ga naar 3 november', 'naar 3 november']) {
      const [first] = palette.buildItems(text, NOW);
      expect(first.group).toBe('Ga naar');
      expect(first.label).toBe('Ga naar dinsdag 3 november');
    }
    palette.buildItems('3 november', NOW)[0].run();
    expect(selectDate).toHaveBeenCalledWith('2026-11-03');
  });

  test('relatieve datums werken', async () => {
    const { palette } = await setup();
    expect(palette.buildItems('morgen', NOW)[0].label).toBe('Ga naar dinsdag 27 oktober');
    expect(palette.buildItems('vrijdag', NOW)[0].label).toBe('Ga naar vrijdag 30 oktober');
  });

  test('een zin met titel en tijd biedt het maken van een afspraak als eerste aan', async () => {
    const { palette, state, selectDate } = await setup();
    const items = palette.buildItems('Lunch met Sam morgen 12:30', NOW);
    expect(items[0]).toMatchObject({ group: 'Maken', label: 'Maak afspraak “Lunch met Sam”' });
    expect(items[0].detail).toContain('12:30');
    items[0].run();
    const created = state.data.events.find((e) => e.title === 'Lunch met Sam')!;
    expect(created).toMatchObject({ date: '2026-10-27', time: '12:30' });
    expect(selectDate).toHaveBeenCalledWith('2026-10-27');
  });

  test('een titel zonder datum of tijd staat onderaan, na de gevonden afspraken', async () => {
    const { palette } = await setup();
    const items = palette.buildItems('Tandarts', NOW);
    expect(items.map((i) => i.group)).toEqual(['Afspraak', 'Maken']);
    expect(items[0].label).toBe('Tandarts');
    expect(items[0].detail).toContain('2 nov');
  });

  test('een gevonden afspraak openen gaat via het zoekresultaat', async () => {
    const { palette, openSearchResult } = await setup();
    palette.buildItems('tandarts', NOW)[0].run();
    expect(openSearchResult).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-02' }));
  });

  test('een zoekterm van één teken zoekt niet in afspraken', async () => {
    const { palette } = await setup();
    expect(palette.buildItems('t', NOW).some((i) => i.group === 'Afspraak')).toBe(false);
  });

  test('een datum met een titel is geen "ga naar" maar een afspraak', async () => {
    const { palette } = await setup();
    const items = palette.buildItems('Tandarts 3 november', NOW);
    expect(items.some((i) => i.group === 'Ga naar')).toBe(false);
    expect(items[0].group).toBe('Maken');
  });

  test('onzin zonder treffers geeft geen opdrachten, hooguit een afspraak om te maken', async () => {
    const { palette } = await setup();
    const items = palette.buildItems('qqzzxx', NOW);
    expect(items.filter((i) => i.group === 'Opdracht')).toEqual([]);
  });
});

describe('het palet zelf', () => {
  test('opent met alle opdrachten, focus in het veld en juiste aria-attributen', async () => {
    const { palette } = await setup();
    palette.openPalette();
    expect(palette.paletteOpen()).toBe(true);
    const input = screen.getByRole('combobox', { name: /Zoek een opdracht/ });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-activedescendant', 'pal-opt-0');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('typen filtert, pijltjes bewegen de selectie rondom, Enter voert uit en sluit', async () => {
    const { palette, run, user } = await setup();
    palette.openPalette();
    await user.keyboard('e');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(2);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('combobox', { name: /Zoek een opdracht/ })).toHaveAttribute(
      'aria-activedescendant',
      'pal-opt-1',
    );
    await user.keyboard('{ArrowUp}{ArrowUp}'); // rondom naar het laatste
    expect(screen.getByRole('combobox', { name: /Zoek een opdracht/ })).toHaveAttribute(
      'aria-activedescendant',
      `pal-opt-${options.length - 1}`,
    );
    await user.keyboard('{ArrowDown}{Enter}');
    expect(palette.paletteOpen()).toBe(false);
    vi.advanceTimersByTime(5);
    expect(run.today.mock.calls.length + run.week.mock.calls.length + run.settings.mock.calls.length).toBe(1);
  });

  test('klikken op een resultaat voert het uit', async () => {
    const { palette, run, user } = await setup();
    palette.openPalette();
    await user.click(screen.getByRole('option', { name: /Voorkeuren/ }));
    vi.advanceTimersByTime(5);
    expect(run.settings).toHaveBeenCalledTimes(1);
  });

  test('tekst zonder treffer wordt een nieuwe afspraak met die titel (Enter maakt hem)', async () => {
    const { palette, state, user } = await setup();
    palette.openPalette();
    await user.keyboard('qqzzxx1{Enter}');
    vi.advanceTimersByTime(5);
    expect(state.data.events.some((e) => e.title === 'qqzzxx1')).toBe(true);
  });

  test('zonder resultaten staat er "Niets gevonden" en doet Enter niets', async () => {
    const { palette, run, user } = await setup();
    palette.openPalette();
    // alleen een agendanaam (#werk): geen opdracht, geen titel, geen datum -> niets te kiezen
    await user.keyboard('#werk{Enter}');
    expect(screen.getByText('Niets gevonden.')).toBeInTheDocument();
    expect(palette.paletteOpen()).toBe(true);
    vi.advanceTimersByTime(5);
    expect(run.today).not.toHaveBeenCalled();
  });

  test('opnieuw openen begint leeg', async () => {
    const { palette, user } = await setup();
    palette.openPalette();
    await user.keyboard('week');
    document.getElementById('palette')!.dispatchEvent(new Event('cancel'));
    (document.getElementById('palette') as HTMLDialogElement).close();
    palette.openPalette();
    expect(screen.getByRole('combobox', { name: /Zoek een opdracht/ })).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  test('de muis over een resultaat maakt het actief', async () => {
    const { palette } = await setup();
    palette.openPalette();
    const options = screen.getAllByRole('option');
    options[2].dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
  });
});
