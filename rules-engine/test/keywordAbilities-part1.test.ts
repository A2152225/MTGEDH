/**
 * Tests for Keyword Abilities (Rule 702) - Part 1
 * 
 * Covers Rules 702.2-702.20 (basic keyword abilities)
 */

import { describe, it, expect } from 'vitest';
import {
  deathtouch,
  shouldDestroyFromDeathtouch,
  isLethalDamageWithDeathtouch,
  hasRedundantDeathtouch,
} from '../src/keywordAbilities/deathtouch';
import {
  defender,
  canAttackWithDefender,
  hasRedundantDefender,
} from '../src/keywordAbilities/defender';
import {
  doubleStrike,
  dealsFirstStrikeDamage,
  dealsSecondStrikeDamage,
  preventsSecondStrike,
  hasRedundantDoubleStrike,
} from '../src/keywordAbilities/doubleStrike';
import {
  firstStrike,
  hasRedundantFirstStrike,
} from '../src/keywordAbilities/firstStrike';
import {
  flash,
  canCastWithFlash,
  hasRedundantFlash,
} from '../src/keywordAbilities/flash';
import {
  flying,
  canBlockFlying,
  hasRedundantFlying,
} from '../src/keywordAbilities/flying';
import {
  haste,
  canAttackWithHaste,
  canActivateTapAbilitiesWithHaste,
  hasRedundantHaste,
} from '../src/keywordAbilities/haste';
import {
  hexproof,
  canTargetPermanentWithHexproof,
  canTargetPlayerWithHexproof,
  canTargetWithHexproofFrom,
  hasRedundantHexproof,
} from '../src/keywordAbilities/hexproof';
import {
  indestructible,
  canBeDestroyed,
  destroyedByLethalDamage,
  hasRedundantIndestructible,
} from '../src/keywordAbilities/indestructible';
import {
  lifelink,
  calculateLifelinkGain,
  hasRedundantLifelink,
} from '../src/keywordAbilities/lifelink';
import {
  reach,
  canBlockFlyingWithReach,
  hasRedundantReach,
} from '../src/keywordAbilities/reach';
import {
  trample,
  calculateTrampleDamage,
  assignsToPlayerWithNoBlockers,
  hasRedundantTrample,
} from '../src/keywordAbilities/trample';
import {
  vigilance,
  tapsWhenAttacking,
  hasRedundantVigilance,
} from '../src/keywordAbilities/vigilance';

describe('Deathtouch (Rule 702.2)', () => {
  it('should create a deathtouch ability', () => {
    const ability = deathtouch('creature1');
    expect(ability.type).toBe('deathtouch');
    expect(ability.source).toBe('creature1');
  });

  it('should destroy creature with any deathtouch damage', () => {
    expect(shouldDestroyFromDeathtouch(3, 1)).toBe(true);
    expect(shouldDestroyFromDeathtouch(10, 1)).toBe(true);
  });

  it('should not destroy creature with 0 toughness or no damage', () => {
    expect(shouldDestroyFromDeathtouch(0, 1)).toBe(false);
    expect(shouldDestroyFromDeathtouch(3, 0)).toBe(false);
  });

  it('should consider any nonzero damage lethal with deathtouch', () => {
    expect(isLethalDamageWithDeathtouch(1, true)).toBe(true);
    expect(isLethalDamageWithDeathtouch(0, true)).toBe(false);
    expect(isLethalDamageWithDeathtouch(5, false)).toBe(false);
  });

  it('should detect redundant deathtouch', () => {
    const abilities = [deathtouch('source1'), deathtouch('source2')];
    expect(hasRedundantDeathtouch(abilities)).toBe(true);
  });
});

describe('Defender (Rule 702.3)', () => {
  it('should create a defender ability', () => {
    const ability = defender('creature1');
    expect(ability.type).toBe('defender');
    expect(ability.source).toBe('creature1');
  });

  it('should prevent creature with defender from attacking', () => {
    expect(canAttackWithDefender(true)).toBe(false);
    expect(canAttackWithDefender(false)).toBe(true);
  });

  it('should detect redundant defender', () => {
    const abilities = [defender('source1'), defender('source2')];
    expect(hasRedundantDefender(abilities)).toBe(true);
  });
});

