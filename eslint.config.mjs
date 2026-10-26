import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.trail/',
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.stryker-tmp/',
      'release/',
      'src/renderer.js',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  // scripts en configuratiebestanden draaien in Node
  { files: ['scripts/**/*.mjs', '*.mjs'], languageOptions: { globals: { process: 'readonly' } } },
);
