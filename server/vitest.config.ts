import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    // Integration suites warm card-lookup indexes; first test per file can exceed 5s under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
