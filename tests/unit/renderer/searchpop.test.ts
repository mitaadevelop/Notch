import { screen } from '@testing-library/dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
});

async function setup() {
  const ctx = await freshModules();
  const pop = await import('../../../src/js/searchpop.ts');
  for (const [i, title] of ['Tandarts Utrecht', 'Overleg tandarts', 'Lunch'].entries()) {
    ctx.store.addEvent({ title, date: `2026-11-0${i + 2}`, time: '10:00', endTime: '11:00' });
  }
  const input = document.getElementById('search') as HTMLInputElement;
  const showAll = vi.fn();
  const open = vi.fn();
  ctx.state.hooks.openSearchResult = open;
  const key = (name: string) => {
    const e = new KeyboardEvent('keydown', { key: name, cancelable: true });
    return { handled: pop.searchPopKey(e, input.value), prevented: e.defaultPrevented };
  };
  return { ...ctx, pop, input, showAll, open, key };
}

describe('highlightParts', () => {
  test.each([
    [
      'Tandarts Utrecht',
      'tand',
      [
        ['Tand', true],
        ['arts Utrecht', false],
      ],
    ],
    [
      'Overleg tandarts',
      'TAND',
      [
        ['Overleg ', false],
        ['tand', true],
        ['arts', false],
      ],
    ],
    [
      'aaa',
      'a',
      [
        ['a', true],
        ['a', true],
        ['a', true],
      ],
    ],
    ['Lunch', 'x', [['Lunch', false]]],
    ['Lunch', '', [['Lunch', false]]],
    ['Lunch', '   ', [['Lunch', false]]],
    ['', 'a', [['', false]]],
  ])('%j met %j', async (text, query, expected) => {
    const { highlightParts } = await import('../../../src/js/searchpop.ts');
    expect(highlightParts(text, query).map((p) => [p.text, p.match])).toEqual(expected);
  });
});

describe('uitklaplijst', () => {
  test('toont de treffers met de zoekterm gemarkeerd en de juiste aria-attributen', async () => {
    const { pop, input, showAll } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    expect(pop.searchPopOpen()).toBe(true);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].querySelector('mark')).toHaveTextContent('Tand');
    expect(options[0]).toHaveTextContent('2 nov');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'search-pop');
    expect(screen.getByRole('listbox')).toHaveAttribute('id', 'search-pop');
  });

  test('geen treffers: "Niets gevonden" en nog steeds de optie om alles te tonen', async () => {
    const { pop, input, showAll } = await setup();
    pop.updateSearchPop(input, 'bestaatniet', showAll);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Niets gevonden.')).toBeInTheDocument();
    expect(screen.getByText(/Resultaten als lijst tonen/)).toBeInTheDocument();
  });

  test('toont hooguit zes treffers en noemt het totaal', async () => {
    const { pop, input, showAll, store } = await setup();
    for (let i = 0; i < 10; i++) store.addEvent({ title: `Vergadering ${i}`, date: '2026-12-01' });
    pop.updateSearchPop(input, 'vergadering', showAll);
    expect(screen.getAllByRole('option')).toHaveLength(6);
    expect(screen.getByText(/Alle 10 resultaten tonen/)).toBeInTheDocument();
  });

  test('pijltjes lopen door de treffers en terug naar "niets gekozen"', async () => {
    const { pop, input, showAll, key } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(key('ArrowDown')).toEqual({ handled: true, prevented: true });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-opt-0');
    key('ArrowDown');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-opt-1');
    key('ArrowDown'); // voorbij het laatste: weer niets gekozen
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    key('ArrowUp'); // omhoog vanaf niets: het laatste
    expect(input).toHaveAttribute('aria-activedescendant', 'search-opt-1');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter zonder keuze toont alle resultaten, met een keuze opent het die afspraak', async () => {
    const { pop, input, showAll, open, key } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    key('Enter');
    expect(showAll).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();

    pop.updateSearchPop(input, 'tand', showAll);
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-03' }));
    expect(pop.searchPopOpen()).toBe(false);
  });

  test('klikken op een treffer opent hem; klikken op "alle resultaten" toont de lijst', async () => {
    const { pop, input, showAll, open } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    screen.getAllByRole('option')[0].click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-02' }));
    pop.updateSearchPop(input, 'tand', showAll);
    screen.getByText(/Alle 2 resultaten|Resultaten als lijst/).click();
    expect(showAll).toHaveBeenCalledTimes(1);
  });

  test('een treffer krijgt de focus niet weg bij indrukken (anders sluit de blur de lijst eerder dan de klik)', async () => {
    const { pop, input, showAll } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    screen.getAllByRole('option')[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('de lijst bijwerken tijdens het typen houdt één lijst en zet de keuze terug', async () => {
    const { pop, input, showAll, key } = await setup();
    pop.updateSearchPop(input, 't', showAll);
    key('ArrowDown');
    pop.updateSearchPop(input, 'ta', showAll);
    expect(document.querySelectorAll('#search-pop')).toHaveLength(1);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  test('sluiten haalt de lijst weg en zet aria-expanded terug; toetsen doen dan niets', async () => {
    const { pop, input, showAll, key } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    pop.closeSearchPop();
    pop.closeSearchPop();
    expect(document.getElementById('search-pop')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(key('ArrowDown')).toEqual({ handled: false, prevented: false });
    expect(key('Enter')).toEqual({ handled: false, prevented: false });
  });

  test('andere toetsen worden niet verwerkt', async () => {
    const { pop, input, showAll, key } = await setup();
    pop.updateSearchPop(input, 'tand', showAll);
    expect(key('a')).toEqual({ handled: false, prevented: false });
  });
});
