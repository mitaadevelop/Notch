// Mutation testing: optioneel en traag, dus niet in `check` en niet in CI. Starten met `npm run test:mutation`.
// Beperkt tot de twee kernmodules met de meeste logica; breid `mutate` uit om meer te meten.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mts' },
  mutate: ['src/js/occurrences.ts', 'src/js/model.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
