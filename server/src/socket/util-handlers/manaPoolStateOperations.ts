// server/src/socket/util-handlers/manaPoolStateOperations.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: server-side mana pool state - pool/persistent-pool accessors,
//   mana retention effect detection, phase-end mana drain, pool clearing,
//   combined totals, and pool payment validation.
// Public entry symbols: getOrInitManaPool, getOrInitPersistentManaPool,
//   ManaRetentionEffect, detectManaRetentionEffects, addPersistentMana,
//   processManaDrain, clearManaPool, clearPersistentManaPool, clearAllManaPools,
//   getTotalManaPool, calculateTotalAvailableMana, validateManaPayment.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaPool } from "../../../../shared/src/index.js";
import { MANA_COLORS, MANA_COLOR_KEYS, MANA_COLOR_NAMES, getManaColorName } from "./manaColorConstants.js";

/**
 * Gets the current mana pool for a player, initializing it if needed.
 * Returns the enhanced ManaPool interface with support for restricted mana.
 */
export function getOrInitManaPool(
  gameState: any,
  playerId: string
): ManaPool {
  gameState.manaPool = gameState.manaPool || {};
  gameState.manaPool[playerId] = gameState.manaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.manaPool[playerId];
}

/**
 * Gets the "doesn't empty" mana pool for a player (mana that persists until end of turn).
 * Used by cards like Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function getOrInitPersistentManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  gameState.persistentManaPool = gameState.persistentManaPool || {};
  gameState.persistentManaPool[playerId] = gameState.persistentManaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.persistentManaPool[playerId];
}

/**
 * Mana retention effects from permanents on the battlefield.
 * 
 * Types of effects:
 * - "doesn't empty" - specific color(s) don't empty (Omnath, Leyline Tyrant)
 * - "becomes colorless" - unspent mana becomes colorless instead of emptying (Kruphix, Horizon Stone)
 * - "all mana doesn't empty" - no mana empties (Upwelling)
 */
export interface ManaRetentionEffect {
  permanentId: string;
  cardName: string;
  type: 'doesnt_empty' | 'becomes_colorless' | 'all_doesnt_empty';
  colors?: string[]; // Which colors are affected (undefined = all)
}

/**
 * Detect mana retention effects from battlefield permanents
 */
export function detectManaRetentionEffects(
  gameState: any,
  playerId: string
): ManaRetentionEffect[] {
  const effects: ManaRetentionEffect[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    if (cardName.includes("omnath, locus of mana") || 
        (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath",
        type: 'doesnt_empty',
        colors: ['green'],
      });
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    // Electro, Assaulting Battery - Red mana doesn't empty
    if (cardName.includes("leyline tyrant") || cardName.includes("electro") ||
        (oracleText.includes("red mana") && oracleText.includes("don't lose")) ||
        (oracleText.includes("don't lose unspent red mana"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Leyline Tyrant",
        type: 'doesnt_empty',
        colors: ['red'],
      });
    }
    
    // Omnath, Locus of All - Mana becomes black instead of emptying
    if (cardName.includes("omnath, locus of all") ||
        (oracleText.includes("mana becomes") && oracleText.includes("instead of emptying"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath, Locus of All",
        type: 'becomes_colorless', // Will be handled specially as 'becomes black'
        colors: ['black'], // Tag to convert to black
      });
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
        oracleText.includes("mana becomes colorless instead")) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Horizon Stone",
        type: 'becomes_colorless',
      });
    }
    
    // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
    if (cardName.includes("upwelling") ||
        (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Upwelling",
        type: 'all_doesnt_empty',
      });
    }
    
    // Omnath, Locus of the Roil / Omnath, Locus of Creation - Landfall mana
    // (These add mana that doesn't need special retention handling)
    
    // Savage Ventmaw - Adds mana that doesn't empty until end of turn
    if (cardName.includes("savage ventmaw")) {
      // This is handled by combat triggers, not retention effects
    }
    
    // Grand Warlord Radha - Adds mana that doesn't empty until end of turn
    if (cardName.includes("grand warlord radha")) {
      // This is handled by attack triggers, not retention effects
    }
  }
  
  return effects;
}

/**
 * Add mana to persistent pool (doesn't empty until end of turn).
 * Sources: Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function addPersistentMana(
  gameState: any,
  playerId: string,
  mana: { white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number }
): void {
  const pool = getOrInitPersistentManaPool(gameState, playerId);
  for (const [color, amount] of Object.entries(mana)) {
    if (amount && amount > 0) {
      pool[color] = (pool[color] || 0) + amount;
    }
  }
}

/**
 * Process mana pool emptying at phase/step end, respecting retention effects.
 * 
 * This is the main function to call when steps/phases end.
 */
