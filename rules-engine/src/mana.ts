// rules-engine/src/mana.ts
// Pure mana calculation and parsing utilities

import type { ManaCost, ManaPool } from '../../shared/src';

/**
 * Parse a mana cost string (e.g., "{2}{U}{U}") into a ManaCost object.
 * Handles basic symbols: {W}, {U}, {B}, {R}, {G}, {C}, and generic {N}.
 * Returns a ManaCost with counts for each color and generic.
 */
export function parseManaCost(manaCost: string): ManaCost {
  const cost: ManaCost = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
    generic: 0,
  };

  if (!manaCost) return cost;

  // Match all {symbol} patterns
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  
  for (const symbol of symbols) {
    const inner = symbol.slice(1, -1); // Remove braces
    
    // Check for single colored mana
    if (inner === 'W') cost.W++;
    else if (inner === 'U') cost.U++;
    else if (inner === 'B') cost.B++;
    else if (inner === 'R') cost.R++;
    else if (inner === 'G') cost.G++;
    else if (inner === 'C') cost.C++;
    // Check for generic/numeric mana
    else if (/^\d+$/.test(inner)) {
      cost.generic += parseInt(inner, 10);
    }
    // Hybrid, Phyrexian, and other complex symbols default to generic
    // (can be extended later for more sophisticated handling)
    else if (inner.includes('/')) {
      // For now, treat hybrid as generic (simplified)
      cost.generic += 1;
    }
    // X costs are handled separately (not parsed here)
    else if (inner === 'X') {
      // X is dynamic, skip for now
    }
  }

  return cost;
}

/**
 * Create an empty mana pool.
 */
export function createEmptyManaPool(): ManaPool {
  return {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
    generic: 0,
  };
}

/**
 * Check if a mana pool can pay a given cost.
 * Returns true if the pool has sufficient mana, false otherwise.
 */
export function canPayCost(pool: Readonly<ManaPool>, cost: Readonly<ManaCost>): boolean {
  // Check specific colored mana requirements
  if (pool.W < cost.W) return false;
  if (pool.U < cost.U) return false;
  if (pool.B < cost.B) return false;
  if (pool.R < cost.R) return false;
  if (pool.G < cost.G) return false;
  if (pool.C < cost.C) return false;

  // Calculate total available mana after paying colored costs
  const availableAfterColors = 
    (pool.W - cost.W) +
    (pool.U - cost.U) +
    (pool.B - cost.B) +
    (pool.R - cost.R) +
    (pool.G - cost.G) +
    (pool.C - cost.C) +
    pool.generic;

  // Check if we can pay the generic cost
  return availableAfterColors >= cost.generic;
}

/**
 * Automatically pay a cost from a mana pool.
 * Returns a new pool with the cost deducted, or null if the cost cannot be paid.
 * 
 * Strategy:
 * 1. Pay all specific colored requirements first
 * 2. Pay colorless requirement from C mana
 * 3. Pay remaining generic from any leftover mana (colors first, then colorless, then generic)
 */
export function autoPayCost(
  pool: Readonly<ManaPool>,
  cost: Readonly<ManaCost>
): ManaPool | null {
  if (!canPayCost(pool, cost)) return null;

  const newPool = { ...pool };

  // Pay specific colored costs
  newPool.W -= cost.W;
  newPool.U -= cost.U;
  newPool.B -= cost.B;
  newPool.R -= cost.R;
  newPool.G -= cost.G;
  newPool.C -= cost.C;

  // Pay generic cost
  let remainingGeneric = cost.generic;

  // Use leftover colored mana first (WUBRG order)
  const colors: Array<keyof ManaPool> = ['W', 'U', 'B', 'R', 'G'];
  for (const color of colors) {
    if (remainingGeneric <= 0) break;
    const available = newPool[color];
    const use = Math.min(available, remainingGeneric);
    newPool[color] -= use;
    remainingGeneric -= use;
  }

  // Use colorless mana next
  if (remainingGeneric > 0) {
    const use = Math.min(newPool.C, remainingGeneric);
    newPool.C -= use;
    remainingGeneric -= use;
  }

  // Finally use generic mana
  if (remainingGeneric > 0) {
    newPool.generic -= remainingGeneric;
  }

  return newPool;
}

/**
 * Add mana to a pool.
 * Returns a new pool with the mana added.
 */
export function addManaToPool(
  pool: Readonly<ManaPool>,
  color: keyof ManaPool,
  amount: number
): ManaPool {
  return {
    ...pool,
    [color]: pool[color] + amount,
  };
}
