// afspraken uit .ics-tekst importeren, voor het importeren via het menu en voor slepen-en-loslaten
import { parseICS } from './ics.ts';
import * as store from './store.ts';

// Maakt van elk bestand met afspraken een eigen agenda; geeft het totaal aantal geïmporteerde afspraken terug.
export function importIcsTexts(files: { name: string; text: string }[]) {
  let total = 0;
  for (const file of files) {
    const parsed = parseICS(file.text);
    if (!parsed.events.length) continue;
    store.importEvents(parsed.name || file.name, parsed.events);
    total += parsed.events.length;
  }
  return total;
}
