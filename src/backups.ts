// Automatische back-ups van events.json: zo nu en dan een kopie in de map "backups", met een beperkt aantal bewaard.
// "Ongedaan maken" werkt alleen binnen één sessie; een back-up redt je ook van een kapot bestand of een foute import.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BackupInfo } from './shared/types.ts';

export const BACKUP_KEEP = 20;
export const BACKUP_INTERVAL_MS = 30 * 60_000;

// events-2026-10-26T13-05-09-123Z.json, eventueel met een achtervoegsel
const NAME = /^events-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-voor-herstel)?\.json$/;

export interface BackupOptions {
  /** het bestand dat een back-up krijgt */
  file: string;
  /** de map voor back-ups */
  dir: string;
  keep?: number;
  intervalMs?: number;
  now?: () => number;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-');
const timeOf = (name: string) => {
  const m = name.match(/^events-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0;
};

function countEvents(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const events = (parsed as { events?: unknown }).events ?? (Array.isArray(parsed) ? parsed : []);
    return Array.isArray(events) ? events.length : 0;
  } catch {
    return null;
  }
}

export function createBackups(options: BackupOptions) {
  const { file, dir } = options;
  const keep = options.keep ?? BACKUP_KEEP;
  const intervalMs = options.intervalMs ?? BACKUP_INTERVAL_MS;
  const now = options.now ?? Date.now;

  async function names() {
    try {
      return (await fs.readdir(dir))
        .filter((n) => NAME.test(n))
        .sort()
        .reverse(); // nieuwste eerst
    } catch {
      return [];
    }
  }

  async function prune() {
    for (const name of (await names()).slice(keep)) await fs.rm(path.join(dir, name), { force: true });
  }

  async function copyCurrent(suffix = '') {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      return null; // er is nog niets om te bewaren
    }
    if (countEvents(text) === null) return null; // een kapot bestand verdringt geen goede back-up
    await fs.mkdir(dir, { recursive: true });
    const name = `events-${stamp(now())}${suffix}.json`;
    await fs.writeFile(path.join(dir, name), text);
    await prune();
    return name;
  }

  return {
    /** Maakt een back-up van het huidige bestand als de laatste oud genoeg is. Fouten stoppen het opslaan nooit. */
    async maybeBackup() {
      try {
        const [latest] = await names();
        if (latest && now() - timeOf(latest) < intervalMs) return null;
        return await copyCurrent();
      } catch {
        return null;
      }
    },

    async list(): Promise<BackupInfo[]> {
      const result: BackupInfo[] = [];
      for (const name of await names()) {
        try {
          const text = await fs.readFile(path.join(dir, name), 'utf8');
          result.push({
            name,
            at: timeOf(name),
            bytes: Buffer.byteLength(text),
            events: countEvents(text) ?? 0,
            beforeRestore: name.includes('-voor-herstel'),
          });
        } catch {
          // verdwenen tijdens het lezen: overslaan
        }
      }
      return result;
    },

    /** De tekst van een back-up, of een fout als de naam niet klopt of het bestand kapot is. */
    async read(name: string) {
      if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Onbekende back-up.');
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, name), 'utf8');
      } catch {
        throw new Error('Deze back-up bestaat niet meer.');
      }
      if (countEvents(text) === null) throw new Error('Deze back-up is beschadigd.');
      return text;
    },

    /** Bewaart de huidige stand voordat een back-up wordt teruggezet. */
    snapshotBeforeRestore: () => copyCurrent('-voor-herstel'),
  };
}

export type Backups = ReturnType<typeof createBackups>;