describe('Double Strike (Rule 702.4)', () => {
  it('should create a double strike ability', () => {
    const ability = doubleStrike('creature1');
    expect(ability.type).toBe('doubleStrike');
    expect(ability.source).toBe('creature1');
  });

  it('should deal damage in first strike step', () => {
    expect(dealsFirstStrikeDamage(true, false)).toBe(true);
    expect(dealsFirstStrikeDamage(false, true)).toBe(true);
    expect(dealsFirstStrikeDamage(false, false)).toBe(false);
  });

  it('should deal damage in second strike step', () => {
    expect(dealsSecondStrikeDamage(true, false, true)).toBe(true);
    expect(dealsSecondStrikeDamage(false, true, true)).toBe(false);
    expect(dealsSecondStrikeDamage(false, false, false)).toBe(true);
  });

  it('should prevent second strike if double strike removed', () => {
    expect(preventsSecondStrike(true, false, true)).toBe(true);
    expect(preventsSecondStrike(true, true, true)).toBe(false);
  });

  it('should detect redundant double strike', () => {
    const abilities = [doubleStrike('source1'), doubleStrike('source2')];
    expect(hasRedundantDoubleStrike(abilities)).toBe(true);
  });
});

describe('First Strike (Rule 702.7)', () => {
  it('should create a first strike ability', () => {
    const ability = firstStrike('creature1');
    expect(ability.type).toBe('firstStrike');
    expect(ability.source).toBe('creature1');
  });

  it('should detect redundant first strike', () => {
    const abilities = [firstStrike('source1'), firstStrike('source2')];
    expect(hasRedundantFirstStrike(abilities)).toBe(true);
  });
});

describe('Flash (Rule 702.8)', () => {
  it('should create a flash ability', () => {
    const ability = flash('spell1');
    expect(ability.type).toBe('flash');
    expect(ability.source).toBe('spell1');
  });

  it('should allow casting at instant speed', () => {
    expect(canCastWithFlash(true, true)).toBe(true);
    expect(canCastWithFlash(true, false)).toBe(false);
    expect(canCastWithFlash(false, true)).toBe(false);
  });

  it('should detect redundant flash', () => {
    const abilities = [flash('source1'), flash('source2')];
    expect(hasRedundantFlash(abilities)).toBe(true);
  });
});

describe('Flying (Rule 702.9)', () => {
  it('should create a flying ability', () => {
    const ability = flying('creature1');
    expect(ability.type).toBe('flying');
    expect(ability.source).toBe('creature1');
  });

  it('should allow blocking flying with flying or reach', () => {
    expect(canBlockFlying(true, false, true)).toBe(true);
    expect(canBlockFlying(false, true, true)).toBe(true);
    expect(canBlockFlying(false, false, true)).toBe(false);
    expect(canBlockFlying(false, false, false)).toBe(true);
  });

  it('should detect redundant flying', () => {
    const abilities = [flying('source1'), flying('source2')];
    expect(hasRedundantFlying(abilities)).toBe(true);
  });
});

describe('Haste (Rule 702.10)', () => {
  it('should create a haste ability', () => {
    const ability = haste('creature1');
    expect(ability.type).toBe('haste');
    expect(ability.source).toBe('creature1');
  });

  it('should allow attacking without summoning sickness', () => {
    expect(canAttackWithHaste(true, false)).toBe(true);
    expect(canAttackWithHaste(false, true)).toBe(true);
    expect(canAttackWithHaste(false, false)).toBe(false);
  });

  it('should allow tap abilities without summoning sickness', () => {
    expect(canActivateTapAbilitiesWithHaste(true, false)).toBe(true);
    expect(canActivateTapAbilitiesWithHaste(false, true)).toBe(true);
    expect(canActivateTapAbilitiesWithHaste(false, false)).toBe(false);
  });

  it('should detect redundant haste', () => {
    const abilities = [haste('source1'), haste('source2')];
    expect(hasRedundantHaste(abilities)).toBe(true);
  });
});

describe('Hexproof (Rule 702.11)', () => {
  it('should create a hexproof ability', () => {
    const ability = hexproof('permanent1');
    expect(ability.type).toBe('hexproof');
    expect(ability.source).toBe('permanent1');
  });

  it('should create hexproof from quality ability', () => {
    const ability = hexproof('permanent1', 'blue');
    expect(ability.quality).toBe('blue');
  });

  it('should prevent targeting by opponents', () => {
    expect(canTargetPermanentWithHexproof(true, true)).toBe(false);
    expect(canTargetPermanentWithHexproof(true, false)).toBe(true);
    expect(canTargetPermanentWithHexproof(false, true)).toBe(true);
  });

  it('should prevent player targeting by opponents', () => {
    expect(canTargetPlayerWithHexproof(true, true)).toBe(false);
    expect(canTargetPlayerWithHexproof(true, false)).toBe(true);
  });

  it('should handle hexproof from quality', () => {
    expect(canTargetWithHexproofFrom('blue', 'blue', 'blue', true)).toBe(false);
    expect(canTargetWithHexproofFrom('blue', 'red', 'red', true)).toBe(true);
    expect(canTargetWithHexproofFrom('blue', 'blue', 'red', false)).toBe(true);
  });

  it('should detect redundant hexproof', () => {
    const abilities = [hexproof('source1'), hexproof('source2')];
    expect(hasRedundantHexproof(abilities)).toBe(true);
  });
});

