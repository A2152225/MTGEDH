/**
 * Tests for Part 6 Batch 2 keyword abilities (Rules 702.100-702.105)
 * Evolve, Extort, Fuse, Bestow, Tribute, Dethrone
 */

import { describe, it, expect } from 'vitest';
import {
  evolve,
  shouldTriggerEvolve,
  triggerEvolve,
  getEvolutionCount,
} from '../src/keywordAbilities/evolve';
import {
  extort,
  payExtortCost,
  calculateExtortLifeGain,
  getExtortCount,
} from '../src/keywordAbilities/extort';
import {
  fuse,
  castFused,
  getFusedCost,
  isFused,
} from '../src/keywordAbilities/fuse';
import {
  bestow,
  castWithBestow,
  revertToCreature,
  isBestowed,
  getEnchantedCreature,
} from '../src/keywordAbilities/bestow';
import {
  tribute,
  payTribute,
  declineTribute,
  wasTributePaid,
  getTributeAmount,
} from '../src/keywordAbilities/tribute';
import {
  dethrone,
  shouldTriggerDethrone,
  triggerDethrone,
  getDethroneCounters,
} from '../src/keywordAbilities/dethrone';

describe('Evolve (702.100)', () => {
  it('should create evolve ability', () => {
    const ability = evolve('creature1', [2, 2]);
    
    expect(ability.type).toBe('evolve');
    expect(ability.source).toBe('creature1');
    expect(ability.powerToughness).toEqual([2, 2]);
    expect(ability.evolutionCount).toBe(0);
  });

  it('should trigger when incoming creature has greater power', () => {
    const ability = evolve('creature1', [2, 2]);
    
    expect(shouldTriggerEvolve(ability, [3, 2])).toBe(true);
    expect(shouldTriggerEvolve(ability, [3, 1])).toBe(true);
  });

  it('should trigger when incoming creature has greater toughness', () => {
    const ability = evolve('creature1', [2, 2]);
    
    expect(shouldTriggerEvolve(ability, [2, 3])).toBe(true);
    expect(shouldTriggerEvolve(ability, [1, 3])).toBe(true);
  });

  it('should not trigger when incoming creature is smaller or equal', () => {
    const ability = evolve('creature1', [2, 2]);
    
    expect(shouldTriggerEvolve(ability, [2, 2])).toBe(false);
    expect(shouldTriggerEvolve(ability, [1, 1])).toBe(false);
    expect(shouldTriggerEvolve(ability, [1, 2])).toBe(false);
    expect(shouldTriggerEvolve(ability, [2, 1])).toBe(false);
  });

  it('should add counter when triggering', () => {
    const ability = evolve('creature1', [2, 2]);
    const evolved = triggerEvolve(ability, [3, 3]);
    
    expect(evolved.powerToughness).toEqual([3, 3]);
    expect(evolved.evolutionCount).toBe(1);
  });

  it('should track evolution count', () => {
    let ability = evolve('creature1', [2, 2]);
    ability = triggerEvolve(ability, [3, 3]);
    ability = triggerEvolve(ability, [4, 4]);
    
    expect(getEvolutionCount(ability)).toBe(2);
  });
});

describe('Extort (702.101)', () => {
  it('should create extort ability', () => {
    const ability = extort('permanent1');
    
    expect(ability.type).toBe('extort');
    expect(ability.source).toBe('permanent1');
    expect(ability.timesPaid).toBe(0);
  });

  it('should track times extort paid', () => {
    let ability = extort('permanent1');
    ability = payExtortCost(ability, 3);
    
    expect(getExtortCount(ability)).toBe(1);
  });

  it('should calculate life gain correctly', () => {
    expect(calculateExtortLifeGain(2)).toBe(2); // 2 opponents
    expect(calculateExtortLifeGain(3)).toBe(3); // 3 opponents
    expect(calculateExtortLifeGain(1)).toBe(1); // 1 opponent
  });

  it('should track multiple extort payments', () => {
    let ability = extort('permanent1');
    ability = payExtortCost(ability, 2);
    ability = payExtortCost(ability, 2);
    ability = payExtortCost(ability, 2);
    
    expect(getExtortCount(ability)).toBe(3);
  });
});

