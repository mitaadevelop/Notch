import zlib from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createShell, parseTrayState, validAccelerator } from '../../../src/shell.ts';
import type { ShellDeps } from '../../../src/shell.ts';
import { trayIconPng } from '../../../src/trayicon.ts';
import { FakeTray, fakeShortcuts } from './electron-mock.ts';

const state = (over = {}) => ({
  enabled: true,
  title: 'Tandarts · over 12 min',
  tooltip: 'Volgende: Tandarts',
  items: [{ label: 'Vandaag 14:00 · Tandarts', date: '2026-10-26', id: 'e1' }],
  ...over,
});

describe('parseTrayState', () => {
  test('geldige invoer blijft, met afgekapte tekst en een begrensd aantal regels', () => {
    const parsed = parseTrayState(
      state({
        title: 'x'.repeat(500),
        items: Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, date: 'd', id: null })),
      }),
    )!;
    expect(parsed.title).toHaveLength(200);
    expect(parsed.items).toHaveLength(8);
    expect(parsed.items[0]).toEqual({ label: 'L0', date: 'd', id: null });
  });

  test.each([null, undefined, 5, 'x', [], {}, { enabled: 'ja' }])('onbruikbaar: %j', (raw) => {
    expect(parseTrayState(raw)).toBeNull();
  });

  test('kapotte regels vallen weg; een ontbrekend id wordt null', () => {
    const parsed = parseTrayState({
      enabled: false,
      items: [null, 5, { label: '' }, { label: 7 }, { label: 'ok', date: 'd', id: 5 }],
    })!;
    expect(parsed.items).toEqual([{ label: 'ok', date: 'd', id: null }]);
    expect(parsed).toMatchObject({ enabled: false, title: '', tooltip: '' });
  });
});

describe('validAccelerator', () => {
  test.each([
    'CommandOrControl+Alt+N',
    'Ctrl+Shift+F5',
    'Alt+Space',
    'Command+Up',
    'CmdOrCtrl+1',
    'Shift+Alt+Return',
    'Ctrl+,',
  ])('geldig: %s', (a) => expect(validAccelerator(a)).toBe(true));

  test.each([
    '',
    'N',
    'F5',
    'Space',
    'Ctrl+',
    '+N',
    'Ctrl+Ctrl+N',
    'Hyper+N',
    'Ctrl+Nn',
    'Ctrl+F25',
    'Ctrl+n',
    'Ctrl+Alt+Shift+Meta+Super+Command+Option+N+N',
    'x'.repeat(100),
    5,
    null,
    undefined,
    {},
  ])('ongeldig: %j', (a) => expect(validAccelerator(a)).toBe(false));
});

describe('trayIconPng', () => {
  const read = (png: Buffer) => {
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const chunks: Record<string, Buffer> = {};
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      const type = png.subarray(at + 4, at + 8).toString('ascii');
      chunks[type] = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    return chunks;
  };

  test.each([16, 32])('een geldige RGBA-PNG van %i bij %i beeldpunten met een gevuld en een leeg gebied', (size) => {
    const chunks = read(trayIconPng(size));
    expect(chunks.IHDR.readUInt32BE(0)).toBe(size);
    expect(chunks.IHDR.readUInt32BE(4)).toBe(size);
    expect([chunks.IHDR[8], chunks.IHDR[9]]).toEqual([8, 6]);
    const raw = zlib.inflateSync(chunks.IDAT);
    expect(raw.length).toBe(size * (1 + size * 4));
    const alphaAt = (x: number, y: number) => raw[y * (1 + size * 4) + 1 + x * 4 + 3];
    const s = size / 16;
    expect(alphaAt(Math.floor(2 * s), Math.floor(8 * s))).toBe(255); // de rand van het kalendertje
    expect(alphaAt(0, 0)).toBe(0); // de hoek ernaast is doorzichtig
  });

  test('de controlesom van elk blok klopt', () => {
    const png = trayIconPng(16);
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      let crc = 0xffffffff;
      for (const byte of png.subarray(at + 4, at + 8 + length)) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      expect((crc ^ 0xffffffff) >>> 0).toBe(png.readUInt32BE(at + 8 + length));
      at += 12 + length;
    }
  });
});

