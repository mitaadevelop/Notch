// Updates in de app zelf: controleren, downloaden en installeren. De logica staat los van electron-updater
// (die wordt meegegeven), zodat ze zonder echte server of verpakte app te testen is.
import type { EventEmitter } from 'node:events';
import type { UpdateState } from './shared/types.ts';

// het deel van electron-updater's autoUpdater dat we gebruiken
export interface UpdaterLike extends EventEmitter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateOptions {
  updater: UpdaterLike;
  currentVersion: string;
  /** alleen een verpakte app kan zichzelf bijwerken (een ontwikkelversie niet) */
  supported: boolean;
  send: (state: UpdateState) => void;
  now?: () => number;
  /** wachttijd voor een controle of download die niets laat horen */
  timeoutMs?: number;
}

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

// foutmeldingen van electron-updater zijn technisch en Engels: houd ze kort en leesbaar
export function friendlyError(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).split('\n')[0].trim();
  if (/ENOTFOUND|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ECONNRESET|net::ERR_|getaddrinfo/i.test(text)) {
    return 'Geen verbinding met de updateserver. Controleer je internetverbinding.';
  }
  if (/404|Cannot find latest|not found/i.test(text)) return 'Er staat (nog) geen update op de updateserver.';
  if (/code signature|signed|signature/i.test(text)) {
    return 'De update kon niet worden geverifieerd (de app is niet ondertekend).';
  }
  if (/sha512|checksum/i.test(text)) return 'De gedownloade update is beschadigd. Probeer het opnieuw.';
  return text.length > 160 ? `${text.slice(0, 157)}…` : text || 'Onbekende fout.';
}

export function createUpdateManager(options: UpdateOptions) {
  const { updater, currentVersion, supported, send } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let state: UpdateState = supported
    ? { status: 'idle', currentVersion }
    : { status: 'unsupported', currentVersion, error: 'Updaten kan alleen in de geïnstalleerde app.' };
  // een controle op de achtergrond meldt een fout niet; een handmatige wel
  let manual = false;

  const set = (patch: Partial<UpdateState>, replace = false) => {
    state = replace ? ({ currentVersion, ...patch } as UpdateState) : { ...state, ...patch };
    send(state);
  };

  // nooit zelf downloaden of installeren: de gebruiker kiest (ook niet bij het afsluiten van de app)
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  updater.on('update-available', (info: { version: string }) => {
    set({ status: 'available', version: info.version, progress: undefined, error: undefined, checkedAt: now() }, true);
  });
  updater.on('update-not-available', () => {
    set({ status: 'none', checkedAt: now() }, true);
  });
  updater.on('download-progress', (progress: { percent: number }) => {
    if (state.status !== 'downloading') return;
    set({ progress: Math.max(0, Math.min(100, Math.round(progress.percent))) });
  });
  updater.on('update-downloaded', (info: { version: string }) => {
    set({ status: 'ready', version: info.version, progress: 100, error: undefined });
  });
  updater.on('error', (error: unknown) => fail(error));

  function fail(error: unknown) {
    const message = friendlyError(error);
    // op de achtergrond mislukken is geen nieuws: pas melden als de gebruiker erom vroeg of er al een download liep
    if (!manual && state.status === 'checking') {
      set({ status: 'idle', error: undefined }, true);
      return;
    }
    const keep = state.status === 'downloading' ? { version: state.version } : {};
    set({ status: 'error', error: message, ...keep }, true);
  }

  // TypeScript weet niet dat events de status tussendoor veranderen; via een functie lezen we de actuele
  const status = (): UpdateState['status'] => state.status;

  const withTimeout = <T>(work: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('De updateserver reageert niet (time-out).')), timeoutMs);
      work.then(
        (value) => (clearTimeout(timer), resolve(value)),
        (error) => (clearTimeout(timer), reject(error)),
      );
    });

  return {
    state: () => state,

    // `fromUser`: een knop of menu-item; zonder dat is het de stille controle bij het opstarten
    async check(fromUser = true) {
      if (!supported) return;
      if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
      manual = fromUser;
      set({ status: 'checking', error: undefined });
      try {
        await withTimeout(updater.checkForUpdates());
        // electron-updater meldt zijn uitkomst als event; kwam er geen (bijv. resultaat null), dan is er niets nieuws
        if (status() === 'checking') set({ status: 'none', checkedAt: now() }, true);
      } catch (error) {
        // electron-updater meldt dezelfde fout ook als event; dan staat de status al goed
        if (status() === 'checking') fail(error);
      }
    },

    async download() {
      if (!supported || state.status !== 'available') return;
      set({ status: 'downloading', progress: 0, error: undefined });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        if (status() === 'downloading') fail(error);
      }
    },

    // sluit de app af, installeert de update en start de nieuwe versie
    install() {
      if (!supported || state.status !== 'ready') return false;
      updater.quitAndInstall(false, true);
      return true;
    },

    // stille controle kort na het opstarten en daarna elke zes uur
    startAutoCheck(schedule: typeof setTimeout = setTimeout, repeat: typeof setInterval = setInterval) {
      if (!supported) return () => {};
      const first = schedule(() => void this.check(false), FIRST_CHECK_MS);
      const every = repeat(() => void this.check(false), CHECK_EVERY_MS);
      return () => {
        clearTimeout(first);
        clearInterval(every);
      };
    },
  };
}

export type UpdateManager = ReturnType<typeof createUpdateManager>;
