import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  dialog,
  electronMock,
  electronState,
  FakeNotification,
  FakeTray,
  fakeShortcuts,
  fakeUpdater,
  updaterMock,
} from './electron-mock.ts';

vi.mock('electron', () => electronMock);
vi.mock('electron-updater', () => updaterMock);
// de echte socket voor Claude heeft zijn eigen tests (mcp-appserver); hier zou hij alleen tijdelijke mappen bijhouden
vi.mock('../../../src/mcp/appserver.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/mcp/appserver.ts')>()),
  startAppServer: vi.fn().mockResolvedValue({ socketPath: '/nep.sock', close: vi.fn().mockResolvedValue(undefined) }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// start main.ts opnieuw met een lege userData-map en geeft de geregistreerde handlers terug
async function startMain() {
  vi.resetModules();
  electronState.handlers.clear();
  electronState.listeners.clear();
  electronState.windows.length = 0;
  fakeUpdater.removeAllListeners();
  await import('../../../src/main.ts');
  await flush();
  const win = electronState.windows[0];
  const trusted = { sender: win.webContents };
  const stranger = { sender: {} };
  const invoke = (channel: string, event: unknown, ...args: unknown[]) => {
    const handler = electronState.handlers.get(channel);
    if (!handler) throw new Error(`geen handler voor ${channel}`);
    return handler(event, ...args);
  };
  const send = (channel: string, event: unknown, ...args: unknown[]) => {
    const listener = electronState.listeners.get(channel);
    if (!listener) throw new Error(`geen luisteraar voor ${channel}`);
    return listener(event, ...args);
  };
  return { win, trusted, stranger, invoke, send };
}

beforeEach(() => {
  electronState.userData = mkdtempSync(path.join(tmpdir(), 'agenda-test-'));
  electronState.notifications.length = 0;
  electronState.popups.length = 0;
  dialog.showSaveDialog.mockReset();
  dialog.showOpenDialog.mockReset();
  electronState.weekNumbersItem.checked = false;
});

afterEach(() => {
  rmSync(electronState.userData, { recursive: true, force: true });
});

describe('kanalen die main registreert', () => {
  test('precies de bedoelde IPC-kanalen', async () => {
    await startMain();
    expect([...electronState.handlers.keys()].sort()).toEqual(
      [
        'account:connect',
        'account:fetch',
        'account:remove',
        'data:load',
        'data:save',
        'feed:fetch',
        'ics:export',
        'backups:list',
        'chat:clear-key',
        'chat:reset',
        'chat:send',
        'chat:set-key',
        'chat:set-model',
        'chat:status',
        'backups:restore',
        'ics:import',
        'mail:compose',
        'weather:forecast',
        'weather:geocode',
        'mcp:get',
        'mcp:install',
        'mcp:set',
        'popup-menu',
        'shortcut:set',
        'update:check',
        'update:download',
        'update:install',
        'update:state',
      ].sort(),
    );
    expect([...electronState.listeners.keys()].sort()).toEqual(
      ['dock-icon', 'mcp:ready', 'mcp:reply', 'menu-state', 'native-edit', 'notify', 'tray:update'].sort(),
    );
  });
});

describe('data:load en data:save', () => {
  test('eerste start zonder bestand geeft null', async () => {
    const { invoke, trusted } = await startMain();
    expect(await invoke('data:load', trusted)).toBeNull();
  });

  test('kapot JSON-bestand geeft null in plaats van een fout', async () => {
    const { invoke, trusted } = await startMain();
    writeFileSync(path.join(electronState.userData, 'events.json'), '{ dit is geen json');
    expect(await invoke('data:load', trusted)).toBeNull();
  });

  test('opslaan en weer laden, zonder tijdelijk bestand achter te laten', async () => {
    const { invoke, trusted } = await startMain();
    const data = { version: 2, calendars: [], events: [{ id: 'a' }], settings: {} };
    await invoke('data:save', trusted, data);
    expect(await invoke('data:load', trusted)).toEqual(data);
    expect(readdirSync(electronState.userData).filter((n) => n !== 'backups')).toEqual(['events.json']); // geen tijdelijk bestand achtergebleven
  });

  test('ongeldige data wordt geweigerd en laat het bestand ongemoeid', async () => {
    const { invoke, trusted } = await startMain();
    await invoke('data:save', trusted, { version: 2, events: [] });
    for (const bad of ['tekst', null, 42, undefined]) {
      await expect(invoke('data:save', trusted, bad)).rejects.toThrow('data moet een object of array zijn');
    }
    expect(JSON.parse(await readFile(path.join(electronState.userData, 'events.json'), 'utf8'))).toEqual({
      version: 2,
      events: [],
    });
  });

  test('veel opdrachten vlak na elkaar: het bestand blijft geldig en de laatste wint', async () => {
    const { invoke, trusted } = await startMain();
    const saves = Array.from({ length: 30 }, (_, i) =>
      invoke('data:save', trusted, {
        version: 2,
        events: Array.from({ length: i * 20 }, (_, j) => ({ id: `${i}-${j}` })),
      }),
    );
    await Promise.all(saves as Promise<unknown>[]);
    const parsed = JSON.parse(await readFile(path.join(electronState.userData, 'events.json'), 'utf8'));
    expect(parsed.events).toHaveLength(29 * 20);
    expect(readdirSync(electronState.userData).filter((n) => n !== 'backups')).toEqual(['events.json']); // geen tijdelijk bestand achtergebleven
  });

  test('een mislukte opdracht houdt de volgende niet tegen', async () => {
    const { invoke, trusted } = await startMain();
    const bad = invoke('data:save', trusted, 'geen object') as Promise<unknown>;
    const good = invoke('data:save', trusted, { version: 2, events: [] }) as Promise<unknown>;
    await expect(bad).rejects.toThrow();
    await expect(good).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(electronState.userData, 'events.json'), 'utf8'))).toEqual({
      version: 2,
      events: [],
    });
  });

  test('een vreemde afzender kan niets opslaan', async () => {
    const { invoke, stranger } = await startMain();
    await invoke('data:save', stranger, { events: [] });
    expect(existsSync(path.join(electronState.userData, 'events.json'))).toBe(false);
  });
});

