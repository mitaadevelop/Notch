import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UpdateState } from '../../../src/shared/types.ts';
import { installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;

beforeEach(() => {
  loadPage();
  agenda = installAgenda();
  vi.resetModules();
});

const state = (patch: Partial<UpdateState>): UpdateState => ({ status: 'idle', currentVersion: '0.1.0', ...patch });

async function setup(initial: UpdateState = state({})) {
  agenda.getUpdateState.mockResolvedValue(initial);
  const updates = await import('../../../src/js/updates.ts');
  const toast = vi.fn();
  await updates.initUpdates(toast);
  const push = agenda.onUpdateState.mock.calls[0][0] as (s: UpdateState) => void;
  return { updates, toast, push, user: userEvent.setup() };
}

const status = () => document.getElementById('upd-status')!;
const action = () => document.getElementById('upd-action') as HTMLButtonElement;
const pill = () => document.getElementById('update-pill') as HTMLButtonElement;
const progress = () => document.getElementById('upd-progress') as HTMLProgressElement;

describe('tekst per status', () => {
  test.each([
    [state({ status: 'idle' }), 'Je hebt versie 0.1.0.'],
    [state({ status: 'checking' }), 'Zoeken naar updates…'],
    [state({ status: 'none' }), 'Je hebt de nieuwste versie (0.1.0).'],
    [state({ status: 'available', version: '0.2.0' }), 'Versie 0.2.0 is beschikbaar (je hebt 0.1.0).'],
    [state({ status: 'downloading', version: '0.2.0', progress: 42 }), 'Versie 0.2.0 wordt gedownload… 42%'],
    [state({ status: 'error', error: 'Geen verbinding.' }), 'Updaten is mislukt: Geen verbinding.'],
    [
      state({ status: 'unsupported', error: 'Updaten kan alleen in de geïnstalleerde app.' }),
      'Updaten kan alleen in de geïnstalleerde app.',
    ],
  ])('%j', async (input, text) => {
    const { updates } = await setup();
    expect(updates.describe(input)).toBe(text);
  });

  test('"geen update" noemt het tijdstip van controleren, en "klaar" legt de herstart uit', async () => {
    const { updates } = await setup();
    expect(updates.describe(state({ status: 'none', checkedAt: new Date(2026, 9, 26, 14, 5).getTime() }))).toContain(
      'gecontroleerd om 14:05',
    );
    expect(updates.describe(state({ status: 'ready', version: '0.2.0' }))).toContain('agenda blijft behouden');
  });
});

describe('de knop in de voorkeuren', () => {
  test('begint met de huidige versie en "Zoek naar updates"', async () => {
    await setup();
    expect(status()).toHaveTextContent('Je hebt versie 0.1.0.');
    expect(action()).toHaveTextContent('Zoek naar updates');
    expect(action()).toBeEnabled();
    expect(progress().hidden).toBe(true);
    expect(pill().hidden).toBe(true);
  });

  test('klikken zoekt naar updates', async () => {
    const { user } = await setup();
    await user.click(action());
    expect(agenda.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test('bij een beschikbare update downloadt de knop die versie', async () => {
    const { user } = await setup(state({ status: 'available', version: '0.2.0' }));
    expect(action()).toHaveTextContent('Download versie 0.2.0');
    await user.click(action());
    expect(agenda.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  test('tijdens het downloaden: uitgeschakeld, met een voortgangsbalk', async () => {
    const { push } = await setup();
    push(state({ status: 'downloading', version: '0.2.0', progress: 64 }));
    expect(action()).toBeDisabled();
    expect(action()).toHaveTextContent('Downloaden…');
    expect(progress().hidden).toBe(false);
    expect(progress().value).toBe(64);
    push(state({ status: 'downloading', version: '0.2.0', progress: 80 }));
    expect(progress().value).toBe(80);
  });

  test('als de update klaarstaat installeert de knop (herstart)', async () => {
    const { user } = await setup(state({ status: 'ready', version: '0.2.0' }));
    expect(action()).toHaveTextContent('Herstart en installeer');
    await user.click(action());
    expect(agenda.installUpdate).toHaveBeenCalledTimes(1);
  });

  test('bezig met zoeken en in een niet-verpakte app is de knop uitgeschakeld', async () => {
    const { push } = await setup();
    push(state({ status: 'checking' }));
    expect(action()).toBeDisabled();
    push(state({ status: 'unsupported', error: 'Updaten kan alleen in de geïnstalleerde app.' }));
    expect(action()).toBeDisabled();
    expect(action()).toHaveTextContent('Zoek naar updates');
  });

  test('na een fout kun je het opnieuw proberen', async () => {
    const { user } = await setup(state({ status: 'error', error: 'Geen verbinding.' }));
    expect(action()).toBeEnabled();
    await user.click(action());
    expect(agenda.checkForUpdates).toHaveBeenCalled();
  });
});

describe('de knop bovenin', () => {
  test('verschijnt alleen als er iets te doen is', async () => {
    const { push } = await setup();
    for (const s of ['idle', 'checking', 'none', 'error', 'unsupported'] as const) {
      push(state({ status: s }));
      expect(pill().hidden).toBe(true);
    }
    push(state({ status: 'available', version: '0.2.0' }));
    expect(pill().hidden).toBe(false);
    expect(pill()).toHaveTextContent('Update 0.2.0');
    expect(pill()).toBeEnabled();
    push(state({ status: 'downloading', version: '0.2.0', progress: 10 }));
    expect(pill()).toHaveTextContent('Downloaden… 10%');
    expect(pill()).toBeDisabled();
    push(state({ status: 'ready', version: '0.2.0' }));
    expect(pill()).toHaveTextContent('Herstart om te updaten');
  });

  test('klikken start de download, later de installatie', async () => {
    const { push, user } = await setup();
    push(state({ status: 'available', version: '0.2.0' }));
    await user.click(pill());
    expect(agenda.downloadUpdate).toHaveBeenCalledTimes(1);
    push(state({ status: 'ready', version: '0.2.0' }));
    await user.click(pill());
    expect(agenda.installUpdate).toHaveBeenCalledTimes(1);
  });

  test('is bereikbaar met een toegankelijke naam', async () => {
    const { push } = await setup();
    push(state({ status: 'available', version: '0.2.0' }));
    expect(screen.getByRole('button', { name: 'Update 0.2.0' })).toBeInTheDocument();
  });
});

describe('volgorde bij het opstarten', () => {
  test('een melding die binnenkomt terwijl de beginstand nog wordt opgehaald, wint van die beginstand', async () => {
    let resolveInitial: (s: UpdateState) => void = () => {};
    agenda.getUpdateState.mockReturnValue(new Promise<UpdateState>((resolve) => (resolveInitial = resolve)));
    const updates = await import('../../../src/js/updates.ts');
    const started = updates.initUpdates(vi.fn());
    const push = agenda.onUpdateState.mock.calls[0][0] as (s: UpdateState) => void;
    push(state({ status: 'ready', version: '0.2.0' }));
    resolveInitial(state({ status: 'unsupported', error: 'Updaten kan alleen in de geïnstalleerde app.' }));
    await started;
    expect(status()).toHaveTextContent('Versie 0.2.0 staat klaar');
    expect(pill()).toHaveTextContent('Herstart om te updaten');
  });
});

describe('meldingen', () => {
  test('een nieuwe versie wordt één keer gemeld, ook als dezelfde status nog eens binnenkomt', async () => {
    const { push, toast } = await setup();
    push(state({ status: 'available', version: '0.2.0' }));
    push(state({ status: 'available', version: '0.2.0' }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Versie 0.2.0 is beschikbaar.');
  });

  test('"klaar om te installeren" wordt gemeld, voortgang niet', async () => {
    const { push, toast } = await setup();
    push(state({ status: 'downloading', version: '0.2.0', progress: 50 }));
    expect(toast).not.toHaveBeenCalled();
    push(state({ status: 'ready', version: '0.2.0' }));
    expect(toast).toHaveBeenCalledWith('Versie 0.2.0 staat klaar om te installeren.');
  });

  test('een fout of "geen update" geeft geen melding (dat staat in de voorkeuren)', async () => {
    const { push, toast } = await setup();
    push(state({ status: 'none' }));
    push(state({ status: 'error', error: 'x' }));
    expect(toast).not.toHaveBeenCalled();
  });
});
