// hulpmiddelen om de echte pagina (src/index.html) in jsdom te zetten en de modules vers te laden
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { AgendaApi } from '../../../src/shared/types.ts';

export function loadPage() {
  const html = readFileSync('src/index.html', 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

// een nep-versie van wat preload.ts aan de pagina geeft
function fakeAgenda() {
  return {
    platform: 'linux',
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    exportICS: vi.fn().mockResolvedValue(true),
    importICS: vi.fn().mockResolvedValue([]),
    notify: vi.fn(),
    setDockIcon: vi.fn(),
    nativeEdit: vi.fn(),
    menuState: vi.fn(),
    popupMenu: vi.fn().mockResolvedValue(null),
    fetchFeed: vi.fn().mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    connectAccount: vi.fn().mockResolvedValue({ accountId: 'acc', calendars: [] }),
    fetchAccountCalendar: vi.fn().mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    removeAccount: vi.fn().mockResolvedValue(undefined),
    onNotificationSnooze: vi.fn(),
    chatStatus: vi.fn().mockResolvedValue({
      hasKey: true,
      model: 'claude-opus-5-5',
      models: [
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (krachtigst)' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (sneller en voordeliger)' },
      ],
    }),
    chatSetKey: vi.fn(),
    chatClearKey: vi.fn(),
    chatSetModel: vi.fn(),
    chatSend: vi.fn().mockResolvedValue({ text: 'Klaar.', actions: [] }),
    chatReset: vi.fn().mockResolvedValue(undefined),
    geocode: vi.fn().mockResolvedValue({ city: 'Utrecht, Nederland', lat: 52.09, lon: 5.12 }),
    getForecast: vi.fn().mockResolvedValue([]),
    composeMail: vi.fn().mockResolvedValue(true),
    updateTray: vi.fn(),
    setShortcut: vi.fn().mockResolvedValue(true),
    listBackups: vi.fn().mockResolvedValue([]),
    restoreBackup: vi.fn().mockResolvedValue(true),
    getMcp: vi.fn().mockResolvedValue({
      config: { allowWrite: true, shareNotes: true, shareInvitees: true },
      command: '/app/Agenda',
      args: ['/app/dist/mcp.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: '/data' },
      claudeDesktopConfig: '/home/claude_desktop_config.json',
      running: true,
    }),
    setMcp: vi.fn(),
    installMcpForClaude: vi.fn().mockResolvedValue({ installed: true, path: '/home/claude_desktop_config.json' }),
    onMcpCall: vi.fn(),
    mcpReply: vi.fn(),
    mcpReady: vi.fn(),
    getUpdateState: vi.fn().mockResolvedValue({ status: 'idle', currentVersion: '0.1.0' }),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn(),
    onMenu: vi.fn(),
    onNotificationOpen: vi.fn(),
  };
}

export function installAgenda(overrides: Partial<ReturnType<typeof fakeAgenda>> = {}) {
  const agenda = { ...fakeAgenda(), ...overrides };
  window.agenda = agenda as unknown as AgendaApi;
  return agenda;
}

// laadt de modules opnieuw, zodat state, undo-stapels en dialoog-elementen schoon beginnen
export async function freshModules() {
  vi.resetModules();
  const state = await import('../../../src/js/state.ts');
  const store = await import('../../../src/js/store.ts');
  state.hooks.render = vi.fn();
  return { state, store };
}
