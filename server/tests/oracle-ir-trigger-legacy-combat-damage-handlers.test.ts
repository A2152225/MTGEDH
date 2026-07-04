import { describe, expect, it } from 'vitest';

describe('oracleIrTriggerLegacyCombatDamageHandlers', () => {
  it('no longer exports combat-damage draw legacy handler', async () => {
    await expect(import('../src/state/modules/oracleIrTriggerLegacyCombatDamageHandlers.js')).rejects.toThrow();
  });
});
