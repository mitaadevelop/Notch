import { defineConfig } from '@playwright/test';

// De app laadt zijn pagina met loadFile uit dist/, dus er is geen dev-server (webServer) nodig:
// `npm run test:e2e` bouwt eerst en test dan tegen die build.
export default defineConfig({
  testDir: 'tests/e2e',
  // Electron-vensters delen de machine (focus, notificaties): één voor één draaien
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // 'dot': één teken per test (· geslaagd, F mislukt, × overgeslagen) zodat je de voortgang ziet zonder een muur van tekst
  reporter: [['dot'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { trace: 'on-first-retry' },
});
