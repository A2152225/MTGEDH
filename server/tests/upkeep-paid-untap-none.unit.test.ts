import { describe, it, expect } from 'vitest';
import { resolveUpkeepPaidUntapSelection } from '../src/state/modules/upkeepPaidUntapPrompt.js';
import { inferResolutionStepMandatory } from '../src/state/resolution/mandatoryInference.js';

describe('Magnetic Mountain paid untap: choosing none pays nothing', () => {
  const mk = () => ({
    players: [{ id: 'p1' }],
    manaPool: { p1: { colorless: 4 } },
    battlefield: [
      { id: 'c1', controller: 'p1', tapped: true, card: { name: 'Bear', type_line: 'Creature' } },
      { id: 'l1', controller: 'p1', tapped: false, card: { name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '{T}: Add {R}.' } },
    ],
  });
  const step = { upkeepPaidUntapSelection: true, upkeepPaidUntapCostPerCreature: 4, validTargets: [{ id: 'c1' }], mandatory: false, minTargets: 0 };
  it('empty selection is a no-op', () => {
    const s: any = mk();
    expect(resolveUpkeepPaidUntapSelection(s, step, 'p1', [])).toEqual({ untapped: [], paid: 0, tappedForMana: [] });
    expect(s.battlefield[0].tapped).toBe(true);
    expect(s.battlefield[1].tapped).toBe(false);
    expect(s.manaPool.p1.colorless).toBe(4);
  });
  it('step is optional so cancelResolutionStep is allowed', () => {
    expect(inferResolutionStepMandatory(step as any)).toBe(false);
  });
});
