import { describe, expect, it } from 'vitest';

describe('oracleIrTriggerLegacyRegexHandlers', () => {
  it('does not export retired Elspeth counter-from-among handler', async () => {
    const handlers = await import('../src/state/modules/oracleIrTriggerLegacyRegexHandlers.js');
    expect((handlers as any).applyRetiredTriggerLegacyElspethCounterFromAmong).toBeUndefined();
    expect((handlers as any).applyRetiredTriggerLegacyEnergyEffects).toBeUndefined();
  });
});
