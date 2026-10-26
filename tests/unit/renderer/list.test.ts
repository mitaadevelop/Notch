import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
});

async function setup() {
  const modules = await freshModules();
  const list = await import('../../../src/js/list.ts');
  modules.state.ui.selectedDate = '2026-10-26';
  const root = document.getElementById('view')!;
  return { ...modules, list, root };
}

describe('lijstweergave', () => {
  test('groepeert afspraken onder een kop per dag', async () => {
    const { store, list, root } = await setup();
    store.setCalendarVisible('holidays', false); // feestdagen zouden de kopjes en 'hele dag' vervuilen
    store.addEvent({ title: 'Tandarts', date: '2026-10-27', time: '14:00', endTime: '15:00', location: 'Utrecht' });
    store.addEvent({ title: 'Verjaardag oma', date: '2026-10-29' });
    list.renderListView(root);

    const headings = within(root).getAllByRole('button', { name: /^\w+dag \d+ oktober/ });
    expect(headings.map((h) => h.textContent)).toEqual(['dinsdag 27 oktober', 'donderdag 29 oktober']);
    expect(within(root).getByText('Tandarts')).toBeInTheDocument();
    expect(within(root).getByText('Utrecht')).toBeInTheDocument();
    expect(within(root).getByText('14:00–15:00')).toBeInTheDocument();
    expect(within(root).getByText('hele dag')).toBeInTheDocument();
  });

  test('een klik op een dagkop opent de dagweergave', async () => {
    const { state, store, list, root } = await setup();
    const setView = vi.fn();
    state.hooks.setView = setView;
    store.addEvent({ title: 'Tandarts', date: '2026-10-27' });
    list.renderListView(root);
    await userEvent.click(within(root).getByRole('button', { name: 'dinsdag 27 oktober' }));
    expect(setView).toHaveBeenCalledWith('day', '2026-10-27');
  });

  test('geen afspraken: toont een melding (maar wel de feestdagen)', async () => {
    const { store, list, root, state } = await setup();
    // alle agenda's verbergen, zodat er echt niets overblijft
    for (const calendar of state.data.calendars) store.setCalendarVisible(calendar.id, false);
    list.renderListView(root);
    expect(within(root).getByText('Geen afspraken in de komende 60 dagen.')).toBeInTheDocument();
  });

  test('een verborgen agenda laat zijn afspraken niet zien', async () => {
    const { store, list, root } = await setup();
    store.addEvent({ title: 'Geheim', date: '2026-10-27' });
    store.setCalendarVisible('home', false);
    list.renderListView(root);
    expect(within(root).queryByText('Geheim')).not.toBeInTheDocument();
  });
});

describe('zoeken', () => {
  test('toont het aantal resultaten en opent een resultaat', async () => {
    const { state, store, list, root } = await setup();
    const open = vi.fn();
    state.hooks.openSearchResult = open;
    store.addEvent({ title: 'Tandarts', date: '2026-11-02' });
    state.ui.query = 'tandarts';
    list.renderSearch(root);
    expect(within(root).getByRole('heading', { level: 2 })).toHaveTextContent('1 resultaat voor “tandarts”');
    await userEvent.click(screen.getByRole('button', { name: /Tandarts/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-02' }));
  });

  test('niets gevonden', async () => {
    const { state, list, root } = await setup();
    state.ui.query = 'bestaatniet';
    list.renderSearch(root);
    expect(within(root).getByRole('heading', { level: 2 })).toHaveTextContent('0 resultaten voor “bestaatniet”');
    expect(within(root).getByText('Niets gevonden.')).toBeInTheDocument();
  });
});
