import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

beforeEach(() => {
  loadPage();
  installAgenda();
});

async function setup() {
  const ctx = await freshModules();
  const dialogs = await import('../../../src/js/dialogs.ts');
  const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
  const external = ctx.store.addCalendar({
    name: 'Google privé',
    source: { kind: 'feed', url: 'https://x/a.ics', provider: 'google' },
  });
  ctx.store.applySync(external.id, [
    {
      id: 'u1',
      title: 'Tandarts',
      date: '2026-10-27',
      time: '10:00',
      endTime: '11:00',
      location: 'Utrecht',
      notes: 'Kaartje meenemen',
    },
  ]);
  ctx.store.addEvent({ title: 'Eigen afspraak', date: '2026-10-27' });
  const occs = occurrencesBetween(ctx.state.data, '2026-10-27', '2026-10-27').filter((o) => !o.holiday);
  const pick = (title: string) => {
    const occ = occs.find((o) => o.title === title)!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    return occ;
  };
  return { ...ctx, dialogs, pick, user: userEvent.setup() };
}

const el = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('afspraak uit een externe agenda', () => {
  test('wordt alleen-lezen getoond met uitleg en zonder opslaan of verwijderen', async () => {
    const { dialogs, pick } = await setup();
    dialogs.openEventDialog({ occ: pick('Tandarts') });

    expect(el('e-readonly')).toBeVisible();
    expect(el('e-readonly')).toHaveTextContent('Alleen-lezen');
    expect(el('e-readonly')).toHaveTextContent('Google privé');
    expect(el('e-save')).not.toBeVisible();
    expect(el('e-delete')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Annuleer' })).toBeEnabled();
    // tekstvelden zijn alleen-lezen (kopiëren kan), keuzevelden uitgeschakeld
    expect(el('e-title')).toHaveValue('Tandarts');
    expect(el('e-title').readOnly).toBe(true);
    expect(el('e-location')).toHaveValue('Utrecht');
    expect(el('e-notes')).toHaveValue('Kaartje meenemen');
    expect(el('e-allday')).toBeDisabled();
    expect(el('e-repeat')).toBeDisabled();
    expect(el('e-calendar')).toBeDisabled();
    expect(el('e-calendar')).toHaveDisplayValue('Google privé');
  });

  test('typen in een alleen-lezen veld verandert niets', async () => {
    const { dialogs, pick, user } = await setup();
    dialogs.openEventDialog({ occ: pick('Tandarts') });
    await user.type(el('e-title'), 'extra');
    expect(el('e-title')).toHaveValue('Tandarts');
  });

  test('daarna is een gewone afspraak weer volledig bewerkbaar', async () => {
    const { dialogs, pick } = await setup();
    dialogs.openEventDialog({ occ: pick('Tandarts') });
    dialogs.openEventDialog({ occ: pick('Eigen afspraak') });
    expect(el('e-readonly')).not.toBeVisible();
    expect(el('e-save')).toBeVisible();
    expect(el('e-delete')).toBeVisible();
    expect(el('e-title').readOnly).toBe(false);
    expect(el('e-allday')).toBeEnabled();
    expect(el('e-repeat')).toBeEnabled();
    expect(el('e-calendar')).toBeEnabled();
    expect(el('e-calendar')).toHaveDisplayValue('Privé');
  });

  test('een nieuwe afspraak na een alleen-lezen weergave is ook weer bewerkbaar en kiest geen externe agenda', async () => {
    const { dialogs, pick } = await setup();
    dialogs.openEventDialog({ occ: pick('Tandarts') });
    dialogs.openEventDialog({ date: '2026-10-28' });
    expect(el('e-title')).toBeEnabled();
    expect(el('e-title').readOnly).toBe(false);
    expect(el('e-save')).toBeVisible();
    const options = [...(el('e-calendar') as unknown as HTMLSelectElement).options].map((o) => o.text);
    expect(options).not.toContain('Google privé');
  });

  test('een alleen-lezen afspraak met "hele dag" laat de tijdvelden uitgeschakeld en weer bruikbaar na sluiten', async () => {
    const { dialogs, state, store } = await setup();
    const ext = state.data.calendars.find((c) => c.source)!;
    store.applySync(ext.id, [{ id: 'dag', title: 'Vrij', date: '2026-10-29' }]);
    const { occurrencesBetween } = await import('../../../src/js/occurrences.ts');
    const occ = occurrencesBetween(state.data, '2026-10-29', '2026-10-29').find((o) => o.title === 'Vrij')!;
    if (occ.holiday) throw new Error('verwacht afspraak');
    dialogs.openEventDialog({ occ });
    expect(el('e-start-time')).toBeDisabled();
    dialogs.openEventDialog({ date: '2026-10-30', time: '09:00' });
    expect(el('e-start-time')).toBeEnabled();
  });
});
