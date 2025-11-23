import { describe, it, expect } from 'vitest';
import { parseManaCost, canPayCost, autoPayCost, createEmptyManaPool, addManaToPool } from '../../rules-engine/src/mana';

describe('Mana parsing and payment', () => {
  it('parses simple mana costs correctly', () => {
    const cost = parseManaCost('{2}{U}{U}');
    expect(cost.generic).toBe(2);
    expect(cost.U).toBe(2);
    expect(cost.W).toBe(0);
  });

  it('parses multi-color costs', () => {
    const cost = parseManaCost('{3}{W}{U}{B}{R}{G}');
    expect(cost.generic).toBe(3);
    expect(cost.W).toBe(1);
    expect(cost.U).toBe(1);
    expect(cost.B).toBe(1);
    expect(cost.R).toBe(1);
    expect(cost.G).toBe(1);
  });

  it('parses colorless mana', () => {
    const cost = parseManaCost('{C}{C}');
    expect(cost.C).toBe(2);
    expect(cost.generic).toBe(0);
  });

  it('checks if pool can pay exact cost', () => {
    const pool = createEmptyManaPool();
    pool.U = 2;
    pool.generic = 2;

    const cost = parseManaCost('{2}{U}{U}');
    expect(canPayCost(pool, cost)).toBe(true);
  });

  it('checks insufficient mana', () => {
    const pool = createEmptyManaPool();
    pool.U = 1;

    const cost = parseManaCost('{2}{U}{U}');
    expect(canPayCost(pool, cost)).toBe(false);
  });

  it('can pay generic with any color', () => {
    const pool = createEmptyManaPool();
    pool.R = 3; // Red mana can pay for generic

    const cost = parseManaCost('{3}');
    expect(canPayCost(pool, cost)).toBe(true);
  });

  it('auto-pays cost correctly', () => {
    const pool = createEmptyManaPool();
    pool.U = 2;
    pool.W = 1;

    const cost = parseManaCost('{1}{U}{U}');
    const newPool = autoPayCost(pool, cost);

    expect(newPool).not.toBeNull();
    expect(newPool?.U).toBe(0);
    expect(newPool?.W).toBe(0); // Used for generic
  });

  it('returns null on insufficient mana for auto-pay', () => {
    const pool = createEmptyManaPool();
    pool.U = 1;

    const cost = parseManaCost('{2}{U}{U}');
    const newPool = autoPayCost(pool, cost);

    expect(newPool).toBeNull();
  });

  it('adds mana to pool', () => {
    const pool = createEmptyManaPool();
    const newPool = addManaToPool(pool, 'R', 3);

    expect(newPool.R).toBe(3);
    expect(pool.R).toBe(0); // Original unchanged (immutable)
  });
});
