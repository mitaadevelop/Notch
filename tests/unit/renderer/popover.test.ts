import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventOcc, Occurrence } from '../../../src/shared/types.ts';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('#event-pop').forEach((n) => n.remove());
});

async function setup() {
  const ctx = await freshModules();
  const pop = await import('../../../src/js/popover.ts');
  const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
  ctx.store.addEvent({
    title: 'Tandarts',
    date: '2026-10-27',
    time: '10:00',
    endTime: '11:00',
    location: 'Utrecht',
    notes: 'Kaartje meenemen',
  });
  const external = ctx.store.addCalendar({
    name: 'Google',
    source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
  });
  ctx.store.applySync(external.id, [{ id: 'u', title: 'Extern', date: '2026-10-27' }]);
  const occs = occurrencesBetween(ctx.state.data, '2026-10-27', '2026-10-27').filter((o): o is EventOcc => !o.holiday);
  const find = (title: string): Occurrence => occs.find((o) => o.title === title)!;
  const node = document.createElement('button');
  node.dataset.okey = 'x';
  document.body.append(node);
  node.getBoundingClientRect = () =>
    ({ left: 100, right: 220, top: 200, bottom: 230, width: 120, height: 30 }) as DOMRect;
  const hooks = ctx.state.hooks;
  hooks.occCommand = vi.fn().mockResolvedValue(undefined);
  return { ...ctx, pop, find, node, hooks };
}

const card = () => document.getElementById('event-pop');

describe('voorbeeld bij hover', () => {
  test('verschijnt pas na een korte pauze en toont de details', async () => {
    const { pop, find, node } = await setup();
    pop.schedulePreview(node, find('Tandarts'));
    expect(card()).toBeNull();
    vi.advanceTimersByTime(499);
    expect(card()).toBeNull();
    vi.advanceTimersByTime(2);
    expect(card()).not.toBeNull();
    expect(card()).toHaveAttribute('role', 'tooltip');
    expect(card()!.className).toContain('pointer-events-none');
    expect(card()).toHaveTextContent('Tandarts');
    expect(card()).toHaveTextContent('10:00–11:00');
    expect(card()).toHaveTextContent('Utrecht');
    expect(card()).toHaveTextContent('Kaartje meenemen');
    expect(card()).toHaveTextContent('Privé');
    expect(within(card()!).queryByRole('button')).toBeNull();
    expect(node.getAttribute('aria-describedby')).toBe('event-pop');
  });

  test('de muis weghalen vóór de pauze voorkomt het kaartje, erna verbergt het', async () => {
    const { pop, find, node } = await setup();
    pop.schedulePreview(node, find('Tandarts'));
    vi.advanceTimersByTime(300);
    pop.cancelPreview();
    vi.advanceTimersByTime(1000);
    expect(card()).toBeNull();

    pop.schedulePreview(node, find('Tandarts'));
    vi.advanceTimersByTime(600);
    expect(card()).not.toBeNull();
    pop.cancelPreview();
    expect(card()).toBeNull();
    expect(node.hasAttribute('aria-describedby')).toBe(false);
  });

  test('niet tijdens slepen, typen of met een open dialoog', async () => {
    const { pop, find, node, state } = await setup();
    state.holdRender();
    pop.schedulePreview(node, find('Tandarts'));
    vi.advanceTimersByTime(1000);
    expect(card()).toBeNull();
    state.releaseRender();

    const dialog = document.getElementById('event-dialog') as HTMLDialogElement;
    dialog.showModal();
    pop.schedulePreview(node, find('Tandarts'));
    vi.advanceTimersByTime(1000);
    expect(card()).toBeNull();
    dialog.close();
  });

  test('een titelloze afspraak en lange notities blijven leesbaar', async () => {
    const { pop, find, node, store } = await setup();
    store.addEvent({ title: '', date: '2026-10-27', notes: 'x'.repeat(5000) });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const { data } = await import('../../../src/js/state.ts');
    const empty = occurrencesBetween(data, '2026-10-27', '2026-10-27').find((o) => !o.holiday && o.title === '')!;
    pop.schedulePreview(node, empty);
    vi.advanceTimersByTime(600);
    expect(card()).toHaveTextContent('(zonder titel)');
    expect(card()!.querySelector('.line-clamp-3')).not.toBeNull();
    void find;
  });
});

