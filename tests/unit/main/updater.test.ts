import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UpdateState } from '../../../src/shared/types.ts';
import { createUpdateManager, friendlyError } from '../../../src/updater.ts';
import type { UpdaterLike } from '../../../src/updater.ts';

// een nep-autoUpdater: de test bepaalt wat checkForUpdates/downloadUpdate doen en welke events er komen
function fakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    checkForUpdates: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
    downloadUpdate: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
  });
  return updater as typeof updater & UpdaterLike;
}

function setup(over: { supported?: boolean; timeoutMs?: number } = {}) {
  const updater = fakeUpdater();
  const sent: UpdateState[] = [];
  const manager = createUpdateManager({
    updater,
    currentVersion: '0.1.0',
    supported: over.supported ?? true,
    send: (state) => sent.push({ ...state }),
    now: () => 1_000,
    timeoutMs: over.timeoutMs,
  });
  const statuses = () => sent.map((s) => s.status);
  return { updater, manager, sent, statuses };
}

afterEach(() => vi.useRealTimers());

describe('beginstand', () => {
  test('zet het automatisch downloaden en installeren uit: de gebruiker kiest', () => {
    const { updater } = setup();
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      allowDowngrade: false,
    });
  });

  test('een ondersteunde app begint in rust met zijn huidige versie', () => {
    expect(setup().manager.state()).toEqual({ status: 'idle', currentVersion: '0.1.0' });
  });

  test('een niet-verpakte app meldt dat updaten daar niet kan en doet verder niets', async () => {
    const { manager, updater, sent } = setup({ supported: false });
    expect(manager.state()).toMatchObject({ status: 'unsupported', currentVersion: '0.1.0' });
    expect(manager.state().error).toContain('geïnstalleerde app');
    await manager.check();
    await manager.download();
    expect(manager.install()).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(manager.startAutoCheck()()).toBeUndefined(); // een lege opruimfunctie
  });
});

