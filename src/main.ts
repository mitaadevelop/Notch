import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  shell as electronShell,
} from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { connect, fetchAccountEvents, removeAccount } from './accounts.ts';
import Anthropic from '@anthropic-ai/sdk';
import { createBackups } from './backups.ts';
import { createChat, describeError } from './chat/engine.ts';
import type { Chat } from './chat/engine.ts';
import { createKeyStore } from './chat/keystore.ts';
import { CHAT_MODELS } from './chat/models.ts';
import { listApiTools } from './chat/tools.ts';
import { mailtoUrl } from './mail.ts';
import { fetchForecast, FORECAST_BASE, GEO_BASE, geocode } from './weather.ts';
import { createShell, parseTrayState } from './shell.ts';
import type { Shell } from './shell.ts';
import { trayIconPng } from './trayicon.ts';
import { fetchFeed } from './net.ts';
import type { AccountRequest, McpConfig, MenuItemSpec, NativeEditCommand, NotifyPayload } from './shared/types.ts';
import { createMcpHost } from './mcp/host.ts';
import type { McpHost } from './mcp/host.ts';
import { createUpdateManager } from './updater.ts';
import type { UpdateManager, UpdaterLike } from './updater.ts';

const dataFile = () => path.join(app.getPath('userData'), 'events.json');

async function loadData(): Promise<object | null> {
  try {
    const data = JSON.parse(await fs.readFile(dataFile(), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    // bestand ontbreekt of is kapot: de renderer begint met een lege agenda
    return null;
  }
}

// Opslaan gaat één voor één: twee schrijfacties vlak na elkaar (bijv. een wijziging en een synchronisatie) zouden
// anders in hetzelfde tijdelijke bestand schrijven en events.json kunnen beschadigen. De laatste opdracht wint.
let saveQueue: Promise<void> = Promise.resolve();

const backups = () => createBackups({ file: dataFile(), dir: path.join(app.getPath('userData'), 'backups') });

async function writeData(json: string) {
  const file = dataFile();
  await backups().maybeBackup(); // de vorige stand bewaren voordat hij wordt overschreven
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  // eerst naar een tijdelijk bestand, zodat een crash events.json niet corrumpeert
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, file);
}

function saveData(data: unknown) {
  if (!data || typeof data !== 'object') return Promise.reject(new Error('data moet een object of array zijn'));
  const json = JSON.stringify(data, null, 2);
  const result = saveQueue.then(() => writeData(json));
  saveQueue = result.catch(() => {}); // een mislukte opdracht houdt de wachtrij niet tegen
  return result;
}

let win: BrowserWindow | null = null;
// hoe lang "Uitstellen" in een melding van het systeem duurt
const SNOOZE_MINUTES = 10;

const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args);
const action = (name: string) => () => send('menu', name);