describe('ics:export', () => {
  test('schrijft het bestand naar het gekozen pad', async () => {
    const { invoke, trusted } = await startMain();
    const target = path.join(electronState.userData, 'uit.ics');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    expect(await invoke('ics:export', trusted, { text: 'BEGIN:VCALENDAR', name: 'Werk' })).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('BEGIN:VCALENDAR');
  });

  test('maakt de voorgestelde bestandsnaam veilig', async () => {
    const { invoke, trusted } = await startMain();
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    await invoke('ics:export', trusted, { text: 'x', name: 'a/b:c*d' });
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe('a-b-c-d.ics');
  });

  test('annuleren geeft false en schrijft niets', async () => {
    const { invoke, trusted } = await startMain();
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    expect(await invoke('ics:export', trusted, { text: 'x', name: 'n' })).toBe(false);
  });

  test('geen tekst of een vreemde afzender opent niet eens een dialoog', async () => {
    const { invoke, trusted, stranger } = await startMain();
    expect(await invoke('ics:export', trusted, { text: 123, name: 'n' })).toBe(false);
    expect(await invoke('ics:export', stranger, { text: 'x', name: 'n' })).toBe(false);
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });
});

describe('ics:import', () => {
  test('leest gekozen bestanden met naam zonder extensie', async () => {
    const { invoke, trusted } = await startMain();
    const file = path.join(electronState.userData, 'Verjaardagen.ics');
    writeFileSync(file, 'BEGIN:VCALENDAR');
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] });
    expect(await invoke('ics:import', trusted)).toEqual([{ name: 'Verjaardagen', text: 'BEGIN:VCALENDAR' }]);
  });

  test('annuleren en vreemde afzenders geven een lege lijst', async () => {
    const { invoke, trusted, stranger } = await startMain();
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke('ics:import', trusted)).toEqual([]);
    expect(await invoke('ics:import', stranger)).toEqual([]);
  });

  test('een bestand dat niet gelezen kan worden laat de import mislukken', async () => {
    const { invoke, trusted } = await startMain();
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/bestaat/niet.ics'] });
    await expect(invoke('ics:import', trusted)).rejects.toThrow();
  });
});

