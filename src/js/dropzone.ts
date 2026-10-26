// bestanden en links op het venster laten vallen: een .ics-bestand importeren, een agenda-link als abonnement toevoegen.
// Zonder dit zou Electron wegnavigeren naar het losgelaten bestand en de hele app vervangen door dat bestand.
import { importIcsTexts } from './importing.ts';
import { INTERNAL_DRAG } from './occ-ui.ts';
import { openSourceDialog } from './sources.ts';
import type { Kind } from './sources.ts';
import { el } from './util.ts';

const MAX_BYTES = 5 * 1024 * 1024;

// Een link die op een agenda lijkt: webcal://, of een .ics-adres, of een iCal-adres van Google.
export function looksLikeCalendarUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  return /^webcals?:/i.test(raw.trim()) || /\.ics$/i.test(url.pathname) || /\/calendar\/ical\//i.test(url.pathname);
}

// welke soort in de "Agenda toevoegen"-dialoog bij deze link past
export function kindForUrl(raw: string): Kind {
  const host = (() => {
    try {
      return new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://')).hostname;
    } catch {
      return '';
    }
  })();
  if (host.endsWith('calendar.google.com')) return 'google';
  if (/(^|\.)outlook\.(live|office365|office)\.com$/.test(host) || host.endsWith('office365.com')) return 'outlook';
  if (host.endsWith('icloud.com')) return 'feed';
  return 'feed';
}

// de eerste regel van een lijst met links (text/uri-list negeert commentaarregels met #)
const firstUrl = (list: string) =>
  list
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith('#'))
    ?.trim() ?? '';

let overlay: HTMLElement | null = null;
let depth = 0;

function showOverlay() {
  if (overlay) return;
  overlay = el(
    'div',
    'pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-2xl border-4 border-dashed border-accent bg-accent/10 text-lg font-semibold text-accent',
    'Laat los om te importeren of toe te voegen',
  );
  overlay.id = 'drop-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.append(overlay);
}

function hideOverlay() {
  depth = 0;
  overlay?.remove();
  overlay = null;
}

// alleen van buiten komende bestanden of links; slepen van onze eigen afspraken gebruikt zijn eigen afhandeling
const external = (e: DragEvent) => {
  const types = e.dataTransfer?.types ?? [];
  return (
    !types.includes(INTERNAL_DRAG) && types.some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/plain')
  );
};

export function initDropzone(toast: (message: string) => void) {
  document.addEventListener('dragenter', (e) => {
    if (!external(e)) return;
    depth++;
    showOverlay();
  });
  document.addEventListener('dragover', (e) => {
    if (!external(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!external(e) && !overlay) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) hideOverlay();
  });
  document.addEventListener('drop', (e) => {
    if (!external(e)) return;
    // altijd tegenhouden: anders navigeert het venster naar het losgelaten bestand
    e.preventDefault();
    hideOverlay();
    void handleDrop(e.dataTransfer, toast);
  });
}

export async function handleDrop(data: DataTransfer | null, toast: (message: string) => void) {
  if (!data) return;
  const files = [...data.files];
  if (files.length) {
    const calendars = files.filter((file) => /\.ics$/i.test(file.name) || file.type === 'text/calendar');
    if (!calendars.length) return toast('Alleen .ics-bestanden kunnen worden geïmporteerd.');
    const tooBig = calendars.filter((file) => file.size > MAX_BYTES);
    if (tooBig.length === calendars.length) return toast('Dit bestand is te groot (meer dan 5 MB).');
    const texts = await Promise.all(
      calendars
        .filter((file) => file.size <= MAX_BYTES)
        .map(async (file) => ({ name: file.name.replace(/\.ics$/i, ''), text: await file.text() })),
    );
    const total = importIcsTexts(texts);
    toast(total ? `${total} afspraken geïmporteerd.` : 'Geen afspraken gevonden in het bestand.');
    return;
  }
  const url = firstUrl(data.getData('text/uri-list')) || firstUrl(data.getData('text/plain'));
  if (url && looksLikeCalendarUrl(url)) return openSourceDialog(kindForUrl(url), url);
  if (url) toast('Dit is geen agenda-link (.ics of webcal://).');
}
