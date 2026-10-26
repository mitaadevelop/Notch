import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures.ts';

test.describe('beveiliging van het venster', () => {
  test('webPreferences: contextIsolation aan, nodeIntegration uit, sandbox aan', async ({ electronApp }) => {
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((win) => {
        // getLastWebPreferences ontbreekt in de Electron-typings maar bestaat wel
        const prefs = (
          win.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
        ).getLastWebPreferences();
        return {
          contextIsolation: prefs.contextIsolation,
          nodeIntegration: prefs.nodeIntegration,
          sandbox: prefs.sandbox,
          webSecurity: prefs.webSecurity,
          nodeIntegrationInSubFrames: prefs.nodeIntegrationInSubFrames,
        };
      }),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    expect(windows[0].webSecurity).not.toBe(false);
    expect(windows[0].nodeIntegrationInSubFrames).not.toBe(true);
  });

  test('de pagina heeft geen require, process of module', async ({ mainWindow }) => {
    const types = await mainWindow.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>).require,
      process: typeof (globalThis as Record<string, unknown>).process,
      module: typeof (globalThis as Record<string, unknown>).module,
      Buffer: typeof (globalThis as Record<string, unknown>).Buffer,
    }));
    expect(types).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', Buffer: 'undefined' });
  });

  test('de preload stelt alleen agenda en versions bloot, zonder ruwe IPC', async ({ mainWindow }) => {
    const exposed = await mainWindow.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        agenda: Object.keys(w.agenda as object).sort(),
        versions: Object.keys(w.versions as object).sort(),
        ipcRenderer: typeof w.ipcRenderer,
        electron: typeof w.electron,
      };
    });
    expect(exposed.agenda).toEqual(
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
    expect(exposed.versions).toEqual(['chrome', 'electron', 'node']);
    expect(exposed.ipcRenderer).toBe('undefined');
    expect(exposed.electron).toBe('undefined');
  });

  test('de CSP blokkeert inline scripts en staat geen unsafe-inline of unsafe-eval toe', async ({ mainWindow }) => {
    const csp = await mainWindow.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    // een ingevoegd inline-script mag niet draaien (eval via Playwright zou de CSP omzeilen, dit niet)
    const ran = await mainWindow.evaluate(async () => {
      const violation = new Promise<boolean>((resolve) => {
        document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 1000);
      });
      const script = document.createElement('script');
      script.textContent = 'window.__inline = true';
      document.head.append(script);
      return { executed: Boolean((window as unknown as { __inline?: boolean }).__inline), violation: await violation };
    });
    expect(ran).toEqual({ executed: false, violation: true });
  });
});

// Een lokale server als "externe" site, zodat de test geen internet nodig heeft.
async function withExternalSite<T>(run: (url: string) => Promise<T>): Promise<T> {
  const server = createServer((_req, res) => res.end('<title>extern</title>'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  } finally {
    server.close();
  }
}

test.describe("externe URL's", () => {
  // BEVINDING: main.ts heeft geen setWindowOpenHandler en geen will-navigate-afhandeling. Deze tests beschrijven het
  // gewenste gedrag en staan als test.fail() omdat het nu niet zo is; ze gaan "onverwacht slagen" zodra het gerepareerd is.
  test.fail('window.open opent geen extra venster in de app', async ({ mainWindow, electronApp }) => {
    await withExternalSite(async (url) => {
      await mainWindow.evaluate((target) => void window.open(target), url);
      await mainWindow.waitForTimeout(500);
      const count = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      expect(count).toBe(1);
    });
  });

  test.fail('navigeren naar een externe URL wordt geblokkeerd', async ({ mainWindow, electronApp }) => {
    await withExternalSite(async (url) => {
      await mainWindow.evaluate((target) => void (location.href = target), url).catch(() => {});
      await mainWindow.waitForTimeout(500);
      const current = await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getURL(),
      );
      expect(current).toMatch(/^file:/);
    });
  });
});
