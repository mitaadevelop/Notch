import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, launchApp, test } from './fixtures.ts';

// Ruime drempel: een gewone start duurt ~1 s; CI-machines (vooral Windows) zijn trager. Aan te passen via de omgeving.
const STARTUP_BUDGET_MS = Number(process.env.STARTUP_BUDGET_MS ?? 8000);

test.describe('opstarttijd', () => {
  test(`van launch tot het eerste zichtbare scherm < ${STARTUP_BUDGET_MS} ms`, async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'agenda-perf-')));
    const started = Date.now();
    const { app, window } = await launchApp(dir);
    try {
      await expect(window.locator('#view [data-key]').first()).toBeVisible({ timeout: STARTUP_BUDGET_MS });
      const elapsed = Date.now() - started;
      test.info().annotations.push({ type: 'opstarttijd', description: `${elapsed} ms` });
      console.log(`opstarttijd: ${elapsed} ms (drempel ${STARTUP_BUDGET_MS} ms)`);
      expect(elapsed).toBeLessThan(STARTUP_BUDGET_MS);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('geheugen', () => {
  // Geen harde drempel (afgesproken): de test toont alleen het verschil, zodat een lek zichtbaar wordt.
  test('een kernflow 25 keer herhalen: geheugen van main en renderer vóór en na', async ({ userDataDir }) => {
    test.setTimeout(120_000);
    // met --expose-gc kunnen we vóór elke meting afval opruimen: wat blijft staan is geen afval maar een lek
    const { app: electronApp, window: mainWindow } = await launchApp(userDataDir, ['--js-flags=--expose-gc']);
    const collect = async () => {
      await mainWindow.evaluate('gc(); gc();');
      await mainWindow.waitForTimeout(300);
    };
    const snapshot = async () => {
      await collect();
      return electronApp.evaluate(({ app }) => {
        const mb = (kb: number) => Math.round((kb / 1024) * 10) / 10;
        const sum = (types: string[]) =>
          mb(
            app
              .getAppMetrics()
              .filter((m) => types.includes(m.type))
              .reduce((total, m) => total + m.memory.workingSetSize, 0),
          );
        return { main: sum(['Browser']), renderer: sum(['Tab']), total: sum(app.getAppMetrics().map((m) => m.type)) };
      });
    };

    // opwarmen, zodat eenmalige allocaties niet als groei tellen
    const round = async (i: number) => {
      await mainWindow.locator('#add').click();
      await mainWindow.locator('#q-input').fill(`Geheugentest ${i} 10:00`);
      await mainWindow.locator('#q-input').press('Enter');
      await mainWindow.locator('[data-view="week"]').click();
      await mainWindow.locator('#view [data-okey]', { hasText: `Geheugentest ${i}` }).click();
      await mainWindow.keyboard.press('Delete');
      await expect(mainWindow.locator('#view')).not.toContainText(`Geheugentest ${i}`);
      await mainWindow.locator('[data-view="month"]').click();
    };
    for (let i = 0; i < 3; i++) await round(i);

    const before = await snapshot();
    for (let i = 3; i < 28; i++) await round(i);
    const after = await snapshot();

    const delta = {
      main: after.main - before.main,
      renderer: after.renderer - before.renderer,
      total: after.total - before.total,
    };
    const table = { vóór: before, na: after, verschil: delta };
    console.log('geheugen (MB, working set)');
    console.table(table);
    await test
      .info()
      .attach('geheugen.json', { body: JSON.stringify(table, null, 2), contentType: 'application/json' });
    test.info().annotations.push({ type: 'geheugenverschil (MB)', description: JSON.stringify(delta) });
    expect(before.total).toBeGreaterThan(0);
    await electronApp.close();
  });
});
