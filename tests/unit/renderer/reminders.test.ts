import { fireEvent, screen } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadPage } from './dom.ts';

const reminder = { id: 'e1', date: '2026-10-26', title: 'Tandarts', body: '14:00 · Utrecht' };

async function load() {
  vi.resetModules();
  return import('../../../src/js/reminders.ts');
}

beforeEach(() => {
  loadPage();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('uitstellen en opnieuw afgaan', () => {
  test('een uitgestelde melding gaat pas af als de tijd om is, en maar één keer', async () => {
    const r = await load();
    r.snooze(reminder, 5, 1_000_000);
    expect(r.takeDueSnoozes(1_000_000 + 299_000)).toEqual([]);
    expect(r.takeDueSnoozes(1_000_000 + 300_000)).toEqual([reminder]);
    expect(r.takeDueSnoozes(1_000_000 + 400_000)).toEqual([]);
    expect(r.pendingSnoozes()).toBe(0);
  });

  test('opnieuw uitstellen van dezelfde afspraak vervangt de vorige, andere blijven', async () => {
    const r = await load();
    r.snooze(reminder, 5, 0);
    r.snooze({ ...reminder, id: 'e2', title: 'Lunch' }, 5, 0);
    r.snooze(reminder, 60, 0);
    expect(r.pendingSnoozes()).toBe(2);
    expect(r.takeDueSnoozes(5 * 60_000).map((s) => s.title)).toEqual(['Lunch']);
    expect(r.takeDueSnoozes(60 * 60_000).map((s) => s.title)).toEqual(['Tandarts']);
  });

  test('blijft bewaard na een herstart van de pagina', async () => {
    const first = await load();
    first.snooze(reminder, 5, 0);
    const second = await load(); // nieuwe module = nieuwe start
    expect(second.pendingSnoozes()).toBe(1);
    expect(second.takeDueSnoozes(5 * 60_000)).toEqual([reminder]);
  });

  test('een melding van meer dan een dag geleden wordt niet meer getoond', async () => {
    const r = await load();
    r.snooze(reminder, 5, 0);
    expect(r.takeDueSnoozes(25 * 3600_000)).toEqual([]);
  });

  test('kapotte opslag of onzin wordt genegeerd', async () => {
    localStorage.setItem('agenda.snoozes', '{kapot');
    expect((await load()).pendingSnoozes()).toBe(0);
    localStorage.setItem(
      'agenda.snoozes',
      JSON.stringify([1, null, { at: 'x' }, { at: 5, title: 'ok', date: 'd', id: null, body: '' }]),
    );
    expect((await load()).pendingSnoozes()).toBe(1);
  });

  test('uitstellen werkt ook zonder localStorage', async () => {
    const r = await load();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('vol');
    });
    r.snooze(reminder, 5, 0);
    expect(r.takeDueSnoozes(5 * 60_000)).toEqual([reminder]);
    spy.mockRestore();
  });
});

describe('de kaart in de app', () => {
  test('toont titel en details, en uitstellen sluit de kaart en bewaart hem', async () => {
    const r = await load();
    r.showReminderCard(reminder, vi.fn(), () => 0);
    expect(screen.getByRole('group', { name: 'Herinnering: Tandarts' })).toBeInTheDocument();
    expect(screen.getByText('14:00 · Utrecht')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Over 5 min' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(r.takeDueSnoozes(5 * 60_000)).toEqual([reminder]);
  });

  test('"Over 1 uur" en "Sluiten" (die niets bewaart)', async () => {
    const r = await load();
    r.showReminderCard(reminder, vi.fn(), () => 0);
    fireEvent.click(screen.getByRole('button', { name: 'Over 1 uur' }));
    expect(r.takeDueSnoozes(59 * 60_000)).toEqual([]);
    expect(r.takeDueSnoozes(60 * 60_000)).toHaveLength(1);

    r.showReminderCard({ ...reminder, id: 'x' }, vi.fn(), () => 0);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(r.pendingSnoozes()).toBe(0);
  });

  test('klikken op de titel opent de afspraak', async () => {
    const r = await load();
    const open = vi.fn();
    r.showReminderCard(reminder, open);
    fireEvent.click(screen.getByRole('button', { name: 'Tandarts' }));
    expect(open).toHaveBeenCalledWith(reminder);
    expect(screen.queryByRole('group')).toBeNull();
  });

  test('meerdere kaarten staan onder elkaar in één live-gebied', async () => {
    const r = await load();
    r.showReminderCard(reminder, vi.fn());
    r.showReminderCard({ ...reminder, id: 'b', title: 'Lunch' }, vi.fn());
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(document.querySelectorAll('#reminders')).toHaveLength(1);
    expect(document.getElementById('reminders')).toHaveAttribute('aria-live', 'polite');
  });
});