describe('controleren', () => {
  test('een nieuwe versie: checking → available, met versie en tijdstip', async () => {
    const { manager, updater, statuses } = setup();
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-available', { version: '0.2.0' }));
    await manager.check();
    expect(statuses()).toEqual(['checking', 'available']);
    expect(manager.state()).toEqual({
      status: 'available',
      currentVersion: '0.1.0',
      version: '0.2.0',
      checkedAt: 1000,
    });
  });

  test('geen nieuwe versie: checking → none', async () => {
    const { manager, updater, statuses } = setup();
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-not-available', {}));
    await manager.check();
    expect(statuses()).toEqual(['checking', 'none']);
    expect(manager.state().checkedAt).toBe(1000);
  });

  test('een controle die zonder uitkomst eindigt (resultaat null) telt als "geen update" in plaats van te blijven hangen', async () => {
    const { manager, statuses } = setup();
    await manager.check();
    expect(statuses()).toEqual(['checking', 'none']);
  });

  test('een mislukte handmatige controle toont een leesbare fout, een volgende poging kan weer', async () => {
    const { manager, updater } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND updates.example.nl'));
    await manager.check(true);
    expect(manager.state()).toMatchObject({ status: 'error' });
    expect(manager.state().error).toBe('Geen verbinding met de updateserver. Controleer je internetverbinding.');
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-not-available', {}));
    await manager.check(true);
    expect(manager.state().status).toBe('none');
  });

  test('een fout op de achtergrond blijft stil', async () => {
    const { manager, updater, statuses } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await manager.check(false);
    expect(manager.state()).toEqual({ status: 'idle', currentVersion: '0.1.0' });
    expect(statuses()).toEqual(['checking', 'idle']);
  });

  test('een fout die zowel als event als als afgewezen belofte binnenkomt, geeft één foutstatus', async () => {
    const { manager, updater, statuses } = setup();
    updater.checkForUpdates.mockImplementation(async () => {
      const error = new Error('Cannot find latest-mac.yml: 404');
      updater.emit('error', error);
      throw error;
    });
    await manager.check(true);
    expect(statuses()).toEqual(['checking', 'error']);
    expect(manager.state().error).toBe('Er staat (nog) geen update op de updateserver.');
  });

  test('tegelijk twee keer controleren vraagt maar één keer', async () => {
    const { manager, updater } = setup();
    let finish: () => void = () => {};
    updater.checkForUpdates.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const first = manager.check();
    await manager.check();
    finish();
    await first;
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test('tijdens het downloaden of als de update klaarstaat wordt er niet opnieuw gecontroleerd', async () => {
    const { manager, updater } = setup();
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-available', { version: '0.2.0' }));
    await manager.check();
    await manager.download();
    await manager.check();
    updater.emit('update-downloaded', { version: '0.2.0' });
    await manager.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test('bij "beschikbaar" mag je opnieuw controleren', async () => {
    const { manager, updater } = setup();
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-available', { version: '0.2.0' }));
    await manager.check();
    await manager.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  test('een server die niet reageert geeft na de wachttijd een time-out', async () => {
    vi.useFakeTimers();
    const { manager, updater } = setup({ timeoutMs: 5000 });
    updater.checkForUpdates.mockReturnValue(new Promise(() => {}));
    const pending = manager.check(true);
    await vi.advanceTimersByTimeAsync(5001);
    await pending;
    expect(manager.state()).toMatchObject({ status: 'error', error: 'De updateserver reageert niet (time-out).' });
  });
});

describe('downloaden', () => {
  async function available() {
    const ctx = setup();
    ctx.updater.checkForUpdates.mockImplementation(
      async () => void ctx.updater.emit('update-available', { version: '0.2.0' }),
    );
    await ctx.manager.check();
    ctx.sent.length = 0;
    return ctx;
  }

  test('available → downloading (met voortgang) → ready', async () => {
    const { manager, updater, sent } = await available();
    let finish: () => void = () => {};
    updater.downloadUpdate.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const download = manager.download();
    expect(manager.state()).toMatchObject({ status: 'downloading', progress: 0, version: '0.2.0' });
    updater.emit('download-progress', { percent: 33.4 });
    updater.emit('download-progress', { percent: 99.6 });
    expect(manager.state().progress).toBe(100);
    updater.emit('update-downloaded', { version: '0.2.0' });
    finish();
    await download;
    expect(manager.state()).toMatchObject({ status: 'ready', version: '0.2.0', progress: 100 });
    expect(sent.map((s) => s.progress)).toEqual([0, 33, 100, 100]);
  });

  test('voortgang buiten een download wordt genegeerd, en blijft tussen 0 en 100', async () => {
    const { manager, updater } = await available();
    updater.emit('download-progress', { percent: 50 });
    expect(manager.state().progress).toBeUndefined();
    updater.downloadUpdate.mockReturnValue(new Promise(() => {}));
    void manager.download();
    updater.emit('download-progress', { percent: -5 });
    expect(manager.state().progress).toBe(0);
    updater.emit('download-progress', { percent: 250 });
    expect(manager.state().progress).toBe(100);
  });

  test('downloaden kan alleen vanuit "beschikbaar"', async () => {
    const { manager, updater } = setup();
    await manager.download(); // idle
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '0.2.0' });
    await manager.download(); // ready
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('een mislukte download geeft een fout met de versie erbij en kan opnieuw worden gecontroleerd', async () => {
    const { manager, updater } = await available();
    updater.downloadUpdate.mockRejectedValue(new Error('sha512 checksum mismatch, expected abc'));
    await manager.download();
    expect(manager.state()).toMatchObject({ status: 'error', version: '0.2.0' });
    expect(manager.state().error).toBe('De gedownloade update is beschadigd. Probeer het opnieuw.');
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-available', { version: '0.2.0' }));
    await manager.check();
    expect(manager.state().status).toBe('available');
  });

  test('een ondertekeningsfout wordt uitgelegd', async () => {
    const { manager, updater } = await available();
    updater.downloadUpdate.mockRejectedValue(new Error('Could not get code signature for running application'));
    await manager.download();
    expect(manager.state().error).toContain('niet ondertekend');
  });
});

describe('installeren', () => {
  test('alleen als de update klaarstaat: sluit af en start opnieuw', () => {
    const { manager, updater } = setup();
    expect(manager.install()).toBe(false);
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(manager.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});

describe('automatisch controleren', () => {
  beforeEach(() => vi.useFakeTimers());

  test('stil, 10 seconden na het opstarten en daarna elke zes uur', async () => {
    const { manager, updater } = setup();
    manager.startAutoCheck();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  test("een fout bij zo'n stille controle verschijnt niet", async () => {
    const { manager, updater, statuses } = setup();
    updater.checkForUpdates.mockRejectedValue(new Error('ENOTFOUND'));
    manager.startAutoCheck();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(manager.state().status).toBe('idle');
    expect(statuses()).not.toContain('error');
  });

  test('de opruimfunctie stopt het controleren', async () => {
    const { manager, updater } = setup();
    const stop = manager.startAutoCheck();
    stop();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe('friendlyError', () => {
  test.each([
    [
      'getaddrinfo ENOTFOUND updates.example.nl',
      'Geen verbinding met de updateserver. Controleer je internetverbinding.',
    ],
    ['net::ERR_INTERNET_DISCONNECTED', 'Geen verbinding met de updateserver. Controleer je internetverbinding.'],
    ['connect ECONNREFUSED 127.0.0.1:80', 'Geen verbinding met de updateserver. Controleer je internetverbinding.'],
    [
      'Cannot find latest-mac.yml in the latest release artifacts (404)',
      'Er staat (nog) geen update op de updateserver.',
    ],
    [
      'Could not get code signature for running application',
      'De update kon niet worden geverifieerd (de app is niet ondertekend).',
    ],
    ['sha512 checksum mismatch', 'De gedownloade update is beschadigd. Probeer het opnieuw.'],
    ['Iets heel anders\nmet een lange stacktrace', 'Iets heel anders'],
    ['', 'Onbekende fout.'],
  ])('%j', (input, expected) => {
    expect(friendlyError(new Error(input))).toBe(expected);
  });

  test('tekst of een ander type fout werkt ook, en lange meldingen worden ingekort', () => {
    expect(friendlyError('ECONNRESET')).toContain('Geen verbinding');
    expect(friendlyError(42)).toBe('42');
    const long = friendlyError(new Error('x'.repeat(500)));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('…')).toBe(true);
  });
});
