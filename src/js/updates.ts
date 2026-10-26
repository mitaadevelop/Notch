// "Updates" in de voorkeuren en een knop bovenin zodra er een nieuwe versie is
import type { UpdateState } from '../shared/types.ts';
import { $ } from './util.ts';

const f = {
  pill: $<HTMLButtonElement>('update-pill'),
  status: $('upd-status'),
  progress: $<HTMLProgressElement>('upd-progress'),
  action: $<HTMLButtonElement>('upd-action'),
};

let state: UpdateState = { status: 'idle', currentVersion: '' };
let notify: (message: string) => void = () => {};

const time = (ms: number) => new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

// de tekst bij elke status, ook voor tests
export function describe(s: UpdateState): string {
  switch (s.status) {
    case 'unsupported':
      return s.error ?? 'Updaten kan alleen in de geïnstalleerde app.';
    case 'idle':
      return `Je hebt versie ${s.currentVersion}.`;
    case 'checking':
      return 'Zoeken naar updates…';
    case 'none':
      return `Je hebt de nieuwste versie (${s.currentVersion})${s.checkedAt ? `, gecontroleerd om ${time(s.checkedAt)}` : ''}.`;
    case 'available':
      return `Versie ${s.version} is beschikbaar (je hebt ${s.currentVersion}).`;
    case 'downloading':
      return `Versie ${s.version} wordt gedownload… ${s.progress ?? 0}%`;
    case 'ready':
      return `Versie ${s.version} staat klaar. De app sluit af en start daarna opnieuw op; je agenda blijft behouden.`;
    case 'error':
      return `Updaten is mislukt: ${s.error}`;
  }
}

// wat de knop nu doet
function action(s: UpdateState): { label: string; disabled: boolean; run: () => void } {
  switch (s.status) {
    case 'available':
      return { label: `Download versie ${s.version}`, disabled: false, run: () => void window.agenda.downloadUpdate() };
    case 'downloading':
      return { label: 'Downloaden…', disabled: true, run: () => {} };
    case 'ready':
      return { label: 'Herstart en installeer', disabled: false, run: () => void window.agenda.installUpdate() };
    case 'checking':
      return { label: 'Bezig…', disabled: true, run: () => {} };
    case 'unsupported':
      return { label: 'Zoek naar updates', disabled: true, run: () => {} };
    default:
      return { label: 'Zoek naar updates', disabled: false, run: () => void window.agenda.checkForUpdates() };
  }
}

function pill(s: UpdateState): { text: string; disabled: boolean } | null {
  if (s.status === 'available') return { text: `Update ${s.version}`, disabled: false };
  if (s.status === 'downloading') return { text: `Downloaden… ${s.progress ?? 0}%`, disabled: true };
  if (s.status === 'ready') return { text: 'Herstart om te updaten', disabled: false };
  return null;
}

function render() {
  f.status.textContent = describe(state);
  const a = action(state);
  f.action.textContent = a.label;
  f.action.disabled = a.disabled;
  f.progress.hidden = state.status !== 'downloading';
  f.progress.value = state.progress ?? 0;

  const p = pill(state);
  f.pill.hidden = !p;
  if (p) {
    f.pill.textContent = p.text;
    f.pill.disabled = p.disabled;
  }
}

export const updateState = () => state;

// de pagina krijgt elke wijziging van main; een nieuwe versie wordt eenmalig gemeld
// de beginstand die bij het opstarten wordt opgehaald mag een melding die er intussen al was niet overschrijven
let pushed = false;

export function onState(next: UpdateState) {
  pushed = true;
  const was = state.status;
  state = next;
  render();
  if (next.status === 'available' && was !== 'available') notify(`Versie ${next.version} is beschikbaar.`);
  if (next.status === 'ready' && was !== 'ready') notify(`Versie ${next.version} staat klaar om te installeren.`);
}

export async function initUpdates(toast: (message: string) => void) {
  notify = toast;
  f.action.addEventListener('click', () => action(state).run());
  f.pill.addEventListener('click', () => action(state).run());
  window.agenda.onUpdateState(onState);
  const initial = await window.agenda.getUpdateState();
  if (!pushed) {
    state = initial;
    render();
  }
}

// uit het menu: zoek meteen
export const checkNow = () => void window.agenda.checkForUpdates();
