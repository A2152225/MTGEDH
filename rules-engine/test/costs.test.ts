/**
 * Tests for Rule 118: Costs
 */
import { describe, it, expect } from 'vitest';
import {
  CostType,
  ManaCostPayment,
  LifeCost,
  canPayManaCost,
  canPayLifeCost,
  isZeroCost,
  applyCostReduction,
  CostModification
} from '../src/types/costs';
import { createEmptyManaPool, addMana, ManaType, ManaCost } from '../src/types/mana';

describe('Rule 118: Costs', () => {
  describe('Rule 118.1 - Cost types', () => {
    it('should define all cost types', () => {
      expect(CostType.MANA).toBe('mana');
      expect(CostType.TAP).toBe('tap');
      expect(CostType.SACRIFICE).toBe('sacrifice');
      expect(CostType.DISCARD).toBe('discard');
      expect(CostType.LIFE).toBe('life');
      expect(CostType.EXILE).toBe('exile');
    });
  });

  describe('Rule 118.3 - Can\'t pay cost without necessary resources', () => {
    it('should validate mana cost payment', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.RED, 3);
      pool = addMana(pool, ManaType.BLUE, 2);

      const cost: ManaCost = {
red: 1,
generic: 2
      };

      const result = canPayManaCost(cost, pool);
      expect(result.canPay).toBe(true);
    });

    it('should reject insufficient colored mana', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.RED, 1);
      pool = addMana(pool, ManaType.BLUE, 2);

      const cost: ManaCost = {
        red: 2  // Need 2 red
      };

      const result = canPayManaCost(cost, pool);
      expect(result.canPay).toBe(false);
    });

    it('should reject insufficient generic mana', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.RED, 1);

      const cost: ManaCost = {
        red: 1,
        generic: 3
      };

      const result = canPayManaCost(cost, pool);
      expect(result.canPay).toBe(false);
    });
  });

  describe('Rule 118.3b - Life payment', () => {
    it('should allow paying life when sufficient', () => {
      const cost: LifeCost = {
        type: CostType.LIFE,
        description: 'Pay 2 life',
        isOptional: false,
        isMandatory: true,
        amount: 2
      };

      expect(canPayLifeCost(cost, 10).canPay).toBe(true);
      expect(canPayLifeCost(cost, 2).canPay).toBe(true);
    });

    it('should not allow paying more life than available', () => {
      const cost: LifeCost = {
        type: CostType.LIFE,
        description: 'Pay 5 life',
        isOptional: false,
        isMandatory: true,
        amount: 5
      };

      expect(canPayLifeCost(cost, 4).canPay).toBe(false);
    });

    it('should always allow paying 0 life', () => {
      const cost: LifeCost = {
        type: CostType.LIFE,
        description: 'Pay 0 life',
        isOptional: false,
        isMandatory: true,
        amount: 0
      };

      expect(canPayLifeCost(cost, 0).canPay).toBe(true);
      expect(canPayLifeCost(cost, -5).canPay).toBe(true);
    });
  });

  describe('Rule 118.5 - Zero costs', () => {
    it('should identify zero mana cost', () => {
      const zeroCost: ManaCostPayment = {
        type: CostType.MANA,
        description: '{0}',
        isOptional: false,
        isMandatory: true,
        amount: {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: 0,
          generic: 0
        }
      };

      expect(isZeroCost(zeroCost)).toBe(true);
    });

    it('should not identify non-zero cost as zero', () => {
      const nonZeroCost: ManaCostPayment = {
        type: CostType.MANA,
        description: '{1}',
        isOptional: false,
        isMandatory: true,
        amount: {
          generic: 1
        }
      };

      expect(isZeroCost(nonZeroCost)).toBe(false);
    });
  });

  describe('Rule 118.7 - Cost reduction', () => {
    it('should reduce generic cost', () => {
      const originalCost: ManaCost = {
        red: 1,
        generic: 5
      };

      const reduction: CostModification = {
        type: 'reduction',
        amount: 2,
        affectsGeneric: true
      };

      const reduced = applyCostReduction(originalCost, reduction);
      expect(reduced.generic).toBe(3);
      expect(reduced.red).toBe(1); // Colored mana unchanged
    });

    it('should reduce colored mana and overflow to generic', () => {
      const originalCost: ManaCost = {
        red: 1,
        generic: 2
      };

      const reduction: CostModification = {
        type: 'reduction',
        amount: 3,  // More than red mana available
        manaType: ManaType.RED,
        affectsGeneric: true
      };

      const reduced = applyCostReduction(originalCost, reduction);
      expect(reduced.red).toBe(0);       // Red reduced to 0
      expect(reduced.generic).toBe(0);   // Excess (2) reduces generic from 2 to 0
    });

    it('should not reduce below zero', () => {
      const originalCost: ManaCost = {
        generic: 1
      };

      const reduction: CostModification = {
        type: 'reduction',
        amount: 5,
        affectsGeneric: true
      };

      const reduced = applyCostReduction(originalCost, reduction);
      expect(reduced.generic).toBe(0); // Not negative
    });
  });

  describe('Cost examples from real cards', () => {
    it('should handle Counterspell {U}{U}', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.BLUE, 2);

      const cost: ManaCost = {
        blue: 2
      };

      expect(canPayManaCost(cost, pool).canPay).toBe(true);
    });

    it('should handle Wrath of God {2}{W}{W}', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.WHITE, 2);
      pool = addMana(pool, ManaType.BLUE, 2);

      const cost: ManaCost = {
        white: 2,
        generic: 2
      };

      expect(canPayManaCost(cost, pool).canPay).toBe(true);
    });
  });
});
