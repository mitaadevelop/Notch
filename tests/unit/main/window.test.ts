import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { electronMock, updaterMock, electronState } from './electron-mock.ts';

vi.mock('electron', () => electronMock);
vi.mock('electron-updater', () => updaterMock);
// de echte socket voor Claude heeft zijn eigen tests (mcp-appserver); hier zou hij alleen tijdelijke mappen bijhouden
vi.mock('../../../src/mcp/appserver.ts', () => ({
  startAppServer: vi.fn().mockResolvedValue({ socketPath: '/nep.sock', close: vi.fn().mockResolvedValue(undefined) }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  electronState.userData = mkdtempSync(path.join(tmpdir(), 'agenda-test-'));
  electronState.windows.length = 0;
  electronState.menuTemplates.length = 0;
  vi.resetModules();
  await import('../../../src/main.ts');
  await flush();
});

describe('venster', () => {
  test('maakt één venster dat dist/index.html laadt', () => {
    expect(electronState.windows).toHaveLength(1);
    expect(electronState.windows[0].loadFile).toHaveBeenCalledWith(expect.stringMatching(/index\.html$/));
  });

  test('webPreferences: contextIsolation aan, nodeIntegration uit, preload ingesteld', () => {
    const prefs = electronState.windows[0].options.webPreferences as Record<string, unknown>;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.preload).toMatch(/preload\.js$/);
    // sandbox wordt niet uitgezet (in Electron is die standaard aan zolang het niet expliciet false is)
    expect(prefs.sandbox).not.toBe(false);
    expect(prefs.webSecurity).not.toBe(false);
    expect(prefs.nodeIntegrationInWorker).not.toBe(true);
  });

  test("bouwt de menubalk met de verwachte menu's en sneltoetsen", () => {
    const template = electronState.menuTemplates[0] as {
      label?: string;
      role?: string;
      submenu?: { label?: string; accelerator?: string }[];
    }[];
    expect(template.map((m) => m.label)).toEqual(['Agenda', 'Bestand', 'Bewerken', 'Weergave', 'Venster']);
    const labels = (name: string) =>
      template.find((m) => m.label === name)?.submenu?.map((i) => i.accelerator ?? i.label);
    expect(labels('Bestand')).toContain('CmdOrCtrl+N');
    expect(labels('Bewerken')).toEqual(expect.arrayContaining(['CmdOrCtrl+Z', 'CmdOrCtrl+F', 'CmdOrCtrl+D']));
    expect(labels('Weergave')).toEqual(expect.arrayContaining(['CmdOrCtrl+1', 'CmdOrCtrl+5', 'CmdOrCtrl+T']));
  });

  test('een menu-item stuurt zijn naam naar de pagina', () => {
    const template = electronState.menuTemplates[0] as { submenu?: { label?: string; click?: () => void }[] }[];
    const nieuw = template[1].submenu?.find((i) => i.label === 'Nieuwe afspraak');
    nieuw?.click?.();
    expect(electronState.windows[0].webContents.send).toHaveBeenCalledWith('menu', 'new');
  });
});
