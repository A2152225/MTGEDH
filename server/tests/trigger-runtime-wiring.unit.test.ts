import { describe, expect, it } from 'vitest';

import {
  collectOracleEffectSteps,
  getTriggerRuntimeWiringGaps,
  isSupportedCopyPermanentTriggerPattern,
  isTriggerStepRuntimeWired,
  parseTriggerEffectSteps,
} from '../src/state/modules/trigger-runtime-wiring.js';

describe('trigger runtime wiring assessment', () => {
  it('treats Cryptoplasm upkeep copy as wired', () => {
    const effect =
      'you may have this creature become a copy of another target creature, except it has this ability';
    const steps = parseTriggerEffectSteps(effect, 'Cryptoplasm');

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'copy_permanent',
        retainAbilityText: 'it has this ability',
      }),
    ]);
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
    expect(isTriggerStepRuntimeWired(steps[0]!)).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Cryptoplasm')).toEqual([]);
    expect(collectOracleEffectSteps(effect, 'Cryptoplasm')).toEqual(steps);
  });

  it('flags optional draw triggers that parse but lack runtime handlers', () => {
    const effect = 'you may draw a card';
    const steps = parseTriggerEffectSteps(effect, 'Sample Card');

    expect(steps.some(step => step.kind === 'draw')).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Sample Card')).toContain('draw (optional)');
  });

  it('does not flag effects outside the oracle IR fallback surface area', () => {
    const effect = "put the cards exiled with it into their owner's hand";
    expect(getTriggerRuntimeWiringGaps(effect, 'Solemn Simulacrum')).toEqual([]);
  });
});
