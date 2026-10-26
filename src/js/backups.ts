// "Back-ups" in de voorkeuren: kies een eerdere versie van je agenda en zet hem terug
import type { BackupInfo } from '../shared/types.ts';
import { errorMessage } from './sync.ts';
import { $ } from './util.ts';

const f = {
  list: $<HTMLSelectElement>('bak-list'),
  restore: $<HTMLButtonElement>('bak-restore'),
  status: $('bak-status'),
};

const stamp = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const plural = (n: number) => `${n} ${n === 1 ? 'afspraak' : 'afspraken'}`;

export const backupLabel = (b: BackupInfo) =>
  `${stamp.format(b.at)} · ${plural(b.events)}${b.beforeRestore ? ' · vóór een herstel' : ''}`;

export async function refreshBackups() {
  let backups: BackupInfo[] = [];
  try {
    backups = await window.agenda.listBackups();
  } catch {
    f.status.textContent = 'De back-ups konden niet worden gelezen.';
  }
  f.list.replaceChildren(...backups.map((b) => new Option(backupLabel(b), b.name)));
  f.restore.disabled = backups.length === 0;
  if (!backups.length) {
    f.list.append(new Option('Nog geen back-ups', ''));
    f.list.disabled = true;
  } else f.list.disabled = false;
  if (backups.length) f.status.textContent = '';
  else if (!f.status.textContent) f.status.textContent = 'De eerste back-up wordt gemaakt zodra je iets wijzigt.';
}

export function initBackups(reload: () => void = () => location.reload()) {
  f.restore.addEventListener('click', async () => {
    if (!f.list.value) return;
    f.restore.disabled = true;
    try {
      if (await window.agenda.restoreBackup(f.list.value)) return reload();
      f.status.textContent = 'Niet teruggezet.';
    } catch (error) {
      f.status.textContent = `Terugzetten mislukt: ${errorMessage(error)}`;
    }
    f.restore.disabled = false;
  });
}
