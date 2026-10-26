// Voorkeuren voor het menubalk-icoon en de globale sneltoets, en het doorgeven van de eerstvolgende afspraken aan main
import { data } from './state.ts';
import * as store from './store.ts';
import { trayState } from './trayinfo.ts';
import { $ } from './util.ts';

const f = {
  tray: $<HTMLInputElement>('s-tray'),
  shortcut: $<HTMLInputElement>('s-shortcut'),
  clear: $<HTMLButtonElement>('s-shortcut-clear'),
  status: $('s-shortcut-status'),
};

const IDLE = 'Werkt ook als de app op de achtergrond staat.';

// toets -> naam zoals Electron die kent; null = geen bruikbare toets (alleen een modifier, of iets onbekends)
export function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) return e.key;
  const map: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
  };
  return map[e.key] ?? null;
}

// Maakt van een toetsaanslag een sneltoets ("CommandOrControl+Alt+N"); zonder modifier is het geen sneltoets.
export function acceleratorFrom(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
) {
  const key = keyName(e);
  if (!key) return null;
  const mods = [
    e.metaKey || e.ctrlKey ? 'CommandOrControl' : '',
    e.altKey ? 'Alt' : '',
    e.shiftKey ? 'Shift' : '',
  ].filter(Boolean);
  return mods.length ? [...mods, key].join('+') : null;
}

// leesbaar: "⌘⌥N" op macOS, "Ctrl+Alt+N" elders
export function shortcutLabel(accelerator: string, mac = window.agenda.platform === 'darwin') {
  if (!accelerator) return '';
  const names: Record<string, string> = mac
    ? { CommandOrControl: '⌘', Alt: '⌥', Shift: '⇧' }
    : { CommandOrControl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return accelerator
    .split('+')
    .map((p) => names[p] ?? p)
    .join(mac ? '' : '+');
}

// vertelt main wat er in de menubalk hoort te staan
let pushQueued = false;
export function pushTray(now = new Date()) {
  window.agenda.updateTray(trayState(data, now, data.settings.tray));
}
export function schedulePushTray() {
  if (pushQueued) return;
  pushQueued = true;
  setTimeout(() => {
    pushQueued = false;
    pushTray();
  }, 300);
}

let applied = '';
// registreert de sneltoets in main; meldt in de voorkeuren als dat niet lukt
export async function applyShortcut(accelerator: string, quiet = false) {
  const ok = await window.agenda.setShortcut(accelerator);
  applied = ok ? accelerator : '';
  if (!quiet) {
    f.status.textContent = ok
      ? IDLE
      : 'Deze combinatie kan niet worden gebruikt (al in gebruik door het systeem of een andere app).';
  }
  return ok;
}

export function showSystemSettings() {
  f.tray.checked = data.settings.tray;
  f.shortcut.value = shortcutLabel(data.settings.shortcut);
}

export function initSystem() {
  f.tray.addEventListener('change', () => {
    store.updateSettings({ tray: f.tray.checked });
    pushTray();
  });

  f.shortcut.addEventListener('keydown', async (e) => {
    if (e.key === 'Tab') return; // het toetsenbord moet het veld kunnen verlaten
    e.preventDefault();
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') return clear();
    const accelerator = acceleratorFrom(e);
    if (!accelerator) {
      f.status.textContent = 'Gebruik minstens één van ⌘/Ctrl, ⌥/Alt of ⇧, plus een letter, cijfer of toets.';
      return;
    }
    if (await applyShortcut(accelerator)) {
      store.updateSettings({ shortcut: accelerator });
      f.shortcut.value = shortcutLabel(accelerator);
    } else {
      f.shortcut.value = shortcutLabel(data.settings.shortcut);
      if (data.settings.shortcut) void applyShortcut(data.settings.shortcut, true); // de oude blijft werken
    }
  });

  async function clear() {
    await applyShortcut('');
    store.updateSettings({ shortcut: '' });
    f.shortcut.value = '';
  }
  f.clear.addEventListener('click', () => void clear());
}

// bij het opstarten: de bewaarde sneltoets en het menubalk-icoon weer activeren
export async function startSystem() {
  pushTray();
  if (data.settings.shortcut) await applyShortcut(data.settings.shortcut);
}

export const currentShortcut = () => applied;
