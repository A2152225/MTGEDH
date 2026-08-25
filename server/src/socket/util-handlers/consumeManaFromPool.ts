// server/src/socket/util-handlers/consumeManaFromPool.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: consumeManaFromPool - colored then generic drain of a floating pool.
// Public entry symbols: consumeManaFromPool.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaPool } from "../../../../shared/src/index.js";
import { debug } from "../../utils/debug.js";
import { MANA_COLORS, MANA_COLOR_NAMES, MANA_COLOR_KEYS } from "./manaColorConstants.js";

/**
 * Consumes mana from a player's mana pool to pay for a spell cost.
 * Returns the remaining mana in the pool after payment.
 * 
 * This function first consumes colored mana requirements, then uses remaining mana
 * (preferring colorless) to pay for generic costs. Any unspent mana remains in the pool
 * for subsequent spells.
 * 
 * @param pool - The player's mana pool (will be modified in place)
 * @param coloredCost - The colored mana requirements (e.g., { W: 1, U: 1, ... })
 * @param genericCost - The amount of generic mana required
 * @param logPrefix - Optional prefix for debug logging
 * @returns The mana consumed and remaining in pool
 */
export function consumeManaFromPool(
  pool: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  logPrefix?: string
): { consumed: Record<string, number>; remaining: Record<string, number> } {
  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  
  // First, consume colored mana requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    if (needed > 0 && colorKey && pool[colorKey] >= needed) {
      pool[colorKey] -= needed;
      consumed[colorKey] = (consumed[colorKey] || 0) + needed;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${needed} ${color} mana from pool`);
      }
    }
  }
  
  // Then, consume generic mana (use any available mana, preferring colorless first)
  let genericLeft = genericCost;
  
  // First use colorless
  if (genericLeft > 0 && pool.colorless > 0) {
    const useColorless = Math.min(pool.colorless, genericLeft);
    pool.colorless -= useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
    if (logPrefix) {
      debug(2, `${logPrefix} Consumed ${useColorless} colorless mana for generic cost`);
    }
  }
  
  // Then use other colors
  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (colorKey && pool[colorKey] > 0) {
      const useColor = Math.min(pool[colorKey], genericLeft);
      pool[colorKey] -= useColor;
      consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
      genericLeft -= useColor;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${useColor} ${color} mana for generic cost`);
      }
    }
  }
  
  // Log remaining mana in pool
  if (logPrefix) {
    const remainingMana = Object.entries(pool).filter(([_, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
    if (remainingMana) {
      debug(2, `${logPrefix} Unspent mana remaining in pool: ${remainingMana}`);
    }
  }

  // Treasure provenance: maintain a conservative lower bound of Treasure-produced mana
  // remaining in this pool. We pessimistically decrement by all mana spent, which keeps
  // the lower bound <= actual Treasure mana (replay-safe, avoids false positives).
  try {
    const lb = (pool as any).treasureManaLowerBound;
    if (lb && typeof lb === 'object') {
      for (const k of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
        const used = Number((consumed as any)[k] || 0);
        if (!Number.isFinite(used) || used <= 0) continue;
        lb[k] = Math.max(0, Number(lb[k] || 0) - used);
      }
    }
  } catch {
    // best-effort only
  }

  // Creature-spell haste provenance: maintain a conservative lower bound of mana
  // remaining in this pool that can grant haste to a creature spell when spent.
  try {
    const lb = (pool as any).creatureSpellHasteManaLowerBound;
    if (lb && typeof lb === 'object') {
      for (const k of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
        const used = Number((consumed as any)[k] || 0);
        if (!Number.isFinite(used) || used <= 0) continue;
        lb[k] = Math.max(0, Number(lb[k] || 0) - used);
      }
    }
  } catch {
    // best-effort only
  }
  
  // Return only the mana color properties for the remaining pool
  const remaining: Record<string, number> = {};
  for (const key of MANA_COLOR_KEYS) {
    remaining[key] = pool[key] || 0;
  }
  
  return { consumed, remaining };
}
