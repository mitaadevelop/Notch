// houdt externe agenda's (feeds en CalDAV-accounts) actueel; de pagina haalt de tekst op via main en leest hem hier in
import type { Calendar } from '../shared/types.ts';
import { parseICS } from './ics.ts';
import { data, hooks, ui } from './state.ts';
import * as store from './store.ts';

// fouten van ipcRenderer.invoke beginnen met "Error invoking remote method '…': Error: "
export const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

async function fetchText(calendar: Calendar): Promise<string> {
  const source = calendar.source;
  if (!source) throw new Error('Dit is geen externe agenda.');
  return source.kind === 'feed'
    ? window.agenda.fetchFeed(source.url)
    : window.agenda.fetchAccountCalendar(source.accountId, source.calendarUrl);
}

// geeft true als het gelukt is; bij een fout blijven de oude afspraken staan en toont de zijbalk een waarschuwing
export async function syncCalendar(calendar: Calendar): Promise<boolean> {
  ui.syncing.add(calendar.id);
  hooks.refreshSidebar?.();
  try {
    store.applySync(calendar.id, parseICS(await fetchText(calendar)).events);
    return true;
  } catch (error) {
    store.applySync(calendar.id, null, errorMessage(error));
    return false;
  } finally {
    ui.syncing.delete(calendar.id);
    hooks.refreshSidebar?.();
  }
}

let running = false;
let lastRun = 0; // tijdstip waarop de laatste ronde begon (automatisch of met de hand)

export const isSyncing = () => running;

// loopt alle externe agenda's langs; geeft de namen van de agenda's die mislukten
export async function syncAll(): Promise<string[]> {
  if (running) return [];
  running = true;
  lastRun = Date.now();
  hooks.syncState?.();
  const failed: string[] = [];
  try {
    for (const calendar of [...data.calendars]) {
      if (calendar.source && !(await syncCalendar(calendar))) failed.push(calendar.name);
    }
  } finally {
    running = false;
    hooks.syncState?.();
  }
  return failed;
}

// is het tijd voor een nieuwe ronde? 0 minuten betekent dat de gebruiker automatisch vernieuwen heeft uitgezet
export const autoSyncDue = (minutes: number, last: number, now: number) =>
  minutes > 0 && now - last >= minutes * 60_000;

// Kijkt vaak of het ingestelde interval verstreken is, in plaats van één lange timer: een gewijzigde instelling, ongedaan
// maken of de slaapstand van de computer werkt zo meteen goed. Een ronde met de hand telt ook als vernieuwd.
export function startAutoSync(checkEveryMs = 15_000) {
  return setInterval(() => {
    if (data.calendars.some((c) => c.source) && autoSyncDue(data.settings.refreshMinutes, lastRun, Date.now())) {
      void syncAll();
    }
  }, checkEveryMs);
}
