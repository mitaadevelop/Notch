import { fireEvent } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 28, 10, 0)); // woensdag
});
afterEach(() => vi.useRealTimers());

const body = () => document.getElementById('st-body')!;

async function setup() {
  const ctx = await freshModules();
  const view = await import('../../../src/js/statsview.ts');
  return { ...ctx, view };
}

describe('het scherm Statistieken', () => {
  test('toont uren, aantallen, drukste dag en een balk per agenda', async () => {
    const { store, view } = await setup();
    store.addEvent({ title: 'A', date: '2026-10-26', time: '09:00', endTime: '11:00' });
    store.addEvent({ title: 'B', date: '2026-10-27', time: '09:00', endTime: '10:00', calendarId: 'work' });
    store.addEvent({ title: 'Vrij', date: '2026-10-27' });
    view.openStats();
    expect(document.getElementById('stats-dialog')).toHaveAttribute('open');
    expect(body()).toHaveTextContent('3u');
    expect(body()).toHaveTextContent('Drukste dag: maandag 26 oktober');
    expect(body()).toHaveTextContent('Privé');
    expect(body()).toHaveTextContent('2u · 2×'); // de hele-dag-afspraak telt mee in het aantal
    expect(body()).toHaveTextContent('Werk');
    expect(body()).toHaveTextContent('Per weekdag');
  });

  test('de periode wisselen herberekent', async () => {
    const { store, view } = await setup();
    store.addEvent({ title: 'Vorige week', date: '2026-10-20', time: '09:00', endTime: '12:00' });
    view.openStats();
    expect(body()).toHaveTextContent('Geen afspraken in deze periode.');
    const select = document.getElementById('st-period') as HTMLSelectElement;
    select.value = 'last-week';
    fireEvent.change(select);
    expect(body()).toHaveTextContent('3u');
    expect(body()).not.toHaveTextContent('Geen afspraken');
  });

  test('taken staan er apart bij', async () => {
    const { store, view } = await setup();
    store.addEvent({ title: 'T1', date: '2026-10-27', task: true } as never);
    store.addEvent({ title: 'T2', date: '2026-10-27', task: true } as never);
    view.openStats();
    expect(body()).toHaveTextContent('Taken: 0 afgevinkt, 2 open.');
    expect(body()).not.toHaveTextContent('Geen afspraken');
  });

  test('sluiten met de knop en met een klik naast het venster', async () => {
    const { view } = await setup();
    const dialog = document.getElementById('stats-dialog') as HTMLDialogElement;
    view.openStats();
    fireEvent.click(document.getElementById('st-close')!);
    expect(dialog).not.toHaveAttribute('open');
    view.openStats();
    fireEvent.click(dialog);
    expect(dialog).not.toHaveAttribute('open');
  });
});