describe('Indestructible (Rule 702.12)', () => {
  it('should create an indestructible ability', () => {
    const ability = indestructible('permanent1');
    expect(ability.type).toBe('indestructible');
    expect(ability.source).toBe('permanent1');
  });

  it('should prevent destruction', () => {
    expect(canBeDestroyed(true)).toBe(false);
    expect(canBeDestroyed(false)).toBe(true);
  });

  it('should prevent destruction from lethal damage', () => {
    expect(destroyedByLethalDamage(true, true)).toBe(false);
    expect(destroyedByLethalDamage(false, true)).toBe(true);
    expect(destroyedByLethalDamage(false, false)).toBe(false);
  });

  it('should detect redundant indestructible', () => {
    const abilities = [indestructible('source1'), indestructible('source2')];
    expect(hasRedundantIndestructible(abilities)).toBe(true);
  });
});

describe('Lifelink (Rule 702.15)', () => {
  it('should create a lifelink ability', () => {
    const ability = lifelink('creature1');
    expect(ability.type).toBe('lifelink');
    expect(ability.source).toBe('creature1');
  });

  it('should calculate life gain from damage', () => {
    expect(calculateLifelinkGain(5, true)).toBe(5);
    expect(calculateLifelinkGain(5, false)).toBe(0);
    expect(calculateLifelinkGain(0, true)).toBe(0);
  });

  it('should detect redundant lifelink', () => {
    const abilities = [lifelink('source1'), lifelink('source2')];
    expect(hasRedundantLifelink(abilities)).toBe(true);
  });
});

describe('Reach (Rule 702.17)', () => {
  it('should create a reach ability', () => {
    const ability = reach('creature1');
    expect(ability.type).toBe('reach');
    expect(ability.source).toBe('creature1');
  });

  it('should allow blocking flying creatures', () => {
    expect(canBlockFlyingWithReach(true, true)).toBe(true);
    expect(canBlockFlyingWithReach(false, true)).toBe(false);
    expect(canBlockFlyingWithReach(false, false)).toBe(true);
  });

  it('should detect redundant reach', () => {
    const abilities = [reach('source1'), reach('source2')];
    expect(hasRedundantReach(abilities)).toBe(true);
  });
});

describe('Trample (Rule 702.19)', () => {
  it('should create a trample ability', () => {
    const ability = trample('creature1');
    expect(ability.type).toBe('trample');
    expect(ability.source).toBe('creature1');
  });

  it('should calculate trample damage correctly', () => {
    const result1 = calculateTrampleDamage(10, 3);
    expect(result1.blockerDamage).toBe(3);
    expect(result1.excessDamage).toBe(7);

    const result2 = calculateTrampleDamage(5, 10);
    expect(result2.blockerDamage).toBe(5);
    expect(result2.excessDamage).toBe(0);
  });

  it('should assign to player if no blockers', () => {
    expect(assignsToPlayerWithNoBlockers(true, false)).toBe(true);
    expect(assignsToPlayerWithNoBlockers(true, true)).toBe(false);
    expect(assignsToPlayerWithNoBlockers(false, false)).toBe(false);
  });

  it('should detect redundant trample', () => {
    const abilities = [trample('source1'), trample('source2')];
    expect(hasRedundantTrample(abilities)).toBe(true);
  });
});

describe('Vigilance (Rule 702.20)', () => {
  it('should create a vigilance ability', () => {
    const ability = vigilance('creature1');
    expect(ability.type).toBe('vigilance');
    expect(ability.source).toBe('creature1');
  });

  it('should prevent tapping when attacking', () => {
    expect(tapsWhenAttacking(true)).toBe(false);
    expect(tapsWhenAttacking(false)).toBe(true);
  });

  it('should detect redundant vigilance', () => {
    const abilities = [vigilance('source1'), vigilance('source2')];
    expect(hasRedundantVigilance(abilities)).toBe(true);
  });
});
