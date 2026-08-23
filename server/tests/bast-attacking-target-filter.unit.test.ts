import { describe, expect, it } from 'vitest';

import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import {
  matchesTriggeredBattlefieldTarget,
  matchesTriggeredCombatRole,
} from '../src/state/modules/triggeredAbilityBattlefieldTargetMatch.js';

describe('Bast attacking-only triggered target filter', () => {
  const bastEffect =
    'target attacking creature gets +X/+X until end of turn, where X is the number of creatures you control.';

  it('infers targetCombatRole=attacking for Bast-style target noun phrase', () => {
    const meta = inferTriggeredAbilityTargetMetadata(bastEffect);
    expect(meta.requiresTarget).toBe(true);
    expect(meta.targetType).toBe('creature');
    expect(meta.targetCombatRole).toBe('attacking');
    // Must not treat "creatures you control" X-definition as you-control target constraint.
    expect(meta.targetConstraint).toBeUndefined();
  });

  it('filters non-attacking creatures out of battlefield target legality', () => {
    const meta = inferTriggeredAbilityTargetMetadata(bastEffect);
    const attacker = {
      id: 'atk',
      attacking: 'p2',
      card: { type_line: 'Creature — Soldier' },
    };
    const bench = {
      id: 'bench',
      card: { type_line: 'Creature — Soldier' },
    };

    expect(
      matchesTriggeredBattlefieldTarget(
        'creature',
        'creature — soldier',
        { targetCombatRole: meta.targetCombatRole },
        attacker,
      ),
    ).toBe(true);
    expect(
      matchesTriggeredBattlefieldTarget(
        'creature',
        'creature — soldier',
        { targetCombatRole: meta.targetCombatRole },
        bench,
      ),
    ).toBe(false);
    expect(matchesTriggeredCombatRole(bench, 'attacking')).toBe(false);
  });
});
