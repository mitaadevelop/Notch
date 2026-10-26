// gedeelde nep-`electron` voor de main-process tests: legt vast wat main.ts registreert en aanmaakt
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

export interface MenuTemplateItem {
  label?: string;
  type?: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuTemplateItem[];
}

export const electronState = {
  userData: '',
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  windows: [] as FakeWindow[],
  menuTemplates: [] as MenuTemplateItem[][],
  popups: [] as { template: MenuTemplateItem[]; options: { callback?: () => void } }[],
  notifications: [] as FakeNotification[],
  weekNumbersItem: { checked: false },
  ready: [] as (() => void)[],
};

export class FakeWebContents {
  send = vi.fn();
  undo = vi.fn();
  redo = vi.fn();
  cut = vi.fn();
  copy = vi.fn();
  paste = vi.fn();
  selectAll = vi.fn();
}

export class FakeWindow {
  static getAllWindows = () => electronState.windows;
  webContents = new FakeWebContents();
  loadFile = vi.fn();
  show = vi.fn();
  focus = vi.fn();
  isMinimized = vi.fn(() => false);
  restore = vi.fn();
  private closed: (() => void) | null = null;
  constructor(public options: Record<string, unknown>) {
    electronState.windows.push(this);
  }
  on(event: string, callback: () => void) {
    if (event === 'closed') this.closed = callback;
  }
  emitClosed() {
    this.closed?.();
  }
}

export class FakeNotification {
  static isSupported = vi.fn(() => true);
  show = vi.fn();
  private click: (() => void) | null = null;
  private action: (() => void) | null = null;
  constructor(public options: { title: string; body: string; actions?: { type: string; text: string }[] }) {
    electronState.notifications.push(this);
  }
  on(event: string, callback: () => void) {
    if (event === 'click') this.click = callback;
    if (event === 'action') this.action = callback;
  }
  emitAction() {
    this.action?.();
  }
  emitClick() {
    this.click?.();
  }
}

// versleuteling "voor de grap": base64 van omgekeerde tekst, zodat tests kunnen zien dat het wachtwoord niet leesbaar op schijf staat
export const safeStorage = {
  available: true,
  isEncryptionAvailable: () => safeStorage.available,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (text: string) => Buffer.from([...text].reverse().join('')),
  decryptString: (data: Buffer) => [...data.toString()].reverse().join(''),
};

export class FakeTray {
  static instances: FakeTray[] = [];
  destroyed = false;
  title = '';
  tooltip = '';
  menu: unknown = null;
  clicks: (() => void)[] = [];
  constructor(public image: unknown) {
    FakeTray.instances.push(this);
  }
  setTitle(title: string) {
    this.title = title;
  }
  setToolTip(tooltip: string) {
    this.tooltip = tooltip;
  }
  setContextMenu(menu: unknown) {
    this.menu = menu;
  }
  on(event: string, callback: () => void) {
    if (event === 'click') this.clicks.push(callback);
  }
  destroy() {
    this.destroyed = true;
  }
}

export const fakeShortcuts = {
  registered: new Map<string, () => void>(),
  /** combinaties die "al in gebruik" zijn */
  taken: new Set<string>(),
  register: vi.fn((accelerator: string, callback: () => void) => {
    if (fakeShortcuts.taken.has(accelerator)) return false;
    fakeShortcuts.registered.set(accelerator, callback);
    return true;
  }),
  unregister: vi.fn((accelerator: string) => void fakeShortcuts.registered.delete(accelerator)),
  isRegistered: (accelerator: string) => fakeShortcuts.registered.has(accelerator),
  unregisterAll: vi.fn(() => fakeShortcuts.registered.clear()),
};

export const dialog = { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() };

export const electronMock = {
  app: {
    name: 'Agenda',
    isPackaged: false,
    getVersion: () => '0.1.0',
    getAppPath: () => '/app',
    getPath: () => electronState.userData,
    // main.ts registreert alles in whenReady().then(...); hier meteen "klaar"
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    quit: vi.fn(),
    dock: { setIcon: vi.fn() },
  },
  BrowserWindow: FakeWindow,
  Notification: FakeNotification,
  nativeImage: {
    createFromDataURL: vi.fn((url: string) => ({ url })),
    createEmpty: () => ({ addRepresentation: vi.fn(), setTemplateImage: vi.fn() }),
  },
  Tray: FakeTray,
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  globalShortcut: fakeShortcuts,
  dialog,
  safeStorage,
  ipcMain: {
    handle: (channel: string, handler: Handler) => electronState.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => electronState.listeners.set(channel, handler),
  },
  Menu: {
    setApplicationMenu: vi.fn(),
    getApplicationMenu: () => ({ getMenuItemById: () => electronState.weekNumbersItem }),
    buildFromTemplate: (template: MenuTemplateItem[]) => {
      electronState.menuTemplates.push(template);
      return {
        popup: (options: { callback?: () => void }) => electronState.popups.push({ template, options }),
      };
    },
  },
};

// electron-updater: een nep-autoUpdater die niets over het netwerk doet
export const fakeUpdater = Object.assign(new EventEmitter(), {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowPrerelease: true,
  allowDowngrade: true,
  forceDevUpdateConfig: false,
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn().mockResolvedValue(null),
  quitAndInstall: vi.fn(),
});

export const updaterMock = { autoUpdater: fakeUpdater };
