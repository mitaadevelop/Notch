import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventOcc } from '../../../src/shared/types.ts';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
});

async function setup(extra: Record<string, unknown> = {}) {
  const ctx = await freshModules();
  const ev = ctx.store.addEvent({ title: 'Belasting', date: '2026-10-27', task: true, ...extra } as never);
  const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
  const occ = occurrencesBetween(ctx.state.data, '2026-10-27', '2026-10-27').find((o) => o.id === ev.id) as EventOcc;
  const ui = await import('../../../src/js/occ-ui.ts');
  return { ...ctx, ev, occ, ui };
}

describe('een taak in de weergave', () => {
  test('heeft een leeg rondje en een toegankelijke aanduiding', async () => {
    const { ui, occ } = await setup();
    const node = ui.barChip(occ);
    document.body.append(node);
    const box = node.querySelector<HTMLElement>('[data-task-check]')!;
    expect(box).not.toBeNull();
    expect(box.textContent).toBe('');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(node).toHaveTextContent('Taak, open:');
    expect(node.classList.contains('line-through')).toBe(false);
  });

  test('afgevinkt: vinkje, doorgestreept en voorgelezen als afgevinkt', async () => {
    const { ui, occ, store } = await setup();
    store.toggleTaskDone(occ);
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const fresh = occurrencesBetween((await import('../../../src/js/state.ts')).data, '2026-10-27', '2026-10-27')[0];
    const node = ui.dotRow(fresh);
    document.body.append(node);
    expect(node.querySelector('[data-task-check]')!.textContent).toBe('✓');
    expect(node.classList.contains('line-through')).toBe(true);
    expect(node).toHaveTextContent('Taak, afgevinkt:');
  });

  test('klikken op het rondje vinkt af zonder de afspraak te selecteren of te openen', async () => {
    const { ui, occ, state } = await setup();
    const open = vi.fn();
    state.hooks.openOcc = open;
    const node = ui.barChip(occ);
    document.body.append(node);
    fireEvent.click(node.querySelector('[data-task-check]')!);
    expect(state.data.events[0].doneOn).toEqual(['2026-10-27']);
    expect(state.ui.selectedKey).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  test('een gewone afspraak krijgt geen rondje', async () => {
    const ctx = await freshModules();
    ctx.store.addEvent({ title: 'Gewoon', date: '2026-10-27' });
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(ctx.state.data, '2026-10-27', '2026-10-27')[0];
    const node = (await import('../../../src/js/occ-ui.ts')).barChip(occ);
    expect(node.querySelector('[data-task-check]')).toBeNull();
  });
});

describe('taak in de afspraakdialoog', () => {
  test('het vinkje "Taak" wordt bewaard en bij bewerken teruggezet', async () => {
    const ctx = await freshModules();
    const dialogs = await import('../../../src/js/dialogs.ts');
    const user = userEvent.setup();
    dialogs.openEventDialog({ date: '2026-10-27', allDay: true });
    await user.type(screen.getByPlaceholderText('Nieuwe afspraak'), 'Rapport');
    await user.click(screen.getByRole('checkbox', { name: /Taak/ }));
    await user.click(screen.getByRole('button', { name: 'Voeg toe' }));
    expect(ctx.state.data.events[0]).toMatchObject({ title: 'Rapport', task: true });

    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(ctx.state.data, '2026-10-27', '2026-10-27')[0] as EventOcc;
    dialogs.openEventDialog({ occ });
    expect(screen.getByRole('checkbox', { name: /Taak/ })).toBeChecked();
  });

  test('een nieuwe taak via prefill staat al aangevinkt als "Taak"', async () => {
    await freshModules();
    const dialogs = await import('../../../src/js/dialogs.ts');
    dialogs.openEventDialog({ allDay: true, prefill: { task: true } });
    expect(screen.getByRole('checkbox', { name: /Taak/ })).toBeChecked();
    dialogs.openEventDialog({ date: '2026-10-27' });
    expect(screen.getByRole('checkbox', { name: /Taak/ })).not.toBeChecked();
  });
});