describe('vastgezet kaartje met acties', () => {
  test('toont de acties en stuurt ze door met de afspraak', async () => {
    const { pop, find, node, hooks } = await setup();
    const occ = find('Tandarts');
    pop.pin(node, occ);
    expect(card()).toHaveAttribute('role', 'dialog');
    expect(card()!.className).not.toContain('pointer-events-none');
    expect(pop.popoverOpen()).toBe(true);

    for (const [name, command] of [
      ['Bewerk', 'edit'],
      ['Dupliceer', 'duplicate'],
      ['Kopieer', 'copy'],
      ['Verwijder', 'delete'],
    ] as const) {
      await userEvent.click(within(card()!).getByRole('button', { name }), { advanceTimers: vi.advanceTimersByTime });
      expect(hooks.occCommand).toHaveBeenLastCalledWith(occ, command);
    }
  });

  test("de agenda kiezen stuurt de nieuwe agenda mee, alleen eigen agenda's staan in de lijst", async () => {
    const { pop, find, node, hooks } = await setup();
    const occ = find('Tandarts');
    pop.pin(node, occ);
    const select = within(card()!).getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Privé', 'Werk', 'Verjaardagen']);
    expect(select.value).toBe('home');
    await userEvent.selectOptions(select, 'work', { advanceTimers: vi.advanceTimersByTime });
    expect(hooks.occCommand).toHaveBeenLastCalledWith(occ, 'calendar', 'work');
  });

  test('een externe afspraak: bekijken, dupliceren en kopiëren, maar niet verwijderen of verplaatsen', async () => {
    const { pop, find, node } = await setup();
    pop.pin(node, find('Extern'));
    const buttons = within(card()!)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(buttons).toEqual(['Bekijk', 'Dupliceer', 'Kopieer']);
    expect(within(card()!).queryByRole('combobox')).toBeNull();
    expect(card()).toHaveTextContent('alleen-lezen');
  });

  test('Escape sluit het kaartje zonder dat de rest van de app de Escape krijgt', async () => {
    const { pop, find, node } = await setup();
    const listener = vi.fn();
    document.addEventListener('keydown', listener);
    pop.pin(node, find('Tandarts'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    // zonder kaartje gaat Escape gewoon door
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', listener);
  });

  test('buiten klikken sluit, in het kaartje klikken niet, en klikken op een afspraak laat hem zelf verversen', async () => {
    const { pop, find, node } = await setup();
    pop.pin(node, find('Tandarts'));
    card()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(card()).not.toBeNull();
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(card()).not.toBeNull(); // wireOcc vernieuwt hem bij de click
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(card()).toBeNull();
    expect(pop.popoverOpen()).toBe(false);
  });

  test('een vastgezet kaartje wordt niet door hover vervangen', async () => {
    const { pop, find, node } = await setup();
    pop.pin(node, find('Tandarts'));
    pop.schedulePreview(node, find('Extern'));
    vi.advanceTimersByTime(1000);
    expect(card()).toHaveTextContent('Tandarts');
    pop.cancelPreview(); // een vastgezet kaartje blijft bij het weggaan van de muis
    expect(card()).not.toBeNull();
  });

  test('closePopovers is veilig zonder kaartje en ruimt alles op', async () => {
    const { pop, find, node } = await setup();
    pop.closePopovers();
    pop.pin(node, find('Tandarts'));
    pop.closePopovers();
    expect(card()).toBeNull();
    expect(node.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('plaats van het kaartje', () => {
  const placeAt = async (rect: Partial<DOMRect>, size = { w: 1000, h: 800 }) => {
    const { pop, find, node } = await setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: size.w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: size.h });
    node.getBoundingClientRect = () => ({ width: 100, height: 30, ...rect }) as DOMRect;
    pop.pin(node, find('Tandarts'));
    return { left: parseFloat(card()!.style.left), top: parseFloat(card()!.style.top) };
  };

  test('rechts van de afspraak als er ruimte is', async () => {
    expect((await placeAt({ left: 100, right: 200, top: 100, bottom: 130 })).left).toBe(208);
  });

  test('links van de afspraak als rechts geen ruimte is', async () => {
    const { left } = await placeAt({ left: 800, right: 900, top: 100, bottom: 130 });
    expect(left).toBe(800 - 288 - 8);
  });

  test('blijft binnen het venster als beide kanten te smal zijn', async () => {
    const { left } = await placeAt({ left: 100, right: 300, top: 100, bottom: 130 }, { w: 320, h: 800 });
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 288).toBeLessThanOrEqual(320 - 8 + 0.01);
  });

  test('nooit boven of onder het venster uit', async () => {
    expect((await placeAt({ left: 100, right: 200, top: -50, bottom: -20 })).top).toBeGreaterThanOrEqual(8);
  });
});
