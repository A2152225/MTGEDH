/**
 * mana-check.ts
 * 
 * Modular helper for checking if a player can pay mana costs.
 * Separated from can-respond.ts for better modularity and reusability.
 */

import type { PlayerID } from "../../../../shared/src";
import { creatureHasHaste } from "../../socket/game-actions.js";

/**
 * Phyrexian mana can be paid with 2 life instead of the colored mana
 * Rule 107.4f: "The Phyrexian mana symbol is {X/P}, where X is one of the five colored 
 * mana symbols. A Phyrexian mana symbol represents a cost that can be paid by spending 
 * one mana of the color associated with that Phyrexian mana symbol or by paying 2 life."
 */
const PHYREXIAN_LIFE_COST = 2;

/**
 * Parse mana cost from a string into components
 */
export function parseManaCost(manaCost?: string): {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
  hybrid?: Array<string[]>; // Track hybrid mana requirements separately
} {
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hasX: false,
    hybrid: [] as Array<string[]>,
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
      // Single color symbol: {W}, {U}, {B}, {R}, {G}, {C}
      result.colors[clean as keyof typeof result.colors] = 
        (result.colors[clean as keyof typeof result.colors] || 0) + 1;
    } else if (clean.includes("/")) {
      // Hybrid mana: {W/U}, {B/R}, {2/W}, etc.
      const parts = clean.split("/");
      
      // Handle phyrexian mana {W/P} or colored phyrexian {B/P}
      if (parts[1] === "P") {
        // Phyrexian mana can be paid with the color OR 2 life
        // Track as hybrid with special LIFE payment option
        const firstColor = parts[0];
        if (firstColor.length === 1 && firstColor in result.colors) {
          // Add both options: the color OR pay life (Rule 107.4f)
          result.hybrid.push([firstColor, `LIFE:${PHYREXIAN_LIFE_COST}`]);
        }
      } else if (/^\d+$/.test(parts[0])) {
        // Hybrid generic/color: {2/W}, {3/U}, etc.
        // Can be paid with either N generic OR 1 colored mana
        // Track as hybrid with generic option: ['GENERIC:N', 'COLOR']
        result.hybrid.push([`GENERIC:${parts[0]}`, parts[1]]);
      } else {
        // Regular hybrid: {W/U}, {B/R}, etc.
        // Can be paid with either color
        result.hybrid.push(parts);
      }
    }
  }

  return result;
}

/**
 * Get total available mana from a mana pool.
 * 
 * NOTE: This function now handles the 'anyColor' field specially.
 * When calculating total, we don't count 'anyColor' separately since those 
 * mana sources already have their potential colors represented in the pool.
 * The 'anyColor' field is used by canPayManaCost to properly allocate mana.
 */
export function getTotalManaFromPool(pool: Record<string, number>): number {
  if (!pool) return 0;
  
  // If the pool has 'anyColor' tracking, we need to calculate correctly
  // anyColor sources can produce ANY color, but only count as 1 mana each
  const anyColorCount = pool.anyColor || 0;
  
  // Sum specific colors (excluding anyColor marker)
  let specificColorTotal = 0;
  for (const [key, val] of Object.entries(pool)) {
    if (key === 'anyColor') continue; // Skip the anyColor marker
    specificColorTotal += val || 0;
  }
  
  // If we have anyColor sources, we need to subtract them from the inflated total
  // Each "any color" source adds +1 to all 5 colored mana types (W,U,B,R,G) but only produces 1 mana
  // So the inflated amount is anyColorCount * (NUM_COLORED_MANA_TYPES - 1)
  // Note: colorless is NOT included because "any color" sources don't add to colorless
  const NUM_COLORED_MANA_TYPES = 5; // white, blue, black, red, green
  if (anyColorCount > 0) {
    const inflatedAmount = anyColorCount * (NUM_COLORED_MANA_TYPES - 1);
    return Math.max(0, specificColorTotal - inflatedAmount);
  }
  
  return specificColorTotal;
}

/**
 * Check if a player can pay a mana cost with their current mana pool
 * 
 * @param pool The player's mana pool
 * @param parsedCost The parsed mana cost to check
 * @param lifeAvailable Optional: player's life total for Phyrexian mana costs (default: Infinity to always allow)
 * @returns true if the cost can be paid
 */
