import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // alleen tests/unit: tests/e2e is van Playwright
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/logic/**/*.test.ts', 'tests/unit/main/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.ts'],
          setupFiles: ['tests/unit/renderer/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/shared/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
