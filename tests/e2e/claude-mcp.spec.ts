import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clickMenu, expect, freezeTime, settled, test } from './fixtures.ts';

// Zoals Claude Desktop het doet: de server als apart proces starten met precies het commando uit de voorkeuren
// (de app zelf als Node via ELECTRON_RUN_AS_NODE), en daarmee praten via het MCP-protocol.
async function connectClaude(page: Page) {
  const status = await page.evaluate(() => window.agenda.getMcp());
  const client = new Client({ name: 'e2e', version: '1' });
  const transport = new StdioClientTransport({
    command: status.command,
    args: status.args,
    env: { ...(process.env as Record<string, string>), ...status.env },
    stderr: 'pipe',
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    const text = result.content[0].text;
    return { error: result.isError ? text : null, data: result.isError ? null : JSON.parse(text) };
  };
  return { client, call };
}

const chip = (page: Page, title: string) => page.locator('#view [data-okey]', { hasText: title });

test.use({
  initialFile: JSON.stringify({
    version: 2,
    events: [
      {
        id: '1',
        title: 'Tandarts',
        date: '2026-10-28',
        endDate: '2026-10-28',
        time: '14:00',
        endTime: '15:00',
        notes: 'Kaartje meenemen',
        invitees: ['Sam'],
        calendarId: 'home',
      },
    ],
  }),
});

test.beforeEach(async ({ mainWindow }) => {
  await freezeTime(mainWindow, '2026-10-26T10:00:00');
});

test.describe('Claude via MCP', () => {
  test('leest de agenda: context, lijst, zoeken en vrije tijd', async ({ mainWindow }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toContain('create_events');

      const ctx = await call('get_context');
      expect(ctx.data).toMatchObject({ today: '2026-10-26', weekday: 'maandag', total_events: 1 });
      expect(ctx.data.upcoming_events[0].title).toBe('Tandarts');

      const list = await call('list_events', { from: '2026-10-26', to: '2026-11-01' });
      expect(list.data.events).toHaveLength(1);
      expect(list.data.events[0]).toMatchObject({
        title: 'Tandarts',
        start_time: '14:00',
        notes: 'Kaartje meenemen',
        invitees: ['Sam'],
      });

      expect((await call('search_events', { query: 'tand' })).data.count).toBe(1);

      const free = await call('find_free_time', { from: '2026-10-28', to: '2026-10-28', duration_minutes: 60 });
      expect(free.data.slots.map((s: { start_time: string }) => s.start_time)).toEqual(['09:00', '15:00']);
    } finally {
      await client.close();
    }
  });

  test('maakt afspraken die meteen in de agenda staan, met een melding en één klik ongedaan maken', async ({
    mainWindow,
  }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      const made = await call('create_events', {
        events: [
          { title: 'Lunch met Sam', date: '2026-10-27', start_time: '12:00', end_time: '13:00', location: 'Café' },
          {
            title: 'Hardlopen',
            date: '2026-10-26',
            start_time: '18:00',
            repeat: { frequency: 'daily', until: '2026-10-28' },
          },
        ],
      });
      expect(made.error).toBeNull();
      expect(made.data.created).toBe(2);

      await expect(chip(mainWindow, 'Lunch met Sam')).toBeVisible();
      await expect(chip(mainWindow, 'Hardlopen').first()).toBeVisible();
      await expect(mainWindow.getByRole('status')).toContainText('Claude: 2 afspraken toegevoegd');
      // en echt opgeslagen
      await expect
        .poll(() =>
          mainWindow.evaluate(async () => ((await window.agenda.load()) as { events: unknown[] }).events.length),
        )
        .toBe(3);

      await mainWindow.getByRole('button', { name: 'Ongedaan maken' }).click();
      await expect(chip(mainWindow, 'Lunch met Sam')).toHaveCount(0);
      await expect(chip(mainWindow, 'Tandarts')).toBeVisible();
    } finally {
      await client.close();
    }
  });

  test("wijzigt en verwijdert, en alleen-lezen agenda's blijven onaangeroerd", async ({ mainWindow }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      const updated = await call('update_event', { id: '1', date: '2026-10-29', start_time: '16:00' });
      expect(updated.data.event).toMatchObject({ date: '2026-10-29', start_time: '16:00', end_time: '17:00' });
      await expect(chip(mainWindow, 'Tandarts')).toBeVisible();
      await expect
        .poll(() =>
          mainWindow.evaluate(
            async () => ((await window.agenda.load()) as { events: { date: string }[] }).events[0]?.date,
          ),
        )
        .toBe('2026-10-29');
      await expect(mainWindow.getByRole('status')).toContainText('Claude: Tandarts gewijzigd');

      const holiday = await call('create_events', {
        events: [{ title: 'X', date: '2026-10-30', calendar: 'Feestdagen NL' }],
      });
      expect(holiday.error).toContain('kunnen geen afspraken');

      expect((await call('delete_event', { id: '1' })).data).toMatchObject({ deleted: true });
      await expect(chip(mainWindow, 'Tandarts')).toHaveCount(0);
      expect((await call('get_event', { id: '1' })).error).toContain('Geen afspraak gevonden');
    } finally {
      await client.close();
    }
  });

  test('fouten komen als leesbare melding terug en veranderen niets', async ({ mainWindow }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      const bad = await call('create_events', {
        events: [
          { title: 'Goed', date: '2026-10-27' },
          { title: 'Fout', date: '2026-10-27', start_time: '10:00', end_time: '09:00' },
        ],
      });
      expect(bad.error).toBeTruthy();
      await expect(chip(mainWindow, 'Goed')).toHaveCount(0);
      expect((await call('list_events', { from: '2026-10-27', to: '2026-10-27' })).data.count).toBe(0);
    } finally {
      await client.close();
    }
  });
});

