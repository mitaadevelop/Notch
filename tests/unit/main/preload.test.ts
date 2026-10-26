import { beforeEach, describe, expect, test, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, Record<string, unknown>>(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: Record<string, unknown>) => bridge.exposed.set(name, api),
  },
  ipcRenderer: { invoke: bridge.invoke, send: bridge.send, on: bridge.on },
}));

type Api = Record<string, (...args: unknown[]) => unknown>;

beforeEach(async () => {
  vi.resetModules();
  bridge.exposed.clear();
  bridge.invoke.mockReset();
  bridge.send.mockReset();
  bridge.on.mockReset();
  await import('../../../src/preload.ts');
});

describe('preload', () => {
  test('stelt alleen "agenda" en "versions" bloot', () => {
    expect([...bridge.exposed.keys()].sort()).toEqual(['agenda', 'versions']);
  });

  test('agenda heeft precies de bedoelde functies en geen ruwe ipcRenderer', () => {
    const agenda = bridge.exposed.get('agenda')!;
    expect(Object.keys(agenda).sort()).toEqual(
      [
        'platform',
        'onNotificationSnooze',
        'chatStatus',
        'chatSetKey',
        'chatClearKey',
        'chatSetModel',
        'chatSend',
        'chatReset',
        'geocode',
        'getForecast',
        'composeMail',
        'updateTray',
        'setShortcut',
        'listBackups',
        'restoreBackup',
        'getMcp',
        'setMcp',
        'installMcpForClaude',
        'onMcpCall',
        'mcpReply',
        'mcpReady',
        'getUpdateState',
        'checkForUpdates',
        'downloadUpdate',
        'installUpdate',
        'onUpdateState',
        'fetchFeed',
        'connectAccount',
        'fetchAccountCalendar',
        'removeAccount',
        'load',
        'save',
        'exportICS',
        'importICS',
        'notify',
        'setDockIcon',
        'nativeEdit',
        'menuState',
        'popupMenu',
        'onMenu',
        'onNotificationOpen',
      ].sort(),
    );
    expect(agenda.platform).toBe(process.platform);
    expect(agenda).not.toHaveProperty('ipcRenderer');
    expect(agenda).not.toHaveProperty('invoke');
  });

  test('aanroepen worden op het juiste kanaal doorgezet', async () => {
    const agenda = bridge.exposed.get('agenda') as Api;
    bridge.invoke.mockResolvedValue('antwoord');

    expect(await agenda.load()).toBe('antwoord');
    expect(bridge.invoke).toHaveBeenLastCalledWith('data:load');
    await agenda.save({ events: [] });
    expect(bridge.invoke).toHaveBeenLastCalledWith('data:save', { events: [] });
    await agenda.exportICS('tekst', 'Werk');
    expect(bridge.invoke).toHaveBeenLastCalledWith('ics:export', { text: 'tekst', name: 'Werk' });
    await agenda.importICS();
    expect(bridge.invoke).toHaveBeenLastCalledWith('ics:import');
    await agenda.popupMenu([{ id: 'a', label: 'A' }]);
    expect(bridge.invoke).toHaveBeenLastCalledWith('popup-menu', [{ id: 'a', label: 'A' }]);

    await agenda.fetchFeed('https://voorbeeld.nl/a.ics');
    expect(bridge.invoke).toHaveBeenLastCalledWith('feed:fetch', 'https://voorbeeld.nl/a.ics');
    await agenda.connectAccount({ provider: 'icloud', serverUrl: '', username: 'a', password: 'b' });
    expect(bridge.invoke).toHaveBeenLastCalledWith('account:connect', {
      provider: 'icloud',
      serverUrl: '',
      username: 'a',
      password: 'b',
    });
    await agenda.fetchAccountCalendar('acc', 'https://x/cal/');
    expect(bridge.invoke).toHaveBeenLastCalledWith('account:fetch', {
      accountId: 'acc',
      calendarUrl: 'https://x/cal/',
    });
    await agenda.removeAccount('acc');
    expect(bridge.invoke).toHaveBeenLastCalledWith('account:remove', 'acc');

    agenda.notify({ title: 't' });
    expect(bridge.send).toHaveBeenLastCalledWith('notify', { title: 't' });
    agenda.setDockIcon('data:');
    expect(bridge.send).toHaveBeenLastCalledWith('dock-icon', 'data:');
    agenda.nativeEdit('copy');
    expect(bridge.send).toHaveBeenLastCalledWith('native-edit', 'copy');
    agenda.menuState({ weekNumbers: true });
    expect(bridge.send).toHaveBeenLastCalledWith('menu-state', { weekNumbers: true });
  });

  test('een fout van main komt bij de aanroeper terecht', async () => {
    const agenda = bridge.exposed.get('agenda') as Api;
    bridge.invoke.mockRejectedValue(new Error('schijf vol'));
    await expect(agenda.save({})).rejects.toThrow('schijf vol');
  });

  test('menu- en notificatie-callbacks krijgen het event niet te zien', () => {
    const agenda = bridge.exposed.get('agenda') as Api;
    const onMenu = vi.fn();
    const onOpen = vi.fn();
    agenda.onMenu(onMenu);
    agenda.onNotificationOpen(onOpen);

    const [menuChannel, menuListener] = bridge.on.mock.calls[0];
    const [openChannel, openListener] = bridge.on.mock.calls[1];
    expect([menuChannel, openChannel]).toEqual(['menu', 'notify-open']);

    menuListener({ sender: 'geheim' }, 'view:week');
    openListener({ sender: 'geheim' }, { id: 'e1', date: '2026-10-26' });
    expect(onMenu).toHaveBeenCalledWith('view:week');
    expect(onOpen).toHaveBeenCalledWith({ id: 'e1', date: '2026-10-26' });
  });

  test('versions geeft alleen versienummers', () => {
    const versions = bridge.exposed.get('versions') as Api;
    expect(Object.keys(versions).sort()).toEqual(['chrome', 'electron', 'node']);
    expect(versions.node()).toBe(process.versions.node);
  });
});