export function canPayManaCost(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number; hasX: boolean; hybrid?: Array<string[]> },
  lifeAvailable: number = Infinity
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

  // Make a copy of the pool to track what's been spent
  const remainingPool = { ...pool };
  let remainingLife = lifeAvailable;
  
  // First, pay all non-hybrid colored costs
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = remainingPool[colorKey] || 0;
    if (available < needed) {
      return false; // Can't pay this colored requirement
    }
    remainingPool[colorKey] -= needed;
  }
  
  // Then, pay hybrid costs (can use any of the specified colors)
  if (parsedCost.hybrid && parsedCost.hybrid.length > 0) {
    for (const hybridOptions of parsedCost.hybrid) {
      let paid = false;
      
      // Try to pay with one of the hybrid options
      for (const option of hybridOptions) {
        if (option.startsWith('LIFE:')) {
          // Phyrexian mana - can pay with life
          const lifeAmount = parseInt(option.split(':')[1], 10);
          if (remainingLife >= lifeAmount) {
            remainingLife -= lifeAmount;
            paid = true;
            break;
          }
        } else if (option.startsWith('GENERIC:')) {
          // Can pay with N generic mana (e.g., GENERIC:2, GENERIC:3)
          const genericAmount = parseInt(option.split(':')[1], 10);
          const totalRemaining = getTotalManaFromPool(remainingPool);
          if (totalRemaining >= genericAmount) {
            // Deduct N from any available mana (prefer colorless first)
            let toPay = genericAmount;
            if (remainingPool.colorless >= toPay) {
              remainingPool.colorless -= toPay;
              toPay = 0;
            } else if (remainingPool.colorless > 0) {
              toPay -= remainingPool.colorless;
              remainingPool.colorless = 0;
            }
            // Pay remainder from any colors (may need to combine multiple)
            if (toPay > 0) {
              for (const colorKey of Object.keys(remainingPool)) {
                if (colorKey === 'colorless') continue; // Already handled above
                const available = remainingPool[colorKey as keyof typeof remainingPool];
                if (available > 0) {
                  const toDeduct = Math.min(available, toPay);
                  remainingPool[colorKey as keyof typeof remainingPool] -= toDeduct;
                  toPay -= toDeduct;
                  if (toPay === 0) break;
                }
              }
            }
            if (toPay === 0) {
              paid = true;
              break;
            }
          }
        } else {
          // Try to pay with this specific color
          const colorKey = manaColorMap[option];
          if (colorKey && remainingPool[colorKey] > 0) {
            remainingPool[colorKey] -= 1;
            paid = true;
            break;
          }
        }
      }
      
      if (!paid) {
        return false; // Couldn't pay this hybrid cost
      }
    }
  }

  // Finally, check if we have enough remaining for generic cost
  const totalRemaining = getTotalManaFromPool(remainingPool);
  return totalRemaining >= parsedCost.generic;
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
    const typeLine = (permanent.card.type_line || "").toLowerCase();
    
    // Check for summoning sickness on creatures with tap abilities
    // Rule 302.6: A creature can't use tap abilities unless it has haste or has been 
    // continuously controlled since the beginning of the turn
    const isCreature = typeLine.includes("creature");
    const isLand = typeLine.includes("land");
    
    // Skip creatures with summoning sickness (unless they have haste)
    if (isCreature && !isLand && permanent.summoningSickness) {
      const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
      if (!hasHaste) {
        // This creature has summoning sickness and no haste - can't tap for mana
        continue;
      }
    }
    
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
    // Pattern: "{T}: Add {C}", "{T}: Add {C}{C}", "{T}: Add {B} or {R}", etc.
    // Also handles costs: "{1}, {T}: Add {W}{U}" (signets)
    // Captures text after "add" until period or newline to handle "or" cases
    // Note: This pattern stops at the first period, which correctly handles most cards
    // Example: "{T}: Add {B} or {R}. Other text." captures only "{B} or {R}"
    
    // First, detect if this has an activation cost (signets, etc.)
    // Pattern: "{cost}, {T}: Add..." or "{T}, {cost}: Add..."
    const manaAbilityWithCostPattern = /\{([0-9]+|[wubrgc])\}(?:,\s*)?\{t\}(?:[^:]*)?:\s*add\s+([^.\n]+)/gi;
    const manaAbilityNoCostPattern = /\{t\}(?:[^:]*)?:\s*add\s+([^.\n]+)/gi;
    
    // Check for abilities with activation costs first
    const costMatches = [...oracleText.matchAll(manaAbilityWithCostPattern)];
    
    for (const match of costMatches) {
      const activationCost = match[1]; // The mana cost to activate (e.g., "1" for signets)
      const fullManaText = match[2].trim();
      
      // Calculate the NET mana this source provides
      // For signets: "{1}, {T}: Add {W}{U}" means you spend 1 to get 2, net +1 mana
      const activationCostAmount = /^\d+$/.test(activationCost) ? parseInt(activationCost, 10) : 1;
      
      // Count how much mana this produces
      const producedManaTokens = fullManaText.match(/\{([wubrgc])\}/gi) || [];
      const totalProduced = producedManaTokens.length;
      
      // Only count if we get a net positive (or break even)
      // Signets: cost 1, produce 2 = net +1
      // If cost >= produced, this doesn't help us cast spells (net 0 or negative)
      if (totalProduced <= activationCostAmount) {
        // This mana source costs as much or more than it produces - skip it
        debug(3, `[getAvailableMana] Skipping ${cardName}: costs ${activationCostAmount} to produce ${totalProduced}`);
        continue;
      }
      
      // Net mana gained is totalProduced - activationCostAmount
      const netMana = totalProduced - activationCostAmount;
      
      // Check if this is an OR mana ability
      const hasOrClause = /\{[wubrgc]\}(?:,?\s*\{[wubrgc]\})*,?\s+or\s+\{[wubrgc]\}/i.test(fullManaText);
      
      if (hasOrClause) {
        // This is an OR mana ability - only count the net mana
        const firstManaMatch = fullManaText.match(/\{([wubrgc])\}/i);
        if (firstManaMatch) {
          const color = firstManaMatch[1].toUpperCase();
          const colorKey = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          }[color];
          
          if (colorKey) {
            pool[colorKey] = (pool[colorKey] || 0) + netMana;
          }
        }
      } else {
        // Add net mana for each color produced
        // For signets: produces 2, costs 1, so add 1 of each color
        for (let i = 0; i < netMana; i++) {
          for (const token of producedManaTokens) {
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
    }
    
    // Now check for abilities WITHOUT activation costs (basic lands, Sol Ring, etc.)
    // Filter out the ones we already processed with costs
    const noCostMatches = [...oracleText.matchAll(manaAbilityNoCostPattern)]
      .filter(match => {
        // Exclude if this same ability was already matched with a cost
        const matchText = match[0];
        return !costMatches.some(costMatch => matchText.includes(costMatch[0]));
      });
    
    for (const match of noCostMatches) {
      const fullManaText = match[1].trim();
      
      // Check if this is an OR mana ability (can produce one of multiple colors)
      // Patterns to detect:
      // - "{B} or {R}" (dual lands)
      // - "{G}, {U}, or {R}" (tri-lands like Frontier Bivouac)
      // - "{W}, {U}, {B}, {R}, or {G}" (five-color lands)
      // OR mana should only count as ONE mana, not multiple
      // The key indicator is "or" appearing in the text with mana symbols
      const hasOrClause = /\{[wubrgc]\}(?:,?\s*\{[wubrgc]\})*,?\s+or\s+\{[wubrgc]\}/i.test(fullManaText);
      
      if (hasOrClause) {
        // This is an OR mana ability - only count as 1 mana
        // We still track it as potentially producing any of the colors for cost-checking
        // but don't double-count the total mana available
        // Extract the first mana symbol to add to the pool (player's choice will come later)
        const firstManaMatch = fullManaText.match(/\{([wubrgc])\}/i);
        if (firstManaMatch) {
          const color = firstManaMatch[1].toUpperCase();
          const colorKey = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          }[color];
          
          if (colorKey) {
            // For OR mana, we mark it as potentially producing any of the colors
            // For simplicity, we add 1 to all available colors in the OR clause
            // This is for COST CHECKING purposes - actual production requires player choice
            const orManaSymbols = fullManaText.match(/\{([wubrgc])\}/gi) || [];
            const orColors = orManaSymbols.map(sym => sym.replace(/[{}]/g, '').toUpperCase());
            
            // Only add 1 to the first color for total count purposes
            // The canPayManaCost function will handle the actual choice
            pool[colorKey] = (pool[colorKey] || 0) + 1;
            
            // Skip to next match to avoid double-counting OR mana
            continue;
          }
        }
      }
      
      // Check if this produces multiple mana at once (e.g., Sol Ring "{C}{C}", bounce lands "{B}{R}")
      const manaTokens = fullManaText.match(/\{([wubrgc])\}/gi) || [];
      
      // Check for bounce land pattern: two different colors produced at once (not OR)
      // Pattern: "{B}{R}" or "{G}{W}" without "or" between them
      const isBothAtOnce = manaTokens.length === 2 && !hasOrClause && 
        /\{[wubrgc]\}\{[wubrgc]\}/i.test(fullManaText);
      
      if (isBothAtOnce) {
        // This produces BOTH colors (like Rakdos Carnarium producing {B}{R})
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
      } else if (!hasOrClause) {
        // Standard single or same-color multiple mana (e.g., Sol Ring "{C}{C}")
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
      
      // Handle "one mana of any color" or similar abilities (Command Tower, Laser Screwdriver, etc.)
      // NOTE: We add 1 to ALL colors because the player can CHOOSE which color to produce.
      // This represents available options, not simultaneous production.
      // The actual mana payment logic (canPayManaCost) handles the choice correctly.
      // We also track the count in 'anyColor' so getTotalManaFromPool can calculate correctly.
      if (/one mana of any color|add.*any color/i.test(fullManaText)) {
        pool.white = (pool.white || 0) + 1;
        pool.blue = (pool.blue || 0) + 1;
        pool.black = (pool.black || 0) + 1;
        pool.red = (pool.red || 0) + 1;
        pool.green = (pool.green || 0) + 1;
        // Track how many "any color" sources we have for correct total calculation
        pool.anyColor = (pool.anyColor || 0) + 1;
      }
    }
  }
  
  return pool;
}
