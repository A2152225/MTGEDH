import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    // Integration suites warm card-lookup indexes; first worker may rebuild from oracle-cards.
    // Several live-flow suites (ai-resolution-step, warp-world choice, precon-live-e2e, bulk mana tapping,
    // attack-tax, loop shortcuts) take 60-125s when the whole suite runs in parallel; 120s flaked.
    testTimeout: 300_000,
    hookTimeout: 180_000,
  },
});
