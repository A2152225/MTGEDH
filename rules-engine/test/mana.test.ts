/**
 * Tests for Rule 106: Mana
 */
import { describe, it, expect } from 'vitest';
import {
  ManaType,
  ManaPool,
  createEmptyManaPool,
  addMana,
  emptyManaPool,
  hasMana,
  totalMana,
  hasUnspentMana,
  removeMana
} from '../src/types/mana';

describe('Rule 106: Mana', () => {
  describe('Rule 106.1b - Six types of mana', () => {
    it('should have six mana types', () => {
      const types = Object.values(ManaType);
      expect(types).toHaveLength(6);
      expect(types).toContain('white');
      expect(types).toContain('blue');
      expect(types).toContain('black');
      expect(types).toContain('red');
      expect(types).toContain('green');
      expect(types).toContain('colorless');
    });
  });

  describe('Rule 106.4 - Mana pool', () => {
    it('should create empty mana pool with all types at 0', () => {
      const pool = createEmptyManaPool();
      expect(pool.white).toBe(0);
      expect(pool.blue).toBe(0);
      expect(pool.black).toBe(0);
      expect(pool.red).toBe(0);
      expect(pool.green).toBe(0);
      expect(pool.colorless).toBe(0);
    });

    it('should add mana to pool', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.WHITE, 2);
      expect(pool.white).toBe(2);
      
      pool = addMana(pool, ManaType.BLUE, 1);
      expect(pool.blue).toBe(1);
      expect(pool.white).toBe(2); // Previous mana remains
    });

    it('should empty mana pool at end of step/phase', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.RED, 5);
      pool = addMana(pool, ManaType.GREEN, 3);
      
      pool = emptyManaPool();
      expect(totalMana(pool)).toBe(0);
    });

    it('should check if pool has sufficient mana', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.BLACK, 3);
      
      expect(hasMana(pool, ManaType.BLACK, 2)).toBe(true);
      expect(hasMana(pool, ManaType.BLACK, 3)).toBe(true);
      expect(hasMana(pool, ManaType.BLACK, 4)).toBe(false);
      expect(hasMana(pool, ManaType.WHITE, 1)).toBe(false);
    });

    it('should detect unspent mana', () => {
      let pool = createEmptyManaPool();
      expect(hasUnspentMana(pool)).toBe(false);
      
      pool = addMana(pool, ManaType.GREEN, 1);
      expect(hasUnspentMana(pool)).toBe(true);
    });
  });

  describe('Spending mana', () => {
    it('should remove mana from pool when spent', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.BLUE, 4);
      
      pool = removeMana(pool, ManaType.BLUE, 2);
      expect(pool.blue).toBe(2);
      
      pool = removeMana(pool, ManaType.BLUE, 2);
      expect(pool.blue).toBe(0);
    });

    it('should throw error when removing more mana than available', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.RED, 2);
      
      expect(() => removeMana(pool, ManaType.RED, 3)).toThrow();
    });
  });

  describe('Total mana calculation', () => {
    it('should calculate total mana across all types', () => {
      let pool = createEmptyManaPool();
      pool = addMana(pool, ManaType.WHITE, 2);
      pool = addMana(pool, ManaType.BLUE, 1);
      pool = addMana(pool, ManaType.COLORLESS, 3);
      
      expect(totalMana(pool)).toBe(6);
    });
  });
});
