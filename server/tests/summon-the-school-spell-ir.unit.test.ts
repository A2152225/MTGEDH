import { describe, expect, it } from 'vitest';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isSpellEffectFullyIrWired } from '../src/state/modules/oracleIrSpellLegacyRouting.js';

const SUMMON_ORACLE =
  'Create two 1/1 blue Merfolk Wizard creature tokens.\nTap four untapped Merfolk you control: Return this card from your graveyard to your hand.';

describe('Summon the School spell resolution IR', () => {
  it('excludes the graveyard activated ability from spell-resolution steps', () => {
    const steps = collectSpellResolutionEffectSteps(SUMMON_ORACLE, 'Summon the School');
    expect(steps.map((s) => s.kind)).toEqual(['create_token']);
    expect(steps.some((s) => s.kind === 'move_zone')).toBe(false);
  });

  it('is fully IR-wired for the create-token spell effect only', () => {
    expect(isSpellEffectFullyIrWired(SUMMON_ORACLE, 'Summon the School')).toBe(true);
  });
});
