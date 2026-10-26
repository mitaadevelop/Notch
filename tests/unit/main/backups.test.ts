import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BACKUP_INTERVAL_MS, BACKUP_KEEP, createBackups } from '../../../src/backups.ts';

let dir: string;
let file: string;
let clock: number;
const json = (events: number) =>
  JSON.stringify({
    version: 2,
    calendars: [],
    events: Array.from({ length: events }, (_, i) => ({ id: String(i) })),
    settings: {},
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agenda-bak-'));
  file = path.join(dir, 'events.json');
  clock = Date.UTC(2026, 9, 26, 13, 0, 0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (extra: { keep?: number } = {}) =>
  createBackups({ file, dir: path.join(dir, 'backups'), now: () => clock, ...extra });
const files = () => (existsSync(path.join(dir, 'backups')) ? readdirSync(path.join(dir, 'backups')).sort() : []);

describe('maybeBackup', () => {
  test('bewaart het huidige bestand, met een tijdstempel in de naam', async () => {
    writeFileSync(file, json(3));
    const name = await make().maybeBackup();
    expect(name).toBe('events-2026-10-26T13-00-00-000Z.json');
    expect(readFileSync(path.join(dir, 'backups', name!), 'utf8')).toBe(json(3));
  });

  test('doet niets zonder bestand (eerste start)', async () => {
    expect(await make().maybeBackup()).toBeNull();
    expect(files()).toEqual([]);
  });

  test('hooguit één back-up per interval, daarna weer een nieuwe', async () => {
    writeFileSync(file, json(1));
    const b = make();
    expect(await b.maybeBackup()).not.toBeNull();
    clock += BACKUP_INTERVAL_MS - 1;
    expect(await b.maybeBackup()).toBeNull();
    clock += 1;
    writeFileSync(file, json(2));
    expect(await b.maybeBackup()).not.toBeNull();
    expect(files()).toHaveLength(2);
  });

  test('een kapot of leeg bestand wordt niet bewaard (en verdringt dus geen goede back-up)', async () => {
    writeFileSync(file, '{ kapot');
    expect(await make().maybeBackup()).toBeNull();
    writeFileSync(file, '');
    expect(await make().maybeBackup()).toBeNull();
    writeFileSync(file, 'null');
    expect(await make().maybeBackup()).toBeNull();
    expect(files()).toEqual([]);
  });

  test('bewaart er maximaal BACKUP_KEEP: de oudste verdwijnen eerst', async () => {
    const b = make();
    for (let i = 0; i < BACKUP_KEEP + 5; i++) {
      writeFileSync(file, json(i));
      clock += BACKUP_INTERVAL_MS;
      await b.maybeBackup();
    }
    const left = files();
    expect(left).toHaveLength(BACKUP_KEEP);
    expect(readFileSync(path.join(dir, 'backups', left.at(-1)!), 'utf8')).toBe(json(BACKUP_KEEP + 4)); // de nieuwste staat er nog
    expect(readFileSync(path.join(dir, 'backups', left[0]), 'utf8')).toBe(json(5)); // de eerste 5 zijn weg
  });

  test('een niet te schrijven map stopt het opslaan niet', async () => {
    writeFileSync(file, json(1));
    writeFileSync(path.join(dir, 'backups'), 'ik ben een bestand'); // map kan niet worden aangemaakt
    await expect(make().maybeBackup()).resolves.toBeNull();
  });

  test('vreemde bestanden in de map worden nooit gewist', async () => {
    mkdirSync(path.join(dir, 'backups'));
    writeFileSync(path.join(dir, 'backups', 'belangrijk.txt'), 'x');
    const b = make({ keep: 1 });
    for (let i = 0; i < 3; i++) {
      writeFileSync(file, json(i));
      clock += BACKUP_INTERVAL_MS;
      await b.maybeBackup();
    }
    expect(files()).toContain('belangrijk.txt');
    expect(files().filter((n) => n.startsWith('events-'))).toHaveLength(1);
  });
});

describe('list, read en herstel', () => {
  test('toont nieuwste eerst, met aantal afspraken en grootte', async () => {
    const b = make();
    writeFileSync(file, json(2));
    await b.maybeBackup();
    clock += BACKUP_INTERVAL_MS;
    writeFileSync(file, json(7));
    await b.maybeBackup();
    const list = await b.list();
    expect(list.map((x) => x.events)).toEqual([7, 2]);
    expect(list[0].at).toBe(clock);
    expect(list[0].bytes).toBe(Buffer.byteLength(json(7)));
    expect(list.every((x) => !x.beforeRestore)).toBe(true);
  });

  test('ook het oude formaat (een lijst met afspraken) wordt geteld', async () => {
    writeFileSync(file, JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    const b = make();
    await b.maybeBackup();
    expect((await b.list())[0].events).toBe(2);
  });

  test('read geeft de tekst terug, en weigert vreemde namen en pad-trucs', async () => {
    writeFileSync(file, json(4));
    const b = make();
    const name = (await b.maybeBackup())!;
    expect(await b.read(name)).toBe(json(4));
    for (const bad of ['../events.json', '..\\x', 'events.json', `${name}/../${name}`, '', 'events-x.json']) {
      await expect(b.read(bad)).rejects.toThrow('Onbekende back-up');
    }
    await expect(b.read(5 as never)).rejects.toThrow('Onbekende back-up');
  });

  test('read meldt een verdwenen of beschadigde back-up', async () => {
    writeFileSync(file, json(1));
    const b = make();
    const name = (await b.maybeBackup())!;
    writeFileSync(path.join(dir, 'backups', name), '{ kapot');
    await expect(b.read(name)).rejects.toThrow('beschadigd');
    rmSync(path.join(dir, 'backups', name));
    await expect(b.read(name)).rejects.toThrow('bestaat niet meer');
  });

  test('snapshotBeforeRestore bewaart altijd, ook binnen het interval, en wordt zo gemarkeerd', async () => {
    writeFileSync(file, json(1));
    const b = make();
    await b.maybeBackup();
    writeFileSync(file, json(9));
    const name = await b.snapshotBeforeRestore();
    expect(name).toMatch(/-voor-herstel\.json$/);
    const list = await b.list();
    expect(list.find((x) => x.name === name)).toMatchObject({ beforeRestore: true, events: 9 });
  });

  test('een lege map geeft een lege lijst', async () => {
    expect(await make().list()).toEqual([]);
  });
});
