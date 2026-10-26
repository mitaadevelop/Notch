import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createKeyStore, keyFileFor, looksLikeKey } from '../../../src/chat/keystore.ts';
import type { SecretBox } from '../../../src/chat/keystore.ts';
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '../../../src/chat/models.ts';

let dir: string;
const KEY = `sk-ant-api03-${'a'.repeat(40)}`;

// "versleuteling voor de grap": omgekeerde tekst, zodat tests zien dat de sleutel niet leesbaar op schijf staat
const box = (over: Partial<SecretBox> = {}): SecretBox => ({
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...text].reverse().join('')),
  decryptString: (data) => [...data.toString()].reverse().join(''),
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agenda-chat-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('looksLikeKey', () => {
  test.each([KEY, `  ${KEY}  `, `sk-ant-${'x'.repeat(20)}`])('geldig: %s', (k) => expect(looksLikeKey(k)).toBe(true));
  test.each([
    '',
    'sk-ant-',
    'sk-ant-kort',
    'sk-openai-abcdefghijklmnopqrstuvwxyz',
    `sk-ant-${'x'.repeat(400)}`,
    'sk-ant-with space-abcdefghijklmnopqrstu',
    5,
    null,
    {},
  ])('ongeldig: %j', (k) => expect(looksLikeKey(k)).toBe(false));
});

describe('sleutel bewaren', () => {
  test('wordt versleuteld opgeslagen en komt er weer uit; zonder sleutel is er niets', async () => {
    const store = createKeyStore(dir, box());
    expect(await store.hasKey()).toBe(false);
    expect(await store.getKey()).toBeNull();
    await store.setKey(`  ${KEY}  `);
    expect(await store.hasKey()).toBe(true);
    expect(await store.getKey()).toBe(KEY);
    const onDisk = readFileSync(keyFileFor(dir), 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain('sk-ant');
  });

  test('het bestand is alleen voor de gebruiker leesbaar', async () => {
    if (process.platform === 'win32') return;
    await createKeyStore(dir, box()).setKey(KEY);
    const { statSync } = await import('node:fs');
    expect(statSync(keyFileFor(dir)).mode & 0o777).toBe(0o600);
  });

  test('geen sleutel van een ander merk, en niets bewaard bij een fout', async () => {
    const store = createKeyStore(dir, box());
    await expect(store.setKey('sk-openai-123')).rejects.toThrow('sk-ant-');
    expect(existsSync(keyFileFor(dir))).toBe(false);
  });

  test('zonder veilige opslag wordt niets bewaard (ook niet "zwakke" opslag)', async () => {
    await expect(createKeyStore(dir, box({ isEncryptionAvailable: () => false })).setKey(KEY)).rejects.toThrow(
      'Veilig bewaren',
    );
    await expect(createKeyStore(dir, box({ weak: () => true })).setKey(KEY)).rejects.toThrow('Veilig bewaren');
    expect(existsSync(keyFileFor(dir))).toBe(false);
  });

  test('verwijderen haalt de sleutel weg maar laat het gekozen model staan', async () => {
    const store = createKeyStore(dir, box());
    await store.setKey(KEY);
    await store.setModel('claude-haiku-5-5');
    await store.clearKey();
    expect(await store.hasKey()).toBe(false);
    expect(await store.getKey()).toBeNull();
    expect(await store.getModel()).toBe('claude-haiku-5-5');
  });

  test('een sleutel die niet meer te ontsleutelen is (andere gebruiker) telt als geen sleutel', async () => {
    await createKeyStore(dir, box()).setKey(KEY);
    const broken = createKeyStore(
      dir,
      box({
        decryptString: () => {
          throw new Error('kapot');
        },
      }),
    );
    expect(await broken.getKey()).toBeNull();
  });

  test('een kapot bestand wordt genegeerd', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(keyFileFor(dir), '{ kapot');
    const store = createKeyStore(dir, box());
    expect(await store.hasKey()).toBe(false);
    await store.setKey(KEY);
    expect(await store.getKey()).toBe(KEY);
  });
});

describe('model', () => {
  test('standaard Opus 5.5; een keuze blijft; onbekend wordt geweigerd', async () => {
    const store = createKeyStore(dir, box());
    expect(await store.getModel()).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_CHAT_MODEL).toBe('claude-opus-5-5');
    await store.setModel('claude-sonnet-5-5');
    expect(await createKeyStore(dir, box()).getModel()).toBe('claude-sonnet-5-5');
    await expect(store.setModel('gpt-5')).rejects.toThrow('Onbekend model');
    await expect(store.setModel(undefined)).rejects.toThrow('Onbekend model');
    expect(await store.getModel()).toBe('claude-sonnet-5-5');
  });

  test('een onbekend model in het bestand valt terug op de standaard', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(keyFileFor(dir), JSON.stringify({ model: 'oud-model' }));
    expect(await createKeyStore(dir, box()).getModel()).toBe(DEFAULT_CHAT_MODEL);
  });

  test('de lijst bevat precies de bedoelde modellen, zonder datumachtervoegsel', () => {
    expect(CHAT_MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    for (const m of CHAT_MODELS) expect(m.id).not.toMatch(/-\d{8}$/);
  });
});
