/**
 * Tests for alternate costs module
 */
import { describe, it, expect } from 'vitest';
import {
  createJodahCost,
  createMorophonReduction,
  createPitchCost,
  createEvokeCost,
  createDashCost,
  createFlashbackCost,
  applyCostReduction,
  getTotalManaValue,
  isCostZero,
  creatureTypeMatchesCondition,
  getApplicableCostReductions,
  calculateFinalCost,
  canPayPitchCost,
  AlternateCostType,
  WUBRG_COST,
  MOROPHON_REDUCTION,
} from '../src/alternateCosts';
import type { ManaCost } from '../src/types/mana';

describe('Alternate Costs', () => {
  describe('createJodahCost', () => {
    it('should create WUBRG alternative cost', () => {
      const cost = createJodahCost('Jodah, Archmage Eternal', 'jodah-123');
      
      expect(cost.type).toBe(AlternateCostType.WUBRG);
      expect(cost.manaCost).toEqual(WUBRG_COST);
      expect(cost.sourceName).toBe('Jodah, Archmage Eternal');
      expect(cost.sourceId).toBe('jodah-123');
    });
  });

  describe('createMorophonReduction', () => {
    it('should create reduction for chosen creature type', () => {
      const reduction = createMorophonReduction('Merfolk', 'morophon-123');
      
      expect(reduction.sourceName).toBe('Morophon, the Boundless');
      expect(reduction.condition?.type).toBe('creature_type');
      expect(reduction.condition?.value).toBe('Merfolk');
      expect(reduction.reduction).toEqual(MOROPHON_REDUCTION);
    });
  });

  describe('createPitchCost', () => {
    it('should create Force of Will style pitch cost', () => {
      const cost = createPitchCost('Force of Will', 'blue card', 1);
      
      expect(cost.type).toBe(AlternateCostType.PITCH);
      expect(cost.lifeCost).toBe(1);
      expect(cost.requiresExile?.zone).toBe('hand');
      expect(cost.requiresExile?.count).toBe(1);
      expect(cost.requiresExile?.filter).toBe('blue card');
    });
  });

  describe('createEvokeCost', () => {
    it('should create evoke cost with sacrifice effect', () => {
      const evokeCost: ManaCost = { red: 1 };
      const cost = createEvokeCost('Fury', evokeCost);
      
      expect(cost.type).toBe(AlternateCostType.EVOKE);
      expect(cost.manaCost).toEqual(evokeCost);
      expect(cost.additionalEffects).toContain('Sacrifice when it enters the battlefield');
    });
  });

  describe('createDashCost', () => {
    it('should create dash cost with haste and return effects', () => {
      const dashCost: ManaCost = { red: 2, black: 1 };
      const cost = createDashCost('Ragavan, Nimble Pilferer', dashCost);
      
      expect(cost.type).toBe(AlternateCostType.DASH);
      expect(cost.manaCost).toEqual(dashCost);
      expect(cost.additionalEffects).toContain('Haste');
      expect(cost.additionalEffects).toContain('Return to hand at end of turn');
    });
  });

  describe('createFlashbackCost', () => {
    it('should create flashback cost with exile effect', () => {
      const flashbackCost: ManaCost = { white: 1 };
      const cost = createFlashbackCost('Unburial Rites', flashbackCost);
      
      expect(cost.type).toBe(AlternateCostType.FLASHBACK);
      expect(cost.manaCost).toEqual(flashbackCost);
      expect(cost.additionalEffects).toContain('Exile after resolving');
    });
  });

  describe('applyCostReduction', () => {
    it('should reduce colored mana costs', () => {
      const original: ManaCost = { white: 2, blue: 1, generic: 3 };
      const reduction: ManaCost = { white: 1, blue: 1 };
      
      const result = applyCostReduction(original, reduction);
      
      expect(result.white).toBe(1);
      expect(result.blue).toBe(0);
      expect(result.generic).toBe(3);
    });

    it('should apply excess reduction to generic', () => {
      const original: ManaCost = { white: 1, generic: 3 };
      const reduction: ManaCost = { white: 2 }; // 1 excess
      
      const result = applyCostReduction(original, reduction);
      
      expect(result.white).toBe(0);
      expect(result.generic).toBe(2); // 3 - 1 excess = 2
    });

    it('should apply Morophon reduction correctly', () => {
      // A spell costing {3}{W}{W}{U}
      const original: ManaCost = { white: 2, blue: 1, generic: 3 };
      // Morophon reduces {W}{U}{B}{R}{G}
      const result = applyCostReduction(original, MOROPHON_REDUCTION);
      
      expect(result.white).toBe(1); // 2 - 1 = 1
      expect(result.blue).toBe(0);  // 1 - 1 = 0
      // Excess: 1 black + 1 red + 1 green = 3 applied to generic
      expect(result.generic).toBe(0); // 3 - 3 = 0
    });
  });

  describe('getTotalManaValue', () => {
    it('should sum all mana components', () => {
      const cost: ManaCost = { white: 1, blue: 2, generic: 3, colorless: 1 };
      
      expect(getTotalManaValue(cost)).toBe(7);
    });

    it('should handle empty cost', () => {
      const cost: ManaCost = {};
      
      expect(getTotalManaValue(cost)).toBe(0);
    });
  });

  describe('isCostZero', () => {
    it('should return true for zero cost', () => {
      const cost: ManaCost = {};
      
      expect(isCostZero(cost)).toBe(true);
    });

    it('should return false for non-zero cost', () => {
      const cost: ManaCost = { generic: 1 };
      
      expect(isCostZero(cost)).toBe(false);
    });
  });

  describe('creatureTypeMatchesCondition', () => {
    it('should match exact creature type', () => {
      expect(creatureTypeMatchesCondition(['Merfolk', 'Wizard'], false, 'Merfolk')).toBe(true);
      expect(creatureTypeMatchesCondition(['Merfolk', 'Wizard'], false, 'Goblin')).toBe(false);
    });

    it('should always match for changelings', () => {
      expect(creatureTypeMatchesCondition(['Shapeshifter'], true, 'Merfolk')).toBe(true);
      expect(creatureTypeMatchesCondition(['Shapeshifter'], true, 'Dragon')).toBe(true);
      expect(creatureTypeMatchesCondition([], true, 'Goblin')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(creatureTypeMatchesCondition(['Merfolk'], false, 'merfolk')).toBe(true);
      expect(creatureTypeMatchesCondition(['MERFOLK'], false, 'Merfolk')).toBe(true);
    });
  });

  describe('getApplicableCostReductions', () => {
    it('should return matching reductions', () => {
      const reductions = [
        createMorophonReduction('Merfolk', 'morophon-1'),
        createMorophonReduction('Goblin', 'morophon-2'),
      ];
      
      const applicable = getApplicableCostReductions(reductions, {
        types: ['Creature'],
        creatureTypes: ['Merfolk', 'Wizard'],
      });
      
      expect(applicable).toHaveLength(1);
      expect(applicable[0].condition?.value).toBe('Merfolk');
    });

    it('should match changelings to any creature type', () => {
      const reductions = [
        createMorophonReduction('Dragon', 'morophon-1'),
      ];
      
      const applicable = getApplicableCostReductions(reductions, {
        types: ['Creature'],
        creatureTypes: ['Shapeshifter'],
        hasChangeling: true,
      });
      
      expect(applicable).toHaveLength(1);
    });
  });

  describe('calculateFinalCost', () => {
    it('should apply multiple reductions', () => {
      const original: ManaCost = { white: 2, blue: 2, generic: 4 };
      const reductions = [
        { id: '1', sourceId: 's1', sourceName: 'Source 1', reduction: { white: 1 } as ManaCost, appliesTo: 'all' as const },
        { id: '2', sourceId: 's2', sourceName: 'Source 2', reduction: { blue: 1 } as ManaCost, appliesTo: 'all' as const },
      ];
      
      const result = calculateFinalCost(original, reductions);
      
      expect(result.white).toBe(1);
      expect(result.blue).toBe(1);
    });
  });

  describe('canPayPitchCost', () => {
    it('should allow payment with sufficient resources', () => {
      const cost = createPitchCost('Force of Will', 'blue card', 1);
      const handCards = [
        { id: '1', colors: ['U'] },
        { id: '2', colors: ['R'] },
      ];
      
      const result = canPayPitchCost(cost, 10, handCards, 'blue card');
      
      expect(result.canPay).toBe(true);
      expect(result.eligibleCards).toContain('1');
    });

    it('should reject when insufficient life', () => {
      const cost = createPitchCost('Force of Will', 'blue card', 1);
      const handCards = [{ id: '1', colors: ['U'] }];
      
      const result = canPayPitchCost(cost, 0, handCards, 'blue card');
      
      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('life');
    });

    it('should reject when no matching cards', () => {
      const cost = createPitchCost('Force of Will', 'blue card', 1);
      const handCards = [{ id: '1', colors: ['R'] }];
      
      const result = canPayPitchCost(cost, 10, handCards, 'blue card');
      
      expect(result.canPay).toBe(false);
    });
  });

  describe('WUBRG_COST', () => {
    it('should have one of each color', () => {
      expect(WUBRG_COST.white).toBe(1);
      expect(WUBRG_COST.blue).toBe(1);
      expect(WUBRG_COST.black).toBe(1);
      expect(WUBRG_COST.red).toBe(1);
      expect(WUBRG_COST.green).toBe(1);
    });
  });

  describe('MOROPHON_REDUCTION', () => {
    it('should reduce one of each color', () => {
      expect(MOROPHON_REDUCTION.white).toBe(1);
      expect(MOROPHON_REDUCTION.blue).toBe(1);
      expect(MOROPHON_REDUCTION.black).toBe(1);
      expect(MOROPHON_REDUCTION.red).toBe(1);
      expect(MOROPHON_REDUCTION.green).toBe(1);
    });
  });
});