describe('Fuse (702.102)', () => {
  it('should create fuse ability', () => {
    const ability = fuse('spell1', '{1}{R}', '{2}{W}');
    
    expect(ability.type).toBe('fuse');
    expect(ability.source).toBe('spell1');
    expect(ability.leftHalfCost).toBe('{1}{R}');
    expect(ability.rightHalfCost).toBe('{2}{W}');
    expect(ability.isFused).toBe(false);
  });

  it('should cast both halves when fused', () => {
    const ability = fuse('spell1', '{1}{R}', '{2}{W}');
    const fused = castFused(ability);
    
    expect(isFused(fused)).toBe(true);
  });

  it('should show combined cost', () => {
    const ability = fuse('spell1', '{1}{R}', '{2}{W}');
    
    expect(getFusedCost(ability)).toBe('{1}{R} + {2}{W}');
  });

  it('should not be fused by default', () => {
    const ability = fuse('spell1', '{1}{R}', '{2}{W}');
    
    expect(isFused(ability)).toBe(false);
  });
});

describe('Bestow (702.103)', () => {
  it('should create bestow ability', () => {
    const ability = bestow('enchantment1', '{3}{W}{W}', '{2}{W}');
    
    expect(ability.type).toBe('bestow');
    expect(ability.source).toBe('enchantment1');
    expect(ability.bestowCost).toBe('{3}{W}{W}');
    expect(ability.normalCost).toBe('{2}{W}');
    expect(ability.isBestowed).toBe(false);
  });

  it('should become Aura when cast with bestow', () => {
    const ability = bestow('enchantment1', '{3}{W}{W}', '{2}{W}');
    const bestowed = castWithBestow(ability, 'creature1');
    
    expect(isBestowed(bestowed)).toBe(true);
    expect(getEnchantedCreature(bestowed)).toBe('creature1');
  });

  it('should revert to creature when unattached', () => {
    const ability = bestow('enchantment1', '{3}{W}{W}', '{2}{W}');
    const bestowed = castWithBestow(ability, 'creature1');
    const reverted = revertToCreature(bestowed);
    
    expect(isBestowed(reverted)).toBe(false);
    expect(getEnchantedCreature(reverted)).toBeUndefined();
  });

  it('should not be bestowed by default', () => {
    const ability = bestow('enchantment1', '{3}{W}{W}', '{2}{W}');
    
    expect(isBestowed(ability)).toBe(false);
    expect(getEnchantedCreature(ability)).toBeUndefined();
  });
});

describe('Tribute (702.104)', () => {
  it('should create tribute ability', () => {
    const ability = tribute('creature1', 3, 'opponent1');
    
    expect(ability.type).toBe('tribute');
    expect(ability.source).toBe('creature1');
    expect(ability.tributeAmount).toBe(3);
    expect(ability.chosenOpponent).toBe('opponent1');
    expect(ability.tributePaid).toBe(false);
  });

  it('should track if tribute was paid', () => {
    const ability = tribute('creature1', 2, 'opponent1');
    const paid = payTribute(ability);
    
    expect(wasTributePaid(paid)).toBe(true);
    expect(getTributeAmount(paid)).toBe(2);
  });

  it('should track if tribute was declined', () => {
    const ability = tribute('creature1', 2, 'opponent1');
    const declined = declineTribute(ability);
    
    expect(wasTributePaid(declined)).toBe(false);
  });

  it('should have correct amount', () => {
    const ability = tribute('creature1', 4, 'opponent1');
    
    expect(getTributeAmount(ability)).toBe(4);
  });
});

describe('Dethrone (702.105)', () => {
  it('should create dethrone ability', () => {
    const ability = dethrone('creature1');
    
    expect(ability.type).toBe('dethrone');
    expect(ability.source).toBe('creature1');
    expect(ability.countersPut).toBe(0);
  });

  it('should trigger when attacking player with most life', () => {
    const playerLives = [20, 15, 18];
    
    expect(shouldTriggerDethrone(20, playerLives)).toBe(true);
    expect(shouldTriggerDethrone(15, playerLives)).toBe(false);
    expect(shouldTriggerDethrone(18, playerLives)).toBe(false);
  });

  it('should trigger when attacking player tied for most life', () => {
    const playerLives = [20, 20, 15];
    
    expect(shouldTriggerDethrone(20, playerLives)).toBe(true);
  });

  it('should add counter when triggering', () => {
    const ability = dethrone('creature1');
    const triggered = triggerDethrone(ability);
    
    expect(getDethroneCounters(triggered)).toBe(1);
  });

  it('should track multiple triggers', () => {
    let ability = dethrone('creature1');
    ability = triggerDethrone(ability);
    ability = triggerDethrone(ability);
    ability = triggerDethrone(ability);
    
    expect(getDethroneCounters(ability)).toBe(3);
  });
});
