import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    // Integration suites warm card-lookup indexes; first worker may rebuild from oracle-cards.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
