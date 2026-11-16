import { describe, expect, it } from 'vitest';
import {
  applyChosenPayLifeReplacement,
  listPayLifeReplacementCandidates,
} from '../src/state/modules/payLifeReplacementOrder.js';

function stateWithTwoPayLifeReplacements() {
  return {
    _replacementEffectSpecs: [
      {
        id: 'ashiok:perm-a',
        effectId: 'pay-life-exile-library-top',
        event: 'life-payment',
        sourceName: 'Ashiok, Wicked Manipulator',
        sourcePermanentId: 'perm-a',
        controllerId: 'p1',
      },
      {
        id: 'other:perm-b',
        effectId: 'pay-life-lose-life-instead',
        event: 'life-payment',
        sourceName: 'Test Replacement',
        sourcePermanentId: 'perm-b',
        controllerId: 'p1',
      },
    ],
  };
}

describe('pay-life CR 616.1 replacement order', () => {
  it('lists both life-payment replacements when they would apply together', () => {
    const candidates = listPayLifeReplacementCandidates(stateWithTwoPayLifeReplacements(), 'p1', 2);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.effectId).sort()).toEqual([
      'pay-life-exile-library-top',
      'pay-life-lose-life-instead',
    ].sort());
  });

  it('applies the chosen replacement first and leaves the other remaining', () => {
    const state = stateWithTwoPayLifeReplacements();
    const applied: string[] = [];
    const result = applyChosenPayLifeReplacement({
      state,
      playerId: 'p1',
      amount: 2,
      chosenId: 'other:perm-b',
      applyCandidate: (candidate) => applied.push(candidate.effectId),
    });
    expect(result.applied).toBe(true);
    expect(result.chosen?.effectId).toBe('pay-life-lose-life-instead');
    expect(applied).toEqual(['pay-life-lose-life-instead']);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].effectId).toBe('pay-life-exile-library-top');
  });

  it('does not invent a second candidate when only Ashiok applies', () => {
    const state = {
      _replacementEffectSpecs: [stateWithTwoPayLifeReplacements()._replacementEffectSpecs[0]],
    };
    expect(listPayLifeReplacementCandidates(state, 'p1', 2)).toHaveLength(1);
  });
});