test.describe('privacy-instellingen', () => {
  async function open(page: Page, app: Parameters<typeof clickMenu>[0]) {
    await clickMenu(app, 'Voorkeuren…');
    await expect(page.locator('#settings-dialog')).toBeVisible();
  }

  test('de opties staan standaard aan en tonen de koppeling als actief', async ({ mainWindow, electronApp }) => {
    await open(mainWindow, electronApp);
    for (const id of ['#mcp-write', '#mcp-notes', '#mcp-invitees']) await expect(mainWindow.locator(id)).toBeChecked();
    await expect(mainWindow.locator('#mcp-status')).toContainText('actief');
  });

  test('"mag wijzigen" uit: Claude kan nog lezen maar niet schrijven, direct zonder herstart', async ({
    mainWindow,
    electronApp,
  }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      await open(mainWindow, electronApp);
      await mainWindow.locator('#mcp-write').uncheck();
      await expect
        .poll(async () => (await mainWindow.evaluate(() => window.agenda.getMcp())).config.allowWrite)
        .toBe(false);

      expect((await call('list_events', { from: '2026-10-26', to: '2026-11-01' })).error).toBeNull();
      const blocked = await call('delete_event', { id: '1' });
      expect(blocked.error).toContain('alleen mag lezen');
      await mainWindow.keyboard.press('Escape');
      await expect(chip(mainWindow, 'Tandarts')).toBeVisible();

      await open(mainWindow, electronApp);
      await mainWindow.locator('#mcp-write').check();
      await expect
        .poll(async () => (await mainWindow.evaluate(() => window.agenda.getMcp())).config.allowWrite)
        .toBe(true);
      expect((await call('delete_event', { id: '1' })).error).toBeNull();
    } finally {
      await client.close();
    }
  });

  test('notities en genodigden worden niet gedeeld als dat uit staat', async ({ mainWindow, electronApp }) => {
    const { client, call } = await connectClaude(mainWindow);
    try {
      await open(mainWindow, electronApp);
      await mainWindow.locator('#mcp-notes').uncheck();
      await mainWindow.locator('#mcp-invitees').uncheck();
      await expect
        .poll(async () => (await mainWindow.evaluate(() => window.agenda.getMcp())).config.shareNotes)
        .toBe(false);
      const { data } = await call('get_event', { id: '1' });
      expect(data.title).toBe('Tandarts');
      expect(JSON.stringify(data)).not.toContain('Kaartje');
      expect(JSON.stringify(data)).not.toContain('Sam');
    } finally {
      await client.close();
    }
  });

  test('de instellingen blijven bewaard in mcp.json', async ({ mainWindow, electronApp, userDataDir }) => {
    await open(mainWindow, electronApp);
    await mainWindow.locator('#mcp-notes').uncheck();
    await expect
      .poll(() =>
        existsSync(path.join(userDataDir, 'mcp.json'))
          ? JSON.parse(readFileSync(path.join(userDataDir, 'mcp.json'), 'utf8')).shareNotes
          : null,
      )
      .toBe(false);
  });

  test('"Voeg toe aan Claude Desktop" vraagt eerst toestemming en schrijft niets bij annuleren', async ({
    mainWindow,
    electronApp,
  }) => {
    // het native bevestigingsvenster vervangen: annuleren
    await electronApp.evaluate(({ dialog }) => {
      (globalThis as unknown as { __asked: string[] }).__asked = [];
      dialog.showMessageBox = (async (_win: unknown, options: { message: string }) => {
        (globalThis as unknown as { __asked: string[] }).__asked.push(options.message);
        return { response: 1, checkboxChecked: false };
      }) as never;
    });
    await open(mainWindow, electronApp);
    await mainWindow.locator('#mcp-install').click();
    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as unknown as { __asked: string[] }).__asked.length))
      .toBe(1);
    await settled(mainWindow);
    await expect(mainWindow.locator('#mcp-status')).not.toContainText('Toegevoegd aan');
  });

  test('het commando voor Claude Code bevat de app, het script en de gegevensmap', async ({
    mainWindow,
    electronApp,
    userDataDir,
  }) => {
    await electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await open(mainWindow, electronApp);
    await mainWindow
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
      .catch(() => {});
    await mainWindow.locator('#mcp-copy').click();
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('claude mcp add agenda');
    const text = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(text).toContain("ELECTRON_RUN_AS_NODE='1'");
    expect(text).toContain(userDataDir);
    expect(text).toContain('dist/mcp.js');
  });
});
