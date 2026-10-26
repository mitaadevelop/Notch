import { mkdtempSync, readFileSync, realpathSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { apiMessage, apiText, apiToolUse, startAnthropic } from '../helpers/servers.ts';
import { expect, freezeTime, launchApp, settled, test } from './fixtures.ts';
import type { Launched } from './fixtures.ts';

const KEY = `sk-ant-api03-${'c'.repeat(40)}`;
type Respond = Parameters<typeof startAnthropic>[0];

async function withChat<T>(
  respond: Respond,
  run: (app: Launched, api: Awaited<ReturnType<typeof startAnthropic>>, dir: string) => Promise<T>,
) {
  const api = await startAnthropic(respond);
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-chat-')));
  const app = await launchApp(dir, [], { AGENDA_ANTHROPIC_BASE_URL: api.url });
  try {
    await freezeTime(app.window, '2026-10-26T10:00:00');
    await settled(app.window);
    return await run(app, api, dir);
  } finally {
    await app.app.close().catch(() => {});
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const log = (page: Page) => page.locator('#chat-log');
async function openWithKey(page: Page) {
  await page.locator('#chat-open').click();
  await expect(page.locator('#chat-dialog')).toBeVisible();
  await page.locator('#chat-key').fill(KEY);
  await page.locator('#chat-save').click();
  await expect(page.locator('#chat-form')).toBeVisible();
}
const ask = async (page: Page, text: string) => {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-input').press('Enter');
};

test.describe('assistent met een eigen API-sleutel', () => {
  test('zonder sleutel eerst uitleg; de sleutel wordt versleuteld bewaard en niet teruggestuurd naar de pagina', async () => {
    await withChat(
      () => ({ body: apiMessage([apiText('hoi')]) }),
      async ({ window: page }, _api, dir) => {
        await page.locator('#chat-open').click();
        await expect(page.locator('#chat-setup')).toBeVisible();
        await expect(page.locator('#chat-form')).toBeHidden();
        await page.locator('#chat-key').fill('geen-sleutel');
        await page.locator('#chat-save').click();
        await expect(page.locator('#chat-setup-status')).toContainText('sk-ant-');
        await page.locator('#chat-key').fill(KEY);
        await page.locator('#chat-save').click();
        await expect(page.locator('#chat-form')).toBeVisible();
        const file = readFileSync(path.join(dir, 'chat.json'), 'utf8');
        expect(file).not.toContain(KEY);
        expect(
          readdirSync(dir, { withFileTypes: true }).some(
            (e) => e.isFile() && readFileSync(path.join(dir, e.name)).includes(KEY),
          ),
        ).toBe(false);
        const exposed = await page.evaluate(() => JSON.stringify(Object.keys(window.agenda)));
        expect(exposed).not.toContain('getKey');
      },
    );
  });

  test('een vraag: Claude gebruikt de tools en maakt een afspraak die meteen zichtbaar is, ongedaan te maken', async () => {
    await withChat(
      (_req, n) =>
        n === 1
          ? { body: apiMessage([apiToolUse('c1', 'get_context', {})], 'tool_use') }
          : n === 2
            ? {
                body: apiMessage(
                  [
                    apiToolUse('c2', 'create_events', {
                      events: [{ title: 'Sporten', date: '2026-10-28', start_time: '18:00', end_time: '19:00' }],
                    }),
                  ],
                  'tool_use',
                ),
              }
            : { body: apiMessage([apiText('Ik heb sporten ingepland op woensdag 28 oktober om 18:00.')]) },
      async ({ window: page }, api) => {
        await page.locator('[data-view="month"]').click();
        await openWithKey(page);
        await ask(page, 'Plan sporten woensdag om 6 uur');
        await expect(log(page)).toContainText('Ik heb sporten ingepland op woensdag 28 oktober om 18:00.');
        await expect(log(page)).toContainText('✓ Agenda bekeken');
        await expect(log(page)).toContainText('✓ Afspraken gemaakt');
        await expect(page.locator('#view [data-okey]', { hasText: 'Sporten' })).toBeVisible();
        await expect(page.getByRole('status').first()).toContainText('Claude: 1 afspraak toegevoegd');
        // wat Claude over de agenda te horen kreeg
        const context = api.seen[1].body.messages.at(-1).content[0].content as string;
        expect(JSON.parse(context)).toMatchObject({ today: '2026-10-26', weekday: 'maandag' });
        expect(api.seen).toHaveLength(3);
        await page.getByRole('button', { name: 'Ongedaan maken' }).click();
        await expect(page.locator('#view [data-okey]', { hasText: 'Sporten' })).toHaveCount(0);
      },
    );
  });

  test('de agenda blijft bruikbaar terwijl het paneel open staat (niet-modaal)', async () => {
    await withChat(
      () => ({ body: apiMessage([apiText('ok')]) }),
      async ({ window: page }) => {
        await openWithKey(page);
        await page.locator('[data-view="week"]').click();
        await expect(page.locator('[data-view="week"]')).toHaveClass(/./);
        await page
          .locator('#view [data-col]')
          .first()
          .dblclick({ position: { x: 20, y: 300 } });
        await expect(page.locator('#chat-dialog')).toBeVisible();
      },
    );
  });

  test('de privacy-instelling "alleen lezen" geldt ook voor de chat', async () => {
    await withChat(
      (_req, n) =>
        n === 1
          ? {
              body: apiMessage(
                [apiToolUse('c1', 'create_events', { events: [{ title: 'Niet doen', date: '2026-10-28' }] })],
                'tool_use',
              ),
            }
          : { body: apiMessage([apiText('Ik mag niets wijzigen.')]) },
      async ({ window: page }, api) => {
        await page.evaluate(() => window.agenda.setMcp({ allowWrite: false }));
        await openWithKey(page);
        await ask(page, 'Maak een afspraak');
        await expect(log(page)).toContainText('Ik mag niets wijzigen.');
        await expect(log(page)).toContainText('✕ Afspraken gemaakt');
        expect(JSON.stringify(api.seen[1].body.messages.at(-1))).toContain('Wijzigen staat uit');
        await page.locator('[data-view="month"]').click();
        await expect(page.locator('#view [data-okey]', { hasText: 'Niet doen' })).toHaveCount(0);
      },
    );
  });

  test('een geweigerde sleutel geeft een duidelijke melding', async () => {
    await withChat(
      () => ({
        status: 401,
        body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      }),
      async ({ window: page }) => {
        await openWithKey(page);
        await ask(page, 'hoi');
        await expect(page.locator('#chat-log [role="alert"]')).toContainText('API-sleutel is niet geaccepteerd');
        await expect(page.locator('#chat-input')).toBeEnabled();
      },
    );
  });

  test('model kiezen, nieuw gesprek en de sleutel verwijderen', async () => {
    await withChat(
      (req) => ({ body: apiMessage([apiText(`model ${req.body.model}`)]) }),
      async ({ window: page }, api) => {
        await openWithKey(page);
        await ask(page, 'een');
        await expect(log(page)).toContainText('model claude-opus-5-5');
        await page.locator('#chat-model').selectOption('claude-haiku-5-5');
        await page.locator('#chat-new').click();
        await expect(log(page).locator('> *')).toHaveCount(0);
        await ask(page, 'twee');
        await expect(log(page)).toContainText('model claude-haiku-5-5');
        expect(api.seen[1].body.messages).toHaveLength(1); // nieuw gesprek
        expect(api.seen[1].body).not.toHaveProperty('fallbacks'); // Haiku heeft geen terugval
        await page.locator('#chat-forget').click();
        await expect(page.locator('#chat-setup')).toBeVisible();
        expect(await page.evaluate(() => window.agenda.chatStatus())).toMatchObject({ hasKey: false });
      },
    );
  });

  test('de sleutel blijft na een herstart bewaard', async () => {
    await withChat(
      () => ({ body: apiMessage([apiText('ok')]) }),
      async ({ window: page }) => {
        await openWithKey(page);
        await page.reload();
        expect(await page.evaluate(() => window.agenda.chatStatus())).toMatchObject({ hasKey: true });
      },
    );
  });
});
