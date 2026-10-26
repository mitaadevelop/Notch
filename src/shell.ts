// De app in het systeem: een icoon in de menubalk met de eerstvolgende afspraken, en een globale sneltoets om overal
// een afspraak aan te maken. De pagina vertelt wat er getoond moet worden; main voert het uit.
import type { Menu, MenuItemConstructorOptions, NativeImage, Tray } from 'electron';
import type { TrayItem, TrayState } from './shared/types.ts';

const MAX_ITEMS = 8;
const MAX_TEXT = 200;

// Controleert wat de pagina stuurt; alles wat niet klopt wordt genegeerd (null).
export function parseTrayState(raw: unknown): TrayState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return null;
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
  const items: TrayItem[] = Array.isArray(r.items)
    ? r.items.slice(0, MAX_ITEMS).flatMap((i): TrayItem[] => {
        if (!i || typeof i !== 'object') return [];
        const item = i as Record<string, unknown>;
        return typeof item.label === 'string' && item.label
          ? [{ label: text(item.label), date: text(item.date), id: typeof item.id === 'string' ? item.id : null }]
          : [];
      })
    : [];
  return { enabled: r.enabled, title: text(r.title), tooltip: text(r.tooltip), items };
}

// Een sneltoets zoals Electron ze kent: modifiers + één toets, bijvoorbeeld "CommandOrControl+Alt+N".
const MODIFIERS = [
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
];
export function validAccelerator(accelerator: unknown): accelerator is string {
  if (typeof accelerator !== 'string' || accelerator.length > 60) return false;
  const parts = accelerator.split('+');
  if (parts.length < 2) return false; // een toets alleen zou elke toetsaanslag in het systeem afvangen
  const key = parts.at(-1)!;
  const mods = parts.slice(0, -1);
  return (
    mods.every((m) => MODIFIERS.includes(m)) &&
    new Set(mods).size === mods.length &&
    /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Plus|-|=|,|\.|\/|;|'|\[|\]|\\|`)$/.test(
      key,
    )
  );
}

export interface ShellDeps {
  Tray: new (image: NativeImage) => Tray;
  Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  createIcon(): NativeImage;
  globalShortcut: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
    isRegistered(accelerator: string): boolean;
  };
  platform: NodeJS.Platform;
  /** toont en focust het venster (opent het als het gesloten is) */
  showWindow(): void;
  /** stuurt een menu-opdracht naar de pagina ('new', ...) */
  sendMenu(name: string): void;
  /** opent een afspraak in de pagina */
  openItem(item: TrayItem): void;
  quit(): void;
}

export function createShell(deps: ShellDeps) {
  let tray: Tray | null = null;
  let registered: string | null = null;

  function menuFor(state: TrayState): Menu {
    const items: MenuItemConstructorOptions[] = [
      ...(state.items.length
        ? state.items.map((item): MenuItemConstructorOptions => ({
            label: item.label,
            click: () => deps.openItem(item),
          }))
        : [{ label: 'Geen afspraken de komende dagen', enabled: false }]),
      { type: 'separator' },
      {
        label: 'Nieuwe afspraak…',
        click: () => {
          deps.showWindow();
          deps.sendMenu('new');
        },
      },
      { label: 'Open Agenda', click: () => deps.showWindow() },
      { type: 'separator' },
      { label: 'Stop', click: () => deps.quit() },
    ];
    return deps.Menu.buildFromTemplate(items);
  }

  return {
    updateTray(state: TrayState) {
      if (!state.enabled) {
        tray?.destroy();
        tray = null;
        return;
      }
      if (!tray) {
        const icon = deps.createIcon();
        tray = new deps.Tray(icon);
        // op Windows en Linux opent een klik het venster; het menu staat achter de rechtermuisknop
        if (deps.platform !== 'darwin') tray.on('click', () => deps.showWindow());
      }
      tray.setToolTip(state.tooltip);
      // de tekst naast het icoon bestaat alleen op macOS
      if (deps.platform === 'darwin') tray.setTitle(state.title);
      tray.setContextMenu(menuFor(state));
    },

    /** Zet de globale sneltoets ('' = uit). Geeft false als de combinatie ongeldig of al in gebruik is. */
    setShortcut(accelerator: unknown): boolean {
      if (registered) {
        deps.globalShortcut.unregister(registered);
        registered = null;
      }
      if (accelerator === '') return true;
      if (!validAccelerator(accelerator)) return false;
      const ok = deps.globalShortcut.register(accelerator, () => {
        deps.showWindow();
        deps.sendMenu('new');
      });
      if (ok) registered = accelerator;
      return ok;
    },

    dispose() {
      tray?.destroy();
      tray = null;
      if (registered) deps.globalShortcut.unregister(registered);
      registered = null;
    },

    get hasTray() {
      return tray !== null;
    },
  };
}

export type Shell = ReturnType<typeof createShell>;
