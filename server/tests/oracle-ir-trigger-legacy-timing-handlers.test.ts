import { describe, expect, it } from 'vitest';

describe('oracleIrTriggerLegacyTimingHandlers', () => {
  it('module removed after delayed draw retirement to IR bridge', async () => {
    await expect(import('../src/state/modules/oracleIrTriggerLegacyTimingHandlers.js')).rejects.toThrow();
  });
});
