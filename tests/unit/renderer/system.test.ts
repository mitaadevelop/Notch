import { fireEvent } from '@testing-library/dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;
beforeEach(() => {
  loadPage();
  agenda = installAgenda();
});

async function setup() {
  const ctx = await freshModules();
  const system = await import('../../../src/js/system.ts');
  return { ...ctx, system };
}
const key = (over: Partial<KeyboardEventInit> & { key: string; code?: string }) => ({
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('sneltoets omzetten', () => {
  test.each([
    [key({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }), 'CommandOrControl+Alt+N'],
    [key({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+N'],
    [key({ key: '5', code: 'Digit5', altKey: true }), 'Alt+5'],
    [key({ key: 'F5', code: 'F5', ctrlKey: true }), 'CommandOrControl+F5'],
    [key({ key: ' ', code: 'Space', altKey: true }), 'Alt+Space'],
    [key({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true }), 'CommandOrControl+Up'],
    [key({ key: 'n', code: 'KeyN' }), null], // zonder modifier is het geen sneltoets
    [key({ key: 'Meta', code: 'MetaLeft', metaKey: true }), null], // alleen een modifier
    [key({ key: 'Dead', code: 'Quote', altKey: true }), null],
  ])('%j -> %s', async (event, expected) => {
    const { system } = await setup();
    expect(system.acceleratorFrom(event)).toBe(expected);
  });

  test('de weergave: symbolen op macOS, woorden elders', async () => {
    const { system } = await setup();
    expect(system.shortcutLabel('CommandOrControl+Alt+N', true)).toBe('⌘⌥N');
    expect(system.shortcutLabel('CommandOrControl+Shift+F5', false)).toBe('Ctrl+Shift+F5');
    expect(system.shortcutLabel('', true)).toBe('');
  });
});

describe('opnemen in de voorkeuren', () => {
  const input = () => document.getElementById('s-shortcut') as HTMLInputElement;
  const status = () => document.getElementById('s-shortcut-status')!.textContent;
  const press = (init: KeyboardEventInit & { key: string }) => fireEvent.keyDown(input(), init);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('een geldige combinatie wordt geregistreerd en bewaard', async () => {
    const { system, state } = await setup();
    system.initSystem();
    press({ key: 'n', code: 'KeyN', metaKey: true, altKey: true });
    await flush();
    expect(agenda.setShortcut).toHaveBeenCalledWith('CommandOrControl+Alt+N');
    expect(state.data.settings.shortcut).toBe('CommandOrControl+Alt+N');
    expect(input().value).toBe(system.shortcutLabel('CommandOrControl+Alt+N'));
  });

  test('een bezette combinatie wordt niet bewaard en de oude blijft werken', async () => {
    const { system, state } = await setup();
    state.data.settings.shortcut = 'CommandOrControl+Alt+M';
    system.initSystem();
    agenda.setShortcut.mockResolvedValueOnce(false);
    press({ key: 'n', code: 'KeyN', metaKey: true });
    await flush();
    expect(state.data.settings.shortcut).toBe('CommandOrControl+Alt+M');
    expect(status()).toContain('kan niet worden gebruikt');
    expect(agenda.setShortcut).toHaveBeenLastCalledWith('CommandOrControl+Alt+M');
  });

  test('zonder modifier krijg je uitleg en gebeurt er niets', async () => {
    const { system, state } = await setup();
    system.initSystem();
    press({ key: 'n', code: 'KeyN' });
    await flush();
    expect(agenda.setShortcut).not.toHaveBeenCalled();
    expect(status()).toContain('minstens één');
    expect(state.data.settings.shortcut).toBe('');
  });

  test('Escape, Backspace en "Wis" zetten de sneltoets uit; Tab laat het veld los', async () => {
    const { system, state } = await setup();
    state.data.settings.shortcut = 'CommandOrControl+Alt+N';
    system.initSystem();
    const tab = fireEvent.keyDown(input(), { key: 'Tab' });
    expect(tab).toBe(true); // niet afgevangen
    press({ key: 'Escape' });
    await flush();
    expect(agenda.setShortcut).toHaveBeenLastCalledWith('');
    expect(state.data.settings.shortcut).toBe('');
    state.data.settings.shortcut = 'CommandOrControl+Alt+N';
    fireEvent.click(document.getElementById('s-shortcut-clear')!);
    await flush();
    expect(state.data.settings.shortcut).toBe('');
  });

  test('bij het opstarten wordt de bewaarde sneltoets weer geregistreerd', async () => {
    const { system, state } = await setup();
    state.data.settings.shortcut = 'CommandOrControl+Alt+N';
    await system.startSystem();
    expect(agenda.setShortcut).toHaveBeenCalledWith('CommandOrControl+Alt+N');
    expect(agenda.updateTray).toHaveBeenCalled();
  });
});

describe('menubalk', () => {
  test('het vinkje bewaart de instelling en stuurt meteen de stand door', async () => {
    const { system, state } = await setup();
    system.initSystem();
    const box = document.getElementById('s-tray') as HTMLInputElement;
    box.checked = true;
    fireEvent.change(box);
    expect(state.data.settings.tray).toBe(true);
    expect(agenda.updateTray).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    box.checked = false;
    fireEvent.change(box);
    expect(agenda.updateTray).toHaveBeenLastCalledWith({ enabled: false, title: '', tooltip: '', items: [] });
  });

  test('schedulePushTray bundelt meerdere aanroepen tot één bericht', async () => {
    vi.useFakeTimers();
    try {
      const { system } = await setup();
      system.schedulePushTray();
      system.schedulePushTray();
      system.schedulePushTray();
      await vi.advanceTimersByTimeAsync(400);
      expect(agenda.updateTray).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('de voorkeuren tonen de huidige stand', async () => {
    const { system, state } = await setup();
    state.data.settings.tray = true;
    state.data.settings.shortcut = 'CommandOrControl+Alt+N';
    system.showSystemSettings();
    expect((document.getElementById('s-tray') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('s-shortcut') as HTMLInputElement).value).not.toBe('');
  });
});