describe('createShell', () => {
  let deps: ShellDeps;
  let menus: { label?: string; type?: string; enabled?: boolean; click?: () => void }[][];
  const icon = { icon: true };

  beforeEach(() => {
    FakeTray.instances.length = 0;
    fakeShortcuts.registered.clear();
    fakeShortcuts.taken.clear();
    vi.clearAllMocks();
    menus = [];
    deps = {
      Tray: FakeTray as never,
      Menu: { buildFromTemplate: (t) => (menus.push(t as never), { template: t }) as never },
      createIcon: () => icon as never,
      globalShortcut: fakeShortcuts,
      platform: 'darwin',
      showWindow: vi.fn(),
      sendMenu: vi.fn(),
      openItem: vi.fn(),
      quit: vi.fn(),
    };
  });

  test('maakt het icoon pas als het aan staat, en haalt het weg als het uit gaat', () => {
    const shell = createShell(deps);
    shell.updateTray(state({ enabled: false }));
    expect(FakeTray.instances).toHaveLength(0);
    shell.updateTray(state());
    expect(FakeTray.instances).toHaveLength(1);
    expect(shell.hasTray).toBe(true);
    shell.updateTray(state({ enabled: false }));
    expect(FakeTray.instances[0].destroyed).toBe(true);
    expect(shell.hasTray).toBe(false);
  });

  test('updates hergebruiken hetzelfde icoon en vernieuwen tekst en menu', () => {
    const shell = createShell(deps);
    shell.updateTray(state());
    shell.updateTray(state({ title: 'Lunch · nu', tooltip: 'nieuw' }));
    expect(FakeTray.instances).toHaveLength(1);
    expect(FakeTray.instances[0]).toMatchObject({ title: 'Lunch · nu', tooltip: 'nieuw' });
    expect(menus).toHaveLength(2);
  });

  test('het menu toont de afspraken, dan acties; een afspraak kiezen opent hem', () => {
    const shell = createShell(deps);
    shell.updateTray(state());
    const labels = menus[0].filter((i) => i.type !== 'separator').map((i) => i.label);
    expect(labels).toEqual(['Vandaag 14:00 · Tandarts', 'Nieuwe afspraak…', 'Open Agenda', 'Stop']);
    menus[0][0].click!();
    expect(deps.openItem).toHaveBeenCalledWith({ label: 'Vandaag 14:00 · Tandarts', date: '2026-10-26', id: 'e1' });
    menus[0].find((i) => i.label === 'Nieuwe afspraak…')!.click!();
    expect(deps.showWindow).toHaveBeenCalled();
    expect(deps.sendMenu).toHaveBeenCalledWith('new');
    menus[0].find((i) => i.label === 'Stop')!.click!();
    expect(deps.quit).toHaveBeenCalled();
  });

  test('zonder afspraken staat er een uitgeschakelde melding', () => {
    createShell(deps).updateTray(state({ items: [] }));
    expect(menus[0][0]).toMatchObject({ label: 'Geen afspraken de komende dagen', enabled: false });
  });

  test('de tekst naast het icoon bestaat alleen op macOS; elders opent een klik het venster', () => {
    const shell = createShell({ ...deps, platform: 'win32' });
    shell.updateTray(state());
    expect(FakeTray.instances[0].title).toBe('');
    FakeTray.instances[0].clicks[0]();
    expect(deps.showWindow).toHaveBeenCalled();
    const mac = createShell(deps);
    mac.updateTray(state());
    expect(FakeTray.instances[1].clicks).toHaveLength(0);
  });

  test('de sneltoets opent het venster en het snelle invoerveld', () => {
    const shell = createShell(deps);
    expect(shell.setShortcut('CommandOrControl+Alt+N')).toBe(true);
    fakeShortcuts.registered.get('CommandOrControl+Alt+N')!();
    expect(deps.showWindow).toHaveBeenCalled();
    expect(deps.sendMenu).toHaveBeenCalledWith('new');
  });

  test('een nieuwe sneltoets vervangt de oude; "" zet hem uit', () => {
    const shell = createShell(deps);
    shell.setShortcut('CommandOrControl+Alt+N');
    shell.setShortcut('CommandOrControl+Alt+M');
    expect([...fakeShortcuts.registered.keys()]).toEqual(['CommandOrControl+Alt+M']);
    expect(shell.setShortcut('')).toBe(true);
    expect(fakeShortcuts.registered.size).toBe(0);
  });

  test('een bezette of ongeldige combinatie geeft false, en de oude is dan al weg', () => {
    const shell = createShell(deps);
    shell.setShortcut('CommandOrControl+Alt+N');
    fakeShortcuts.taken.add('CommandOrControl+Alt+X');
    expect(shell.setShortcut('CommandOrControl+Alt+X')).toBe(false);
    expect(shell.setShortcut('N')).toBe(false);
    expect(shell.setShortcut(5)).toBe(false);
    expect(fakeShortcuts.registered.size).toBe(0);
  });

  test('dispose ruimt icoon en sneltoets op', () => {
    const shell = createShell(deps);
    shell.updateTray(state());
    shell.setShortcut('CommandOrControl+Alt+N');
    shell.dispose();
    expect(FakeTray.instances[0].destroyed).toBe(true);
    expect(fakeShortcuts.registered.size).toBe(0);
  });
});
