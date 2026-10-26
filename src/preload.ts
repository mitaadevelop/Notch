import { contextBridge, ipcRenderer } from 'electron';
import type { AgendaApi } from './shared/types.ts';

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});

const agenda: AgendaApi = {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  exportICS: (text, name) => ipcRenderer.invoke('ics:export', { text, name }),
  importICS: () => ipcRenderer.invoke('ics:import'),
  notify: (payload) => ipcRenderer.send('notify', payload),
  setDockIcon: (dataUrl) => ipcRenderer.send('dock-icon', dataUrl),
  nativeEdit: (command) => ipcRenderer.send('native-edit', command),
  menuState: (state) => ipcRenderer.send('menu-state', state),
  popupMenu: (items) => ipcRenderer.invoke('popup-menu', items),
  fetchFeed: (url) => ipcRenderer.invoke('feed:fetch', url),
  connectAccount: (request) => ipcRenderer.invoke('account:connect', request),
  fetchAccountCalendar: (accountId, calendarUrl) => ipcRenderer.invoke('account:fetch', { accountId, calendarUrl }),
  removeAccount: (accountId) => ipcRenderer.invoke('account:remove', accountId),
  chatStatus: () => ipcRenderer.invoke('chat:status'),
  chatSetKey: (key) => ipcRenderer.invoke('chat:set-key', key),
  chatClearKey: () => ipcRenderer.invoke('chat:clear-key'),
  chatSetModel: (id) => ipcRenderer.invoke('chat:set-model', id),
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  geocode: (name) => ipcRenderer.invoke('weather:geocode', name),
  getForecast: (lat, lon) => ipcRenderer.invoke('weather:forecast', { lat, lon }),
  composeMail: (draft) => ipcRenderer.invoke('mail:compose', draft),
  updateTray: (state) => ipcRenderer.send('tray:update', state),
  setShortcut: (accelerator) => ipcRenderer.invoke('shortcut:set', accelerator),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (name) => ipcRenderer.invoke('backups:restore', name),
  getMcp: () => ipcRenderer.invoke('mcp:get'),
  setMcp: (config) => ipcRenderer.invoke('mcp:set', config),
  installMcpForClaude: () => ipcRenderer.invoke('mcp:install'),
  onMcpCall: (callback) => ipcRenderer.on('mcp:call', (_event, call) => callback(call)),
  mcpReply: (id, reply) => ipcRenderer.send('mcp:reply', { id, reply }),
  mcpReady: () => ipcRenderer.send('mcp:ready'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => ipcRenderer.on('update:state', (_event, state) => callback(state)),
  onMenu: (callback) => ipcRenderer.on('menu', (_event, name) => callback(name)),
  onNotificationSnooze: (callback) =>
    ipcRenderer.on('notify-snooze', (_event, payload, minutes) => callback(payload, minutes)),
  onNotificationOpen: (callback) => ipcRenderer.on('notify-open', (_event, payload) => callback(payload)),
};

contextBridge.exposeInMainWorld('agenda', agenda);
