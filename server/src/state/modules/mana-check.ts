/**
 * mana-check.ts
 * 
 * Modular helper for checking if a player can pay mana costs.
 * Separated from can-respond.ts for better modularity and reusability.
 */

import type { PlayerID } from "../../../../shared/src";

/**
 * Parse mana cost from a string into components
 */
export function parseManaCost(manaCost?: string): {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
} {
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hasX: false,
  };

  if (!manaCost) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, "").toUpperCase();
    if (clean === "X") {
      result.hasX = true;
    } else if (/^\d+$/.test(clean)) {
      result.generic += parseInt(clean, 10);
    } else if (clean.length === 1 && clean in result.colors) {
      result.colors[clean as keyof typeof result.colors] = 
        (result.colors[clean as keyof typeof result.colors] || 0) + 1;
    }
  }

  return result;
}

/**
 * Get total available mana from a mana pool
 */
export function getTotalManaFromPool(pool: Record<string, number>): number {
  return Object.values(pool || {}).reduce((sum, val) => sum + (val || 0), 0);
}

/**
 * Check if a player can pay a mana cost with their current mana pool
 * 
 * @param pool The player's mana pool
 * @param parsedCost The parsed mana cost to check
 * @returns true if the cost can be paid
 */
export function canPayManaCost(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number; hasX: boolean }
): boolean {
  if (!pool) return false;

  const manaColorMap: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  // Check if we have enough of each colored mana
  let remainingMana = getTotalManaFromPool(pool);
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = pool[colorKey] || 0;
    if (available < needed) {
      return false; // Can't pay this colored requirement
    }
    remainingMana -= needed;
  }

  // Check if we have enough remaining for generic cost
  return remainingMana >= parsedCost.generic;
}

/**
 * Check if a player can pay any amount of mana (for X spells or abilities)
 * Returns the maximum X value that can be paid
 * 
 * @param pool The player's mana pool
 * @param parsedCost The parsed cost (excluding X)
 * @returns Maximum X value that can be paid, or 0 if cost cannot be paid
 */
export function getMaxXValue(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number }
): number {
  if (!pool) return 0;

  const manaColorMap: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  // Check if we can pay colored costs
  let remainingMana = getTotalManaFromPool(pool);
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = pool[colorKey] || 0;
    if (available < needed) {
      return 0; // Can't even pay the colored part
    }
    remainingMana -= needed;
  }

  // Remaining mana after colored costs is available for X + generic
  const availableForXAndGeneric = remainingMana;
  const maxX = Math.max(0, availableForXAndGeneric - parsedCost.generic);
  
  return maxX;
}

/**
 * Get a default mana pool (empty)
 */
export function getEmptyManaPool(): Record<string, number> {
  return {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
}

/**
 * Get mana pool from game state for a player
 */
export function getManaPoolFromState(state: any, playerId: PlayerID): Record<string, number> {
  return (state as any).manaPool?.[playerId] || getEmptyManaPool();
}

/**
 * Get total available mana for a player, including:
 * 1. Floating mana in their mana pool
 * 2. Potential mana from untapped mana-producing permanents
 * 
 * This gives a realistic picture of what the player could cast if they tap their sources.
 * 
 * NOTE: This is an OPTIMISTIC calculation - it assumes the player will tap all their mana sources.
 * It doesn't account for complex scenarios like:
 * - Mana sources that can only be used for specific spells
 * - Mana sources with restrictions (e.g., "spend only on creatures")
 * - Activated abilities that cost mana to activate
 * 
 * For precise checks, use the actual mana pool + cost calculation logic.
 */
export function getAvailableMana(state: any, playerId: PlayerID): Record<string, number> {
  // Start with floating mana in pool
  const pool = { ...getManaPoolFromState(state, playerId) };
  
  // Add potential mana from untapped permanents
  const battlefield = state.battlefield || [];
  for (const permanent of battlefield) {
    if (permanent.controller !== playerId) continue;
    if (permanent.tapped) continue;
    if (!permanent.card) continue;
    
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    
    // Special case: Basic lands (Mountain, Island, etc.)
    // Handle these first since they don't have oracle text with mana abilities
    if (/^(plains|island|swamp|mountain|forest)$/i.test(cardName)) {
      const landToColor: Record<string, string> = {
        'plains': 'white',
        'island': 'blue',
        'swamp': 'black',
        'mountain': 'red',
        'forest': 'green',
      };
      const colorKey = landToColor[cardName];
      if (colorKey) {
        pool[colorKey] = (pool[colorKey] || 0) + 1;
      }
      continue; // Skip oracle text check for basic lands
    }
    
    // Check for mana abilities in oracle text
    // Pattern: "{T}: Add {C}", "{T}: Add {C}{C}", etc.
    // This single pattern handles both single and multi-mana abilities
    const manaAbilityPattern = /\{t\}(?:[^:]*)?:\s*add\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/gi;
    const matches = [...oracleText.matchAll(manaAbilityPattern)];
    
    for (const match of matches) {
      const manaString = match[1];
      // Count each {C}, {W}, {U}, {B}, {R}, {G} in the ability
      const manaTokens = manaString.match(/\{([wubrgc])\}/gi) || [];
      for (const token of manaTokens) {
        const color = token.replace(/[{}]/g, '').toUpperCase();
        const colorKey = {
          'W': 'white',
          'U': 'blue',
          'B': 'black',
          'R': 'red',
          'G': 'green',
          'C': 'colorless',
        }[color];
        
        if (colorKey) {
          pool[colorKey] = (pool[colorKey] || 0) + 1;
        }
      }
    }
  }
  
  return pool;
}
