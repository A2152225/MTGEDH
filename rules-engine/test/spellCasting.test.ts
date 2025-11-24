/**
 * Tests for spell casting system (Rule 601)
 */

import { describe, it, expect } from 'vitest';
import {
  castSpell,
  payManaCost,
  validateSpellTiming,
  createStackObject,
  type SpellCastingContext,
} from '../src/spellCasting';
import type { ManaPool } from '../src/types/mana';

describe('Spell Casting System', () => {
  describe('payManaCost', () => {
    it('should pay simple colored mana cost', () => {
      const pool: ManaPool = {
        white: 2,
        blue: 2,
        black: 1,
        red: 1,
        green: 1,
        colorless: 0,
      };

      const cost = { blue: 2 }; // {U}{U}
      const result = payManaCost(pool, cost);

      expect(result.success).toBe(true);
      expect(result.remainingPool?.blue).toBe(0);
    });

    it('should pay generic mana with any color', () => {
      const pool: ManaPool = {
        white: 1,
        blue: 1,
        black: 1,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const cost = { generic: 2 }; // {2}
      const result = payManaCost(pool, cost);

      expect(result.success).toBe(true);
      expect(result.remainingPool).toBeDefined();
    });

    it('should fail when insufficient mana', () => {
      const pool: ManaPool = {
        white: 0,
        blue: 1,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const cost = { blue: 2 }; // {U}{U}
      const result = payManaCost(pool, cost);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('should pay mixed costs correctly', () => {
      const pool: ManaPool = {
        white: 1,
        blue: 1,
        black: 1,
        red: 1,
        green: 1,
        colorless: 1,
      };

      const cost = { white: 1, blue: 1, generic: 2 }; // {W}{U}{2}
      const result = payManaCost(pool, cost);

      expect(result.success).toBe(true);
      expect(result.remainingPool).toBeDefined();
      // Should have used white and blue, then 2 more for generic
      const totalRemaining = Object.values(result.remainingPool!).reduce((a, b) => a + b, 0);
      expect(totalRemaining).toBe(2); // Started with 6, paid 4
    });

    it('should handle colorless mana requirement', () => {
      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 2,
      };

      const cost = { colorless: 1 }; // {C}
      const result = payManaCost(pool, cost);

      expect(result.success).toBe(true);
      expect(result.remainingPool?.colorless).toBe(1);
    });
  });

  describe('validateSpellTiming', () => {
    it('should allow instant at any time with priority', () => {
      const validation = validateSpellTiming(['instant'], {
        isMainPhase: false,
        isOwnTurn: false,
        stackEmpty: false,
        hasPriority: true,
      });

      expect(validation.valid).toBe(true);
    });

    it('should require sorcery timing for sorceries', () => {
      const validation = validateSpellTiming(['sorcery'], {
        isMainPhase: true,
        isOwnTurn: true,
        stackEmpty: true,
        hasPriority: true,
      });

      expect(validation.valid).toBe(true);
    });

    it('should reject sorcery on opponent turn', () => {
      const validation = validateSpellTiming(['sorcery'], {
        isMainPhase: true,
        isOwnTurn: false,
        stackEmpty: true,
        hasPriority: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('your turn');
    });

    it('should reject sorcery when stack not empty', () => {
      const validation = validateSpellTiming(['sorcery'], {
        isMainPhase: true,
        isOwnTurn: true,
        stackEmpty: false,
        hasPriority: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('stack');
    });

    it('should require sorcery timing for creatures', () => {
      const validation = validateSpellTiming(['creature'], {
        isMainPhase: false,
        isOwnTurn: true,
        stackEmpty: true,
        hasPriority: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('main phase');
    });
  });

  describe('castSpell', () => {
    it('should successfully cast instant with sufficient mana', () => {
      const context: SpellCastingContext = {
        spellId: 'lightning-bolt-1',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        manaCost: { red: 1 },
      };

      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 2,
        green: 0,
        colorless: 0,
      };

      const result = castSpell(context, pool, ['instant'], {
        isMainPhase: false,
        isOwnTurn: false,
        stackEmpty: false,
        hasPriority: true,
      });

      expect(result.success).toBe(true);
      expect(result.stackObjectId).toBeDefined();
      expect(result.manaPoolAfter?.red).toBe(1);
    });

    it('should fail without priority', () => {
      const context: SpellCastingContext = {
        spellId: 'counterspell-1',
        cardName: 'Counterspell',
        controllerId: 'player1',
        manaCost: { blue: 2 },
      };

      const pool: ManaPool = {
        white: 0,
        blue: 3,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = castSpell(context, pool, ['instant'], {
        isMainPhase: true,
        isOwnTurn: true,
        stackEmpty: true,
        hasPriority: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('priority');
    });

    it('should fail with insufficient mana', () => {
      const context: SpellCastingContext = {
        spellId: 'wrath-1',
        cardName: 'Wrath of God',
        controllerId: 'player1',
        manaCost: { white: 2, generic: 2 },
      };

      const pool: ManaPool = {
        white: 1,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = castSpell(context, pool, ['sorcery'], {
        isMainPhase: true,
        isOwnTurn: true,
        stackEmpty: true,
        hasPriority: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('mana');
    });
  });

  describe('createStackObject', () => {
    it('should create valid stack object', () => {
      const context: SpellCastingContext = {
        spellId: 'fireball-1',
        cardName: 'Fireball',
        controllerId: 'player1',
        manaCost: { red: 1 },
        targets: ['player2'],
        xValue: 5,
      };

      const stackObject = createStackObject(context, 1000);

      expect(stackObject.id).toContain('stack-');
      expect(stackObject.spellId).toBe('fireball-1');
      expect(stackObject.cardName).toBe('Fireball');
      expect(stackObject.controllerId).toBe('player1');
      expect(stackObject.targets).toEqual(['player2']);
      expect(stackObject.xValue).toBe(5);
      expect(stackObject.type).toBe('spell');
    });
  });
});