function buildMenu() {
  const item = (
    label: string,
    accelerator: string | undefined,
    name: string,
    extra: MenuItemConstructorOptions = {},
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: action(name),
    ...extra,
  });
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Over deze app' },
        item('Zoek naar updates…', undefined, 'check-updates'),
        { type: 'separator' },
        item('Voorkeuren…', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        { role: 'hide', label: 'Verberg' },
        { role: 'hideOthers', label: 'Verberg andere' },
        { role: 'unhide', label: 'Toon alles' },
        { type: 'separator' },
        { role: 'quit', label: 'Stop' },
      ],
    },
    {
      label: 'Bestand',
      submenu: [
        item('Nieuwe afspraak', 'CmdOrCtrl+N', 'new'),
        item('Nieuwe agenda…', 'Alt+CmdOrCtrl+N', 'new-calendar'),
        { type: 'separator' },
        item('Agenda-account of link toevoegen…', undefined, 'add-source'),
        item('Vernieuw externe agenda’s', 'CmdOrCtrl+R', 'sync'),
        { type: 'separator' },
        item('Importeer…', undefined, 'import'),
        item('Exporteer alles…', undefined, 'export'),
        { type: 'separator' },
        { role: 'close', label: 'Sluit venster' },
      ],
    },
    {
      label: 'Bewerken',
      submenu: [
        item('Ongedaan maken', 'CmdOrCtrl+Z', 'undo'),
        item('Opnieuw', 'Shift+CmdOrCtrl+Z', 'redo'),
        { type: 'separator' },
        item('Knip', 'CmdOrCtrl+X', 'cut'),
        item('Kopieer', 'CmdOrCtrl+C', 'copy'),
        item('Plak', 'CmdOrCtrl+V', 'paste'),
        item('Dupliceer', 'CmdOrCtrl+D', 'duplicate'),
        item('Selecteer alles', 'CmdOrCtrl+A', 'select-all'),
        { type: 'separator' },
        item('Zoek', 'CmdOrCtrl+F', 'search'),
        item('Commandopalet…', 'CmdOrCtrl+K', 'palette'),
      ],
    },
    {
      label: 'Weergave',
      submenu: [
        item('Dag', 'CmdOrCtrl+1', 'view:day'),
        item('Week', 'CmdOrCtrl+2', 'view:week'),
        item('Maand', 'CmdOrCtrl+3', 'view:month'),
        item('Jaar', 'CmdOrCtrl+4', 'view:year'),
        item('Lijst', 'CmdOrCtrl+5', 'view:list'),
        { type: 'separator' },
        item('Ga naar vandaag', 'CmdOrCtrl+T', 'today'),
        item('Vorige', 'CmdOrCtrl+Left', 'prev'),
        item('Volgende', 'CmdOrCtrl+Right', 'next'),
        { type: 'separator' },
        item('Uren groter', 'CmdOrCtrl+Plus', 'zoom-in'),
        item('Uren kleiner', 'CmdOrCtrl+-', 'zoom-out'),
        item('Standaard uurhoogte', 'CmdOrCtrl+0', 'zoom-reset'),
        { type: 'separator' },
        item('Toon weeknummers', undefined, 'toggle-weeknumbers', { id: 'weeknumbers', type: 'checkbox' }),
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Ontwikkelaarstools' },
        { role: 'togglefullscreen', label: 'Volledig scherm' },
      ],
    },
    { role: 'windowMenu', label: 'Venster' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Voor geautomatiseerde tests: het venster blijft verborgen en pakt nooit de focus, zodat je gewoon verder kunt werken.
// Alleen in een ontwikkelversie (nooit in een verpakte app) en alleen als de testrunner erom vraagt.
const background = !app.isPackaged && process.env.AGENDA_BACKGROUND === '1';

// toont het venster; op de achtergrond zonder de focus over te nemen
function reveal(w: BrowserWindow) {
  if (w.isMinimized()) w.restore();
  if (background) {
    w.showInactive();
  } else {
    w.show();
    w.focus();
  }
}

function createWindow() {
  win = new BrowserWindow({
    show: !background,
    width: 1180,
    height: 780,
    minWidth: 1000,
    minHeight: 600,
    // Apple-look op macOS: geen titelbalk, stoplichtknoppen in de zijbalk, doorschijnende zijbalk
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      backgroundColor: '#00000000',
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // een verborgen venster mag zijn animaties en timers niet pauzeren
      backgroundThrottling: !background,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  mcp?.windowCreated();
  win.on('closed', () => {
    win = null;
    mcp?.windowClosed();
  });
  return win;
}

const isTrustedSender = (event: IpcMainEvent | IpcMainInvokeEvent) => win !== null && event.sender === win.webContents;

// standaard bewerkacties voor tekstvelden
const NATIVE_COMMANDS: NativeEditCommand[] = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

// Updates: alleen een verpakte app kan zichzelf bijwerken. Het updateadres komt uit de build-configuratie
// (package.json → build.publish) en nooit van de pagina. In een ontwikkelversie kan AGENDA_UPDATE_FEED een
// testserver aanwijzen; in een verpakte app wordt die variabele genegeerd.
let updates: UpdateManager;

// menubalk-icoon en globale sneltoets
let shell: Shell | undefined;

function setupShell() {
  const showWindow = () => {
    reveal(win ?? createWindow());
  };
  shell = createShell({
    Tray,
    Menu,
    createIcon: () => {
      const icon = nativeImage.createEmpty();
      icon.addRepresentation({ scaleFactor: 1, buffer: trayIconPng(16) });
      icon.addRepresentation({ scaleFactor: 2, buffer: trayIconPng(32) });
      icon.setTemplateImage(true);
      return icon;
    },
    globalShortcut,
    platform: process.platform,
    showWindow,
    sendMenu: (name) => send('menu', name),
    openItem: (item) => {
      showWindow();
      send('notify-open', { id: item.id, date: item.date });
    },
    quit: () => app.quit(),
  });
}

// De chat in de app, met de eigen API-sleutel van de gebruiker. De sleutel blijft in main (versleuteld bewaard).
const keyStore = () =>
  createKeyStore(app.getPath('userData'), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    weak: () => process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text',
    encryptString: (text) => safeStorage.encryptString(text),
    decryptString: (data) => safeStorage.decryptString(data),
  });

let chat: Chat | undefined;
let chatTools: Awaited<ReturnType<typeof listApiTools>> | undefined;
let chatClient: { key: string; client: Anthropic } | undefined;

async function chatStatus() {
  const store = keyStore();
  return {
    hasKey: await store.hasKey(),
    model: await store.getModel(),
    models: CHAT_MODELS.map(({ id, label }) => ({ id, label })),
  };
}

// in een ontwikkelversie kan een testserver de API vervangen; verpakt wordt dat genegeerd
const anthropicBase = () => (!app.isPackaged && process.env.AGENDA_ANTHROPIC_BASE_URL) || undefined;

async function chatSend(text: string) {
  const store = keyStore();
  const key = await store.getKey();
  if (!key) throw new Error('Voeg eerst je API-sleutel toe.');
  if (!mcp) throw new Error('De koppeling met de agenda is nog niet klaar.');
  const host = mcp;
  if (!chatClient || chatClient.key !== key) {
    chatClient = { key, client: new Anthropic({ apiKey: key, timeout: 120_000, baseURL: anthropicBase() }) };
  }
  const { client } = chatClient;
  chatTools ??= await listApiTools();
  chat ??= createChat({
    create: (params) => client.beta.messages.create(params),
    model: () => store.getModel(),
    tools: chatTools,
    run: (tool, args) => host.run(tool, args),
  });
  try {
    return await chat.send(text);
  } catch (error) {
    // een fout van Anthropic wordt een leesbare melding; eigen meldingen blijven zoals ze zijn
    throw new Error(describeError(error, Anthropic), { cause: error });
  }
}

// Claude (MCP): de server die Claude start praat via een lokale socket met deze app
let mcp: McpHost | undefined;

function setupMcp() {
  mcp = createMcpHost({
    userDataDir: app.getPath('userData'),
    command: process.execPath,
    scriptPath: path.join(app.getAppPath(), 'dist', 'mcp.js'),
    getWindow: () => win,
    openWindow: () => createWindow(),
  });
  // een socket die niet wil starten (bijv. een te lang pad) mag de agenda zelf niet in de weg zitten
  mcp.start().catch((error) => console.error('MCP-server voor Claude kon niet starten:', error));
}

function setupUpdates() {
  const feed = app.isPackaged ? undefined : process.env.AGENDA_UPDATE_FEED;
  if (feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    autoUpdater.forceDevUpdateConfig = true;
  }
  updates = createUpdateManager({
    updater: autoUpdater as unknown as UpdaterLike,
    currentVersion: app.getVersion(),
    supported: app.isPackaged || Boolean(feed),
    send: (state) => send('update:state', state),
  });
  if (app.isPackaged) updates.startAutoCheck();
}

function registerIpc() {
  ipcMain.handle('data:load', loadData);
  ipcMain.handle('data:save', (event, data) => {
    if (!isTrustedSender(event)) return;
    return saveData(data);
  });

  // het weer; in een ontwikkelversie kunnen testservers de diensten vervangen (verpakt wordt dat genegeerd)
  const geoBase = (!app.isPackaged && process.env.AGENDA_WEATHER_GEO) || GEO_BASE;
  const forecastBase = (!app.isPackaged && process.env.AGENDA_WEATHER_API) || FORECAST_BASE;
  ipcMain.handle('chat:status', (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    return chatStatus();
  });
  ipcMain.handle('chat:set-key', async (event, key: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    await keyStore().setKey(key);
    chat = undefined; // een nieuw gesprek met de nieuwe sleutel
    return chatStatus();
  });
  ipcMain.handle('chat:clear-key', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    await keyStore().clearKey();
    chat = undefined;
    chatClient = undefined;
    return chatStatus();
  });
  ipcMain.handle('chat:set-model', async (event, id: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    await keyStore().setModel(id);
    return chatStatus();
  });
  ipcMain.handle('chat:send', (event, text: unknown) => {
    if (!isTrustedSender(event) || typeof text !== 'string') throw new Error('Niet toegestaan.');
    return chatSend(text);
  });
  ipcMain.handle('chat:reset', (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    chat?.reset();
  });

  ipcMain.handle('weather:geocode', (event, name: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    return geocode(name, geoBase);
  });
  ipcMain.handle('weather:forecast', (event, where: { lat?: unknown; lon?: unknown } | null) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    return fetchForecast(where?.lat, where?.lon, forecastBase);
  });

  ipcMain.handle('mail:compose', async (event, draft: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    const url = mailtoUrl(draft);
    if (!url) return false;
    await electronShell.openExternal(url);
    return true;
  });

  ipcMain.on('tray:update', (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const state = parseTrayState(raw);
    if (state) shell?.updateTray(state);
  });
  ipcMain.handle('shortcut:set', (event, accelerator: unknown) => {
    if (!isTrustedSender(event) || !shell) throw new Error('Niet toegestaan.');
    return shell.setShortcut(accelerator);
  });

  ipcMain.handle('backups:list', (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    return backups().list();
  });
  ipcMain.handle('backups:restore', async (event, name: unknown) => {
    if (!isTrustedSender(event) || typeof name !== 'string') throw new Error('Niet toegestaan.');
    const text = await backups().read(name);
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Herstel', 'Annuleer'],
      defaultId: 1,
      cancelId: 1,
      message: 'Deze back-up terugzetten?',
      detail: 'Je huidige agenda wordt eerst als back-up bewaard, dus je kunt dit later weer terugdraaien.',
    });
    if (response !== 0) return false;
    // via dezelfde wachtrij als gewoon opslaan, zodat er geen schrijfactie tussendoor komt
    const result = saveQueue.then(async () => {
      await backups().snapshotBeforeRestore();
      await fs.writeFile(`${dataFile()}.tmp`, text);
      await fs.rename(`${dataFile()}.tmp`, dataFile());
    });
    saveQueue = result.catch(() => {});
    await result;
    return true;
  });

  ipcMain.handle('ics:export', async (event, { text, name }: { text: unknown; name?: unknown }) => {
    if (!isTrustedSender(event) || typeof text !== 'string') return false;
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: `${String(name || 'agenda').replace(/[\\/:*?"<>|]/g, '-')}.ics`,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (canceled || !filePath) return false;
    await fs.writeFile(filePath, text);
    return true;
  });

  ipcMain.handle('ics:import', async (event) => {
    if (!isTrustedSender(event)) return [];
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (canceled) return [];
    return Promise.all(
      filePaths.map(async (file) => ({
        name: path.basename(file, path.extname(file)),
        text: await fs.readFile(file, 'utf8'),
      })),
    );
  });

  ipcMain.on('notify', (event, { title, body, id, date }: NotifyPayload) => {
    if (!isTrustedSender(event) || !Notification.isSupported()) return;
    const notification = new Notification({
      title: String(title),
      body: String(body ?? ''),
      // knoppen in de melding bestaan alleen op macOS
      actions: process.platform === 'darwin' ? [{ type: 'button', text: `Over ${SNOOZE_MINUTES} min` }] : [],
    });
    notification.on('action', () => {
      send('notify-snooze', { title: String(title), body: String(body ?? ''), id, date }, SNOOZE_MINUTES);
    });
    notification.on('click', () => {
      if (win) reveal(win);
      send('notify-open', { id, date });
    });
    notification.show();
  });

  ipcMain.on('dock-icon', (event, dataUrl: unknown) => {
    if (!isTrustedSender(event) || !app.dock || typeof dataUrl !== 'string') return;
    app.dock.setIcon(nativeImage.createFromDataURL(dataUrl));
  });

  // de menu-sneltoetsen vangen die anders af
  ipcMain.on('native-edit', (event, command: NativeEditCommand) => {
    if (!isTrustedSender(event)) return;
    if (NATIVE_COMMANDS.includes(command)) event.sender[command]();
  });

  ipcMain.on('menu-state', (event, state?: { weekNumbers?: boolean }) => {
    if (!isTrustedSender(event)) return;
    const item = Menu.getApplicationMenu()?.getMenuItemById('weeknumbers');
    if (item) item.checked = Boolean(state?.weekNumbers);
  });

  // contextmenu van de pagina als native menu; geeft het gekozen id terug
  // externe agenda's: het netwerk loopt via main; wachtwoorden verlaten main nooit
  ipcMain.handle('feed:fetch', (event, url: unknown) => {
    if (!isTrustedSender(event) || typeof url !== 'string') throw new Error('Niet toegestaan.');
    return fetchFeed(url);
  });

  ipcMain.handle('account:connect', (event, request: AccountRequest) => {
    if (!isTrustedSender(event) || !request || typeof request !== 'object') throw new Error('Niet toegestaan.');
    return connect(request);
  });

  ipcMain.handle('account:fetch', (event, args: { accountId: unknown; calendarUrl: unknown }) => {
    if (!isTrustedSender(event) || typeof args?.accountId !== 'string' || typeof args.calendarUrl !== 'string') {
      throw new Error('Niet toegestaan.');
    }
    return fetchAccountEvents(args.accountId, args.calendarUrl);
  });

  ipcMain.handle('account:remove', (event, accountId: unknown) => {
    if (!isTrustedSender(event) || typeof accountId !== 'string') throw new Error('Niet toegestaan.');
    return removeAccount(accountId);
  });

  ipcMain.handle('update:state', (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    return updates.state();
  });
  ipcMain.handle('update:check', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    await updates.check(true);
  });
  ipcMain.handle('update:download', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    await updates.download();
  });
  ipcMain.handle('update:install', (event) => {
    if (!isTrustedSender(event)) throw new Error('Niet toegestaan.');
    updates.install();
  });

  ipcMain.handle('mcp:get', (event) => {
    if (!isTrustedSender(event) || !mcp) throw new Error('Niet toegestaan.');
    return mcp.status();
  });
  ipcMain.handle('mcp:set', (event, patch: Partial<McpConfig>) => {
    if (!isTrustedSender(event) || !mcp || !patch || typeof patch !== 'object') throw new Error('Niet toegestaan.');
    return mcp.setConfig(patch);
  });
  ipcMain.handle('mcp:install', async (event) => {
    if (!isTrustedSender(event) || !mcp) throw new Error('Niet toegestaan.');
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Toevoegen', 'Annuleer'],
      defaultId: 0,
      cancelId: 1,
      message: 'Agenda toevoegen aan Claude Desktop?',
      detail: `Dit schrijft de Agenda-server in ${(await mcp.status()).claudeDesktopConfig}. Een bestaand bestand wordt eerst gekopieerd en de rest ervan blijft ongemoeid. Start Claude Desktop daarna opnieuw op.`,
    });
    if (response !== 0) return { installed: false, path: (await mcp.status()).claudeDesktopConfig };
    return mcp.installForClaude();
  });
  ipcMain.on('mcp:ready', (event) => {
    if (isTrustedSender(event)) mcp?.markReady();
  });
  ipcMain.on(
    'mcp:reply',
    (event, message: { id: number; reply: { ok: true; result: unknown } | { ok: false; error: string } }) => {
      if (isTrustedSender(event) && typeof message?.id === 'number') mcp?.reply(message.id, message.reply);
    },
  );

  ipcMain.handle('popup-menu', (event, items: MenuItemSpec[]) => {
    if (!isTrustedSender(event) || !Array.isArray(items)) return null;
    return new Promise<string | null>((resolve) => {
      const template = items.map((entry): MenuItemConstructorOptions =>
        entry.separator
          ? { type: 'separator' }
          : { label: String(entry.label), enabled: entry.enabled !== false, click: () => resolve(entry.id ?? null) },
      );
      Menu.buildFromTemplate(template).popup({ window: win!, callback: () => resolve(null) });
    });
  });
}

app.whenReady().then(() => {
  if (background) app.dock?.hide();
  setupUpdates();
  setupMcp();
  setupShell();
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  shell?.dispose();
  void mcp?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
