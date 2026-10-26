// De API-sleutel van de gebruiker, versleuteld met de sleutelhanger van het systeem (safeStorage), en de gekozen model.
// De sleutel verlaat main nooit: de pagina weet alleen of er een is.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CHAT_MODEL, modelById } from './models.ts';

export interface SecretBox {
  isEncryptionAvailable(): boolean;
  /** op Linux zonder keyring valt de opslag terug op leesbare tekst */
  weak?(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

interface Stored {
  key?: string; // base64 van de versleutelde sleutel
  model?: string;
}

export const keyFileFor = (userDataDir: string) => path.join(userDataDir, 'chat.json');

// Een sleutel van Anthropic begint met sk-ant-; alles anders is zeker geen bruikbare sleutel.
export const looksLikeKey = (value: unknown): value is string =>
  typeof value === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(value.trim());

export function createKeyStore(userDataDir: string, box: SecretBox) {
  const file = keyFileFor(userDataDir);

  async function read(): Promise<Stored> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
    } catch {
      return {};
    }
  }

  async function write(next: Stored) {
    await fs.mkdir(userDataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  return {
    async hasKey() {
      return Boolean((await read()).key);
    },

    async setKey(raw: unknown) {
      if (!looksLikeKey(raw)) throw new Error('Dit lijkt geen API-sleutel van Anthropic (die begint met sk-ant-).');
      if (!box.isEncryptionAvailable() || box.weak?.()) {
        throw new Error('Veilig bewaren van de sleutel kan niet op dit systeem (geen beveiligde opslag beschikbaar).');
      }
      const stored = await read();
      await write({ ...stored, key: box.encryptString(raw.trim()).toString('base64') });
    },

    /** De sleutel in leesbare vorm, of null; alleen voor main zelf. */
    async getKey(): Promise<string | null> {
      const { key } = await read();
      if (!key) return null;
      try {
        return box.decryptString(Buffer.from(key, 'base64'));
      } catch {
        return null; // bijv. na een nieuwe gebruiker of sleutelhanger: de gebruiker voert hem opnieuw in
      }
    },

    async clearKey() {
      const { key: _key, ...rest } = await read();
      void _key;
      await write(rest);
    },

    async getModel(): Promise<string> {
      const { model } = await read();
      return modelById(model)?.id ?? DEFAULT_CHAT_MODEL;
    },

    async setModel(id: unknown) {
      const model = modelById(id);
      if (!model) throw new Error('Onbekend model.');
      await write({ ...(await read()), model: model.id });
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;
