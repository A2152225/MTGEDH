import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    // These tests are mostly integration-style and may be slower.
    // Keep defaults otherwise.
  },
});