export function processManaDrain(gameState: any, playerId: string): {
  drained: Record<string, number>;
  retained: Record<string, number>;
  converted: Record<string, number>; // Colored mana that became colorless
} {
  const pool = getOrInitManaPool(gameState, playerId);
  const effects = detectManaRetentionEffects(gameState, playerId);
  
  const result = {
    drained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    retained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    converted: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  
  // Check for "all mana doesn't empty" effect
  const hasUpwellingEffect = effects.some(e => e.type === 'all_doesnt_empty');
  if (hasUpwellingEffect) {
    // All mana is retained
    for (const color of Object.keys(pool)) {
      result.retained[color] = pool[color] || 0;
    }
    return result;
  }
  
  // Check for "becomes colorless" effect (Kruphix, Horizon Stone)
  const hasBecomesColorless = effects.some(e => e.type === 'becomes_colorless' && !e.colors);
  
  // Check for "becomes black" effect (Omnath, Locus of All)
  const hasBecomesBlack = effects.some(e => e.type === 'becomes_colorless' && e.colors?.includes('black'));
  
  // Check which colors don't empty
  const colorsDoNotEmpty = new Set<string>();
  for (const effect of effects) {
    if (effect.type === 'doesnt_empty' && effect.colors) {
      for (const color of effect.colors) {
        colorsDoNotEmpty.add(color);
      }
    }
  }
  
  // Process each color
  for (const color of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = pool[color] || 0;
    if (amount === 0) continue;
    
    if (colorsDoNotEmpty.has(color)) {
      // This color doesn't empty
      result.retained[color] = amount;
    } else if (hasBecomesBlack && color !== 'colorless' && color !== 'black') {
      // Colored mana becomes black (Omnath, Locus of All)
      result.converted[color] = amount;
      pool.black = (pool.black || 0) + amount;
      pool[color] = 0;
      result.retained.black = (result.retained.black || 0) + amount;
    } else if (hasBecomesColorless && color !== 'colorless') {
      // Colored mana becomes colorless (Kruphix, Horizon Stone)
      result.converted[color] = amount;
      pool.colorless = (pool.colorless || 0) + amount;
      pool[color] = 0;
      result.retained.colorless = (result.retained.colorless || 0) + amount;
    } else {
      // Mana empties normally
      result.drained[color] = amount;
      pool[color] = 0;
    }
  }
  
  return result;
}

/**
 * Clear normal mana pool (at phase/step end).
 * Use processManaDrain() instead for proper handling of retention effects.
 */
export function clearManaPool(gameState: any, playerId: string): void {
  if (gameState.manaPool?.[playerId]) {
    gameState.manaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear persistent mana pool (at end of turn only).
 */
export function clearPersistentManaPool(gameState: any, playerId: string): void {
  if (gameState.persistentManaPool?.[playerId]) {
    gameState.persistentManaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear all mana pools at end of turn.
 */
export function clearAllManaPools(gameState: any, playerId: string): void {
  clearManaPool(gameState, playerId);
  clearPersistentManaPool(gameState, playerId);
}

/**
 * Get total available mana (normal pool + persistent pool).
 */
export function getTotalManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  const normal = getOrInitManaPool(gameState, playerId);
  const persistent = getOrInitPersistentManaPool(gameState, playerId);
  
  return {
    white: (normal.white || 0) + (persistent.white || 0),
    blue: (normal.blue || 0) + (persistent.blue || 0),
    black: (normal.black || 0) + (persistent.black || 0),
    red: (normal.red || 0) + (persistent.red || 0),
    green: (normal.green || 0) + (persistent.green || 0),
    colorless: (normal.colorless || 0) + (persistent.colorless || 0),
  };
}

/**
 * Calculates the total available mana by combining existing pool with new payment.
 * Returns the combined pool in the same format as the mana pool (using color names as keys).
 */
export function calculateTotalAvailableMana(
  existingPool: ManaPool | Record<string, number>,
  newPayment: Array<{ mana: string; count?: number }> | undefined
): Record<string, number> {
  // Start with a copy of the existing pool
  const total: Record<string, number> = {
    white: existingPool.white || 0,
    blue: existingPool.blue || 0,
    black: existingPool.black || 0,
    red: existingPool.red || 0,
    green: existingPool.green || 0,
    colorless: existingPool.colorless || 0,
  };
  
  // Add new payment - use count field for multi-mana sources like Sol Ring
  if (newPayment && newPayment.length > 0) {
    for (const p of newPayment) {
      const colorKey = MANA_COLOR_NAMES[p.mana];
      if (colorKey) {
        // Use count if provided (e.g., Sol Ring produces 2), default to 1
        const manaAmount = p.count ?? 1;
        total[colorKey] = (total[colorKey] || 0) + manaAmount;
      }
    }
  }
  
  return total;
}

/**
 * Validates if the total available mana (existing pool + new payment) can pay for a spell.
 * Returns null if payment is sufficient, or an error message describing what's missing.
 */
export function validateManaPayment(
  totalAvailable: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number
): string | null {
  const pool = { ...totalAvailable };
  const missingColors: string[] = [];
  
  // Check colored requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    const available = pool[colorKey] || 0;
    
    if (available < needed) {
      missingColors.push(`${needed - available} ${getManaColorName(color)}`);
    } else {
      // Reserve this mana for the colored cost
      pool[colorKey] -= needed;
    }
  }
  
  // Check generic requirement with remaining mana
  // Only sum numeric color values from the known mana color keys
  const remainingTotal = MANA_COLOR_KEYS.reduce((sum, key) => sum + (pool[key] || 0), 0);
  const missingGeneric = Math.max(0, genericCost - remainingTotal);
  
  if (missingColors.length > 0 || missingGeneric > 0) {
    let errorMsg = "Insufficient mana.";
    if (missingColors.length > 0) {
      errorMsg += ` Missing: ${missingColors.join(', ')}.`;
    }
    if (missingGeneric > 0) {
      errorMsg += ` Missing ${missingGeneric} generic mana.`;
    }
    return errorMsg;
  }
  
  return null;
}
