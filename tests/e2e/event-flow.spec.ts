import { expect, launchApp, test } from './fixtures.ts';

test('afspraak maken, bewaren over een herstart, en verwijderen', async ({
  mainWindow,
  electronApp,
  userDataDir,
  consoleErrors,
}) => {
  // maken via snel invoeren
  await mainWindow.locator('#add').click();
  await mainWindow.locator('#q-input').fill('Tandarts morgen 14:00');
  await expect(mainWindow.locator('#q-preview')).toContainText('Tandarts');
  await mainWindow.locator('#q-input').press('Enter');

  // terug te vinden in de weekweergave en in de zijbalk
  await mainWindow.locator('[data-view="week"]').click();
  const block = mainWindow.locator('[data-okey]', { hasText: 'Tandarts' });
  await expect(block).toBeVisible();
  await expect(mainWindow.locator('#day-list')).toContainText('Tandarts');

  // bewaren: sluit af en start opnieuw met dezelfde userData
  await electronApp.close();
  const second = await launchApp(userDataDir);
  await second.window.locator('[data-view="list"]').click();
  await expect(second.window.locator('#view')).toContainText('Tandarts');

  // verwijderen: selecteren en Delete
  await second.window.locator('#view [data-okey]', { hasText: 'Tandarts' }).click();
  await second.window.keyboard.press('Delete');
  await expect(second.window.locator('#view')).not.toContainText('Tandarts');
  expect(second.consoleErrors).toEqual([]);
  await second.app.close();

  // ook na het verwijderen is het bestand bijgewerkt
  const third = await launchApp(userDataDir);
  await third.window.locator('[data-view="list"]').click();
  await expect(third.window.locator('#view')).not.toContainText('Tandarts');
  await third.app.close();
  expect(consoleErrors).toEqual([]);
});