describe('meldingen en venster', () => {
  test('notify toont een melding en klikken opent het venster en de dag', async () => {
    const { send, trusted, win } = await startMain();
    send('notify', trusted, { title: 'Tandarts', body: 'om 14:00', id: 'e1', date: '2026-10-26' });
    expect(electronState.notifications).toHaveLength(1);
    expect(electronState.notifications[0].options).toMatchObject({ title: 'Tandarts', body: 'om 14:00' });
    expect(electronState.notifications[0].show).toHaveBeenCalled();
    electronState.notifications[0].emitClick();
    expect(win.show).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('notify-open', { id: 'e1', date: '2026-10-26' });
  });

  test('op macOS heeft de melding een uitstel-knop die de pagina vertelt wat er uitgesteld wordt', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const { send, trusted, win } = await startMain();
      send('notify', trusted, { title: 'Tandarts', body: 'om 14:00', id: 'e1', date: '2026-10-26' });
      expect(electronState.notifications[0].options.actions).toEqual([{ type: 'button', text: 'Over 10 min' }]);
      electronState.notifications[0].emitAction();
      expect(win.webContents.send).toHaveBeenCalledWith(
        'notify-snooze',
        { title: 'Tandarts', body: 'om 14:00', id: 'e1', date: '2026-10-26' },
        10,
      );
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  test('op andere systemen zonder knoppen', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const { send, trusted } = await startMain();
      send('notify', trusted, { title: 'x', body: '', id: null, date: '' });
      expect(electronState.notifications[0].options.actions).toEqual([]);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  test('geen melding voor een vreemde afzender of zonder ondersteuning', async () => {
    const { send, stranger, trusted } = await startMain();
    send('notify', stranger, { title: 'x', body: '', id: null, date: '' });
    FakeNotification.isSupported.mockReturnValueOnce(false);
    send('notify', trusted, { title: 'x', body: '', id: null, date: '' });
    expect(electronState.notifications).toHaveLength(0);
  });

  test('dock-icoon alleen van het eigen venster en alleen als tekst', async () => {
    const { send, stranger, trusted } = await startMain();
    send('dock-icon', stranger, 'data:image/png;base64,AAA');
    send('dock-icon', trusted, { geen: 'tekst' });
    expect(electronMock.app.dock.setIcon).not.toHaveBeenCalled();
    send('dock-icon', trusted, 'data:image/png;base64,AAA');
    expect(electronMock.app.dock.setIcon).toHaveBeenCalledTimes(1);
  });
});

describe('native-edit en menu-state', () => {
  test("alleen bekende bewerkcommando's worden uitgevoerd", async () => {
    const { send, trusted, stranger, win } = await startMain();
    for (const command of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) send('native-edit', trusted, command);
    expect(win.webContents.undo).toHaveBeenCalledTimes(1);
    expect(win.webContents.selectAll).toHaveBeenCalledTimes(1);
    // onbekende commando's en vreemde afzenders doen niets en gooien niet
    expect(() => send('native-edit', trusted, 'constructor')).not.toThrow();
    send('native-edit', stranger, 'undo');
    expect(win.webContents.undo).toHaveBeenCalledTimes(1);
  });

  test('menu-state zet het vinkje bij "Toon weeknummers"', async () => {
    const { send, trusted, stranger } = await startMain();
    send('menu-state', trusted, { weekNumbers: true });
    expect(electronState.weekNumbersItem.checked).toBe(true);
    send('menu-state', stranger, { weekNumbers: false });
    expect(electronState.weekNumbersItem.checked).toBe(true);
    send('menu-state', trusted, undefined);
    expect(electronState.weekNumbersItem.checked).toBe(false);
  });
});

describe("externe agenda's", () => {
  test('feed:fetch haalt een agenda op, maar alleen voor het eigen venster en met een tekst als adres', async () => {
    const { startFeed, calendarText, vevent } = await import('../../helpers/servers.ts');
    const feed = await startFeed({ body: calendarText('Test', vevent('1', 'x', '20261026T100000')) });
    try {
      const { invoke, trusted, stranger } = await startMain();
      expect(await invoke('feed:fetch', trusted, feed.calendarUrl)).toContain('SUMMARY:x');
      expect(() => invoke('feed:fetch', stranger, feed.calendarUrl)).toThrow('Niet toegestaan');
      expect(() => invoke('feed:fetch', trusted, { url: feed.calendarUrl })).toThrow('Niet toegestaan');
      await expect(invoke('feed:fetch', trusted, 'file:///etc/passwd')).rejects.toThrow();
    } finally {
      await feed.close();
    }
  });

  test('account-kanalen weigeren vreemde afzenders en ongeldige invoer', async () => {
    const { invoke, trusted, stranger } = await startMain();
    for (const channel of ['account:connect', 'account:fetch', 'account:remove']) {
      expect(() => invoke(channel, stranger, {})).toThrow('Niet toegestaan');
    }
    expect(() => invoke('account:connect', trusted, null)).toThrow('Niet toegestaan');
    expect(() => invoke('account:fetch', trusted, { accountId: 1, calendarUrl: 'x' })).toThrow('Niet toegestaan');
    expect(() => invoke('account:remove', trusted, 42)).toThrow('Niet toegestaan');
  });
});

describe('updates', () => {
  const original = process.env.AGENDA_UPDATE_FEED;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENDA_UPDATE_FEED;
    else process.env.AGENDA_UPDATE_FEED = original;
    electronMock.app.isPackaged = false;
    fakeUpdater.setFeedURL.mockClear();
    fakeUpdater.checkForUpdates.mockClear();
    fakeUpdater.forceDevUpdateConfig = false;
  });

  test('een ontwikkelversie zonder testserver kan niet updaten', async () => {
    delete process.env.AGENDA_UPDATE_FEED;
    const { invoke, trusted } = await startMain();
    expect(await invoke('update:state', trusted)).toMatchObject({ status: 'unsupported', currentVersion: '0.1.0' });
    await invoke('update:check', trusted);
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('AGENDA_UPDATE_FEED wijst in een ontwikkelversie een testserver aan', async () => {
    process.env.AGENDA_UPDATE_FEED = 'http://127.0.0.1:9999/updates';
    const { invoke, trusted } = await startMain();
    expect(fakeUpdater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://127.0.0.1:9999/updates' });
    expect(fakeUpdater.forceDevUpdateConfig).toBe(true);
    expect(await invoke('update:state', trusted)).toMatchObject({ status: 'idle' });
  });

  test('in een verpakte app wordt die variabele genegeerd: het adres komt alleen uit de build', async () => {
    process.env.AGENDA_UPDATE_FEED = 'http://kwaadaardig.example/updates';
    electronMock.app.isPackaged = true;
    const { invoke, trusted } = await startMain();
    expect(fakeUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(fakeUpdater.forceDevUpdateConfig).toBe(false);
    expect(await invoke('update:state', trusted)).toMatchObject({ status: 'idle' });
  });

  test('controleren, downloaden en installeren lopen door naar de updater, en de pagina krijgt de status', async () => {
    process.env.AGENDA_UPDATE_FEED = 'http://127.0.0.1:9999/updates';
    const { invoke, trusted, win } = await startMain();
    fakeUpdater.checkForUpdates.mockImplementationOnce(
      async () => void fakeUpdater.emit('update-available', { version: '0.2.0' }),
    );
    await invoke('update:check', trusted);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({ status: 'available', version: '0.2.0' }),
    );

    await invoke('update:download', trusted);
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    fakeUpdater.emit('update-downloaded', { version: '0.2.0' });
    expect(win.webContents.send).toHaveBeenLastCalledWith('update:state', expect.objectContaining({ status: 'ready' }));

    await invoke('update:install', trusted);
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  test('een vreemde afzender kan niets met updates doen', async () => {
    process.env.AGENDA_UPDATE_FEED = 'http://127.0.0.1:9999/updates';
    const { invoke, stranger } = await startMain();
    for (const channel of ['update:state', 'update:check', 'update:download', 'update:install']) {
      // sommige handlers zijn async (afwijzing), andere gooien meteen: beide tellen als geweigerd
      await expect((async () => invoke(channel, stranger))()).rejects.toThrow('Niet toegestaan');
    }
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe('popup-menu', () => {
  test('geeft het id van het gekozen item terug', async () => {
    const { invoke, trusted } = await startMain();
    const pending = invoke('popup-menu', trusted, [
      { id: 'edit', label: 'Bewerk…' },
      { separator: true },
      { id: 'delete', label: 'Verwijder', enabled: false },
    ]) as Promise<string | null>;
    const { template } = electronState.popups[0];
    expect(template.map((item) => item.type ?? item.label)).toEqual(['Bewerk…', 'separator', 'Verwijder']);
    expect(template[2].enabled).toBe(false);
    template[0].click?.();
    expect(await pending).toBe('edit');
  });

  test('sluiten zonder keuze geeft null', async () => {
    const { invoke, trusted } = await startMain();
    const pending = invoke('popup-menu', trusted, [{ id: 'a', label: 'A' }]) as Promise<string | null>;
    electronState.popups[0].options.callback?.();
    expect(await pending).toBeNull();
  });

  test('ongeldige invoer of een vreemde afzender geeft null zonder menu', async () => {
    const { invoke, trusted, stranger } = await startMain();
    expect(await invoke('popup-menu', trusted, 'geen lijst')).toBeNull();
    expect(await invoke('popup-menu', stranger, [{ id: 'a', label: 'A' }])).toBeNull();
    expect(electronState.popups).toHaveLength(0);
  });
});

describe('back-ups', () => {
  const doc = (n: number) => ({
    version: 2,
    calendars: [],
    events: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })),
    settings: {},
  });
  const onDisk = async () => JSON.parse(await readFile(path.join(electronState.userData, 'events.json'), 'utf8'));

  // twee keer opslaan: de tweede keer wordt de eerste stand als back-up bewaard
  async function twoSaves() {
    const ctx = await startMain();
    await ctx.invoke('data:save', ctx.trusted, doc(1));
    await ctx.invoke('data:save', ctx.trusted, doc(3));
    return ctx;
  }

  test('de eerste save maakt geen back-up (er was niets), de tweede bewaart de vorige stand', async () => {
    const { invoke, trusted } = await startMain();
    await invoke('data:save', trusted, doc(1));
    expect(await invoke('backups:list', trusted)).toEqual([]);
    await invoke('data:save', trusted, doc(3));
    const list = (await invoke('backups:list', trusted)) as { events: number }[];
    expect(list).toHaveLength(1);
    expect(list[0].events).toBe(1);
  });

  test('terugzetten vraagt bevestiging, zet de oude stand terug en bewaart eerst de huidige', async () => {
    const { invoke, trusted } = await twoSaves();
    const [backup] = (await invoke('backups:list', trusted)) as { name: string }[];
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await invoke('backups:restore', trusted, backup.name)).toBe(true);
    expect((await onDisk()).events).toHaveLength(1);
    const after = (await invoke('backups:list', trusted)) as { events: number; beforeRestore: boolean }[];
    expect(after.find((b) => b.beforeRestore)?.events).toBe(3); // de stand van vlak voor het herstel is niet verloren
  });

  test('annuleren laat alles ongemoeid', async () => {
    const { invoke, trusted } = await twoSaves();
    const [backup] = (await invoke('backups:list', trusted)) as { name: string }[];
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await invoke('backups:restore', trusted, backup.name)).toBe(false);
    expect((await onDisk()).events).toHaveLength(3);
    expect(await invoke('backups:list', trusted)).toHaveLength(1);
  });

  test('vreemde afzenders, rare namen en niet-bestaande back-ups worden geweigerd', async () => {
    const { invoke, trusted, stranger } = await twoSaves();
    expect(() => invoke('backups:list', stranger)).toThrow('Niet toegestaan');
    await expect(invoke('backups:restore', stranger, 'x')).rejects.toThrow('Niet toegestaan');
    await expect(invoke('backups:restore', trusted, 5)).rejects.toThrow('Niet toegestaan');
    await expect(invoke('backups:restore', trusted, '../events.json')).rejects.toThrow('Onbekende back-up');
    await expect(invoke('backups:restore', trusted, 'events-2020-01-01T00-00-00-000Z.json')).rejects.toThrow(
      'bestaat niet meer',
    );
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect((await onDisk()).events).toHaveLength(3);
  });
});

describe('menubalk en sneltoets', () => {
  test('tray:update maakt het icoon voor het eigen venster en negeert onzin of vreemde afzenders', async () => {
    FakeTray.instances.length = 0;
    const { send, trusted, stranger } = await startMain();
    const ok = { enabled: true, title: 'T', tooltip: 'x', items: [] };
    send('tray:update', stranger, ok);
    send('tray:update', trusted, 'onzin');
    expect(FakeTray.instances).toHaveLength(0);
    send('tray:update', trusted, ok);
    expect(FakeTray.instances).toHaveLength(1);
    send('tray:update', trusted, { ...ok, enabled: false });
    expect(FakeTray.instances[0].destroyed).toBe(true);
  });

  test('shortcut:set registreert, meldt een bezette combinatie, en weigert vreemde afzenders', async () => {
    fakeShortcuts.registered.clear();
    fakeShortcuts.taken.clear();
    const { invoke, trusted, stranger } = await startMain();
    expect(await invoke('shortcut:set', trusted, 'CommandOrControl+Alt+N')).toBe(true);
    expect(fakeShortcuts.registered.has('CommandOrControl+Alt+N')).toBe(true);
    fakeShortcuts.taken.add('CommandOrControl+Alt+X');
    expect(await invoke('shortcut:set', trusted, 'CommandOrControl+Alt+X')).toBe(false);
    expect(await invoke('shortcut:set', trusted, 'N')).toBe(false);
    expect(() => invoke('shortcut:set', stranger, 'CommandOrControl+Alt+Y')).toThrow('Niet toegestaan');
    expect(await invoke('shortcut:set', trusted, '')).toBe(true);
    expect(fakeShortcuts.registered.size).toBe(0);
  });

  test('de sneltoets toont het venster en stuurt "new" naar de pagina', async () => {
    fakeShortcuts.registered.clear();
    const { invoke, trusted, win } = await startMain();
    await invoke('shortcut:set', trusted, 'CommandOrControl+Alt+N');
    fakeShortcuts.registered.get('CommandOrControl+Alt+N')!();
    expect(win.show).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('menu', 'new');
  });
});

describe('mail:compose', () => {
  test('opent de mail-app met een mailto-link voor het eigen venster', async () => {
    electronMock.shell.openExternal.mockClear();
    const { invoke, trusted } = await startMain();
    expect(await invoke('mail:compose', trusted, { to: ['sam@example.com'], subject: 'Hoi', body: 'Tot dan' })).toBe(
      true,
    );
    expect(electronMock.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(electronMock.shell.openExternal.mock.calls[0][0]).toMatch(
      /^mailto:sam%40example\.com\?subject=Hoi&body=Tot%20dan$/,
    );
  });

  test('zonder geldige ontvanger gebeurt er niets, en vreemde afzenders worden geweigerd', async () => {
    electronMock.shell.openExternal.mockClear();
    const { invoke, trusted, stranger } = await startMain();
    expect(await invoke('mail:compose', trusted, { to: ['Sam'], subject: '', body: '' })).toBe(false);
    expect(await invoke('mail:compose', trusted, 'onzin')).toBe(false);
    await expect(invoke('mail:compose', stranger, { to: ['sam@example.com'], subject: '', body: '' })).rejects.toThrow(
      'Niet toegestaan',
    );
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
  });

  test('de pagina kan geen andere soort link laten openen', async () => {
    electronMock.shell.openExternal.mockClear();
    const { invoke, trusted } = await startMain();
    await invoke('mail:compose', trusted, {
      to: ['sam@example.com'],
      subject: 'javascript:alert(1)',
      body: 'file:///etc/passwd',
    });
    expect(electronMock.shell.openExternal.mock.calls[0][0].startsWith('mailto:')).toBe(true);
  });
});

describe('weer', () => {
  test('geocode en voorspelling lopen via main, alleen voor het eigen venster', async () => {
    const { startWeather } = await import('../../helpers/servers.ts');
    const server = await startWeather();
    const previous = [process.env.AGENDA_WEATHER_GEO, process.env.AGENDA_WEATHER_API];
    process.env.AGENDA_WEATHER_GEO = process.env.AGENDA_WEATHER_API = server.url;
    try {
      const { invoke, trusted, stranger } = await startMain();
      expect(await invoke('weather:geocode', trusted, 'Utrecht')).toMatchObject({ city: 'Utrecht, Nederland' });
      const days = (await invoke('weather:forecast', trusted, { lat: 52.09, lon: 5.12 })) as unknown[];
      expect(days).toHaveLength(14);
      expect(() => invoke('weather:geocode', stranger, 'Utrecht')).toThrow('Niet toegestaan');
      expect(() => invoke('weather:forecast', stranger, { lat: 1, lon: 1 })).toThrow('Niet toegestaan');
      await expect(invoke('weather:forecast', trusted, null)).rejects.toThrow('Ongeldige locatie');
      await expect(invoke('weather:forecast', trusted, { lat: 'x', lon: 1 })).rejects.toThrow('Ongeldige locatie');
    } finally {
      if (previous[0] === undefined) delete process.env.AGENDA_WEATHER_GEO;
      else process.env.AGENDA_WEATHER_GEO = previous[0];
      if (previous[1] === undefined) delete process.env.AGENDA_WEATHER_API;
      else process.env.AGENDA_WEATHER_API = previous[1];
      await server.close();
    }
  });

  test('in een verpakte app worden de testadressen genegeerd', async () => {
    const previous = electronMock.app.isPackaged;
    (electronMock.app as { isPackaged: boolean }).isPackaged = true;
    process.env.AGENDA_WEATHER_GEO = 'http://127.0.0.1:1';
    try {
      const { invoke, trusted } = await startMain();
      // het echte adres zou worden gebruikt; dat is niet bereikbaar in de test, maar het testadres mag het nooit zijn
      await expect(invoke('weather:geocode', trusted, 'x')).rejects.toThrow('Typ de naam');
    } finally {
      (electronMock.app as { isPackaged: boolean }).isPackaged = previous;
      delete process.env.AGENDA_WEATHER_GEO;
    }
  });
});

describe('chat in de app', () => {
  const KEY = `sk-ant-api03-${'b'.repeat(40)}`;

  // de pagina speelt mee: meldt dat hij klaar is en beantwoordt tool-verzoeken van de chat met een vast antwoord
  async function chatMain(
    respond: Parameters<typeof import('../../helpers/servers.ts').startAnthropic>[0],
    pageReply: (tool: string) => unknown = () => ({ ok: 1 }),
  ) {
    const { startAnthropic } = await import('../../helpers/servers.ts');
    const api = await startAnthropic(respond);
    process.env.AGENDA_ANTHROPIC_BASE_URL = api.url;
    const ctx = await startMain();
    ctx.send('mcp:ready', ctx.trusted);
    ctx.win.webContents.send.mockImplementation((channel: string, call: { id: number; tool: string }) => {
      if (channel === 'mcp:call') {
        queueMicrotask(() =>
          ctx.send('mcp:reply', ctx.trusted, { id: call.id, reply: { ok: true, result: pageReply(call.tool) } }),
        );
      }
    });
    return { ...ctx, api };
  }
  afterEach(() => {
    delete process.env.AGENDA_ANTHROPIC_BASE_URL;
  });

  test('zonder sleutel: status zegt dat er geen is, en versturen vraagt erom', async () => {
    const { invoke, trusted } = await startMain();
    expect(await invoke('chat:status', trusted)).toMatchObject({ hasKey: false, model: 'claude-opus-5-5' });
    await expect(invoke('chat:send', trusted, 'hoi')).rejects.toThrow('Voeg eerst je API-sleutel toe');
  });

  test('een sleutel opslaan: versleuteld op schijf, nooit terug naar de pagina; verkeerde sleutel geweigerd', async () => {
    const { invoke, trusted } = await startMain();
    await expect(invoke('chat:set-key', trusted, 'niet-een-sleutel')).rejects.toThrow('sk-ant-');
    const status = await invoke('chat:set-key', trusted, KEY);
    expect(status).toMatchObject({ hasKey: true });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(JSON.stringify(await invoke('chat:status', trusted))).not.toContain(KEY);
    expect(await readFile(path.join(electronState.userData, 'chat.json'), 'utf8')).not.toContain('sk-ant');
    expect(await invoke('chat:clear-key', trusted)).toMatchObject({ hasKey: false });
  });

  test('zonder veilige opslag wordt de sleutel niet bewaard', async () => {
    const { safeStorage } = electronMock;
    const { invoke, trusted } = await startMain();
    safeStorage.available = false;
    try {
      await expect(invoke('chat:set-key', trusted, KEY)).rejects.toThrow('Veilig bewaren');
      expect(await invoke('chat:status', trusted)).toMatchObject({ hasKey: false });
    } finally {
      safeStorage.available = true;
    }
  });

  test('het model kiezen: alleen bekende modellen', async () => {
    const { invoke, trusted } = await startMain();
    expect(await invoke('chat:set-model', trusted, 'claude-haiku-5-5')).toMatchObject({ model: 'claude-haiku-5-5' });
    await expect(invoke('chat:set-model', trusted, 'gpt-5')).rejects.toThrow('Onbekend model');
  });

  test('een vraag met een tool: Claude vraagt de agenda, de pagina antwoordt, Claude beantwoordt de vraag', async () => {
    const { apiMessage, apiText, apiToolUse } = await import('../../helpers/servers.ts');
    const { invoke, trusted, api } = await chatMain(
      (_req, n) =>
        n === 1
          ? { body: apiMessage([apiToolUse('t1', 'get_context', {})], 'tool_use') }
          : { body: apiMessage([apiText('Vandaag is het maandag.')]) },
      (tool) => ({ tool, today: '2026-10-26' }),
    );
    try {
      await invoke('chat:set-key', trusted, KEY);
      const turn = await invoke('chat:send', trusted, 'Welke dag is het?');
      expect(turn).toEqual({
        text: 'Vandaag is het maandag.',
        actions: [{ tool: 'get_context', label: 'Agenda bekeken', ok: true }],
      });
      expect(api.seen).toHaveLength(2);
      expect(api.seen[0].headers.authorization).toBe(`Bearer ${KEY}`); // zo stuurt de SDK de sleutel mee
      expect(api.seen[0].headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(api.seen[0].body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
      expect(api.seen[0].body.tools).toHaveLength(8);
      expect(api.seen[0].body.messages).toEqual([{ role: 'user', content: 'Welke dag is het?' }]);
      const toolResult = api.seen[1].body.messages.at(-1).content[0];
      expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
      expect(JSON.parse(toolResult.content)).toEqual({ tool: 'get_context', today: '2026-10-26' });
    } finally {
      await api.close();
    }
  });

  test('de privacy-instellingen gelden ook hier: wijzigen uit, notities weg', async () => {
    const { apiMessage, apiText, apiToolUse } = await import('../../helpers/servers.ts');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      path.join(electronState.userData, 'mcp.json'),
      JSON.stringify({ allowWrite: false, shareNotes: false, shareInvitees: true }),
    );
    const { invoke, trusted, api } = await chatMain(
      (_req, n) => {
        if (n === 1)
          return {
            body: apiMessage(
              [apiToolUse('a', 'delete_event', { id: 'x' }), apiToolUse('b', 'get_event', { id: 'y' })],
              'tool_use',
            ),
          };
        return { body: apiMessage([apiText('ok')]) };
      },
      () => ({ title: 'Tandarts', notes: 'geheim' }),
    );
    try {
      await invoke('chat:set-key', trusted, KEY);
      const turn = (await invoke('chat:send', trusted, 'verwijder')) as { actions: { ok: boolean }[] };
      expect(turn.actions.map((a) => a.ok)).toEqual([false, true]);
      const results = api.seen[1].body.messages.at(-1).content;
      expect(results[0]).toMatchObject({ is_error: true });
      expect(results[0].content).toContain('Wijzigen staat uit');
      expect(results[1].content).toContain('Tandarts');
      expect(results[1].content).not.toContain('geheim');
    } finally {
      await api.close();
    }
  });

  test('een geweigerde sleutel geeft een leesbare melding', async () => {
    const { invoke, trusted, api } = await chatMain(() => ({
      status: 401,
      body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    }));
    try {
      await invoke('chat:set-key', trusted, KEY);
      await expect(invoke('chat:send', trusted, 'hoi')).rejects.toThrow('API-sleutel is niet geaccepteerd');
    } finally {
      await api.close();
    }
  });

  test('een nieuw gesprek begint leeg; de testserver wordt in een verpakte app genegeerd', async () => {
    const { apiMessage, apiText } = await import('../../helpers/servers.ts');
    const { invoke, trusted, api } = await chatMain(() => ({ body: apiMessage([apiText('ok')]) }));
    try {
      await invoke('chat:set-key', trusted, KEY);
      await invoke('chat:send', trusted, 'een');
      await invoke('chat:send', trusted, 'twee');
      expect(api.seen[1].body.messages).toHaveLength(3);
      await invoke('chat:reset', trusted);
      await invoke('chat:send', trusted, 'drie');
      expect(api.seen[2].body.messages).toHaveLength(1);
    } finally {
      await api.close();
    }
  });

  test('vreemde afzenders en rare invoer worden geweigerd', async () => {
    const { invoke, trusted, stranger } = await startMain();
    expect(() => invoke('chat:status', stranger)).toThrow('Niet toegestaan');
    expect(() => invoke('chat:reset', stranger)).toThrow('Niet toegestaan');
    expect(() => invoke('chat:send', stranger, 'hoi')).toThrow('Niet toegestaan');
    expect(() => invoke('chat:send', trusted, 5)).toThrow('Niet toegestaan');
    await expect(invoke('chat:clear-key', stranger)).rejects.toThrow('Niet toegestaan');
    await expect(invoke('chat:set-key', stranger, KEY)).rejects.toThrow('Niet toegestaan');
    await expect(invoke('chat:set-model', stranger, 'claude-opus-5-5')).rejects.toThrow('Niet toegestaan');
  });
});
