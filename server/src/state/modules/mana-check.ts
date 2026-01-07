/**
 * mana-check.ts
 * 
 * Modular helper for checking if a player can pay mana costs.
 * Separated from can-respond.ts for better modularity and reusability.
 */

import type { PlayerID } from "../../../../shared/src";
import { creatureHasHaste } from "../../socket/game-actions.js";
import { debug } from "../../utils/debug.js";

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
  
  // Track how many anyColor sources we've used
  // When we pay a colored cost, if that color came from an anyColor source,
  // we need to decrement anyColor
  let anyColorUsed = 0;
  
  // First, pay all non-hybrid colored costs
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = remainingPool[colorKey] || 0;
    if (available < needed) {
      return false; // Can't pay this colored requirement
    }
    
    // When paying colored costs, track if we're using anyColor sources
    // If pool.anyColor > 0, then the colored mana might be from anyColor sources
    // For each colored mana we spend, if anyColor > anyColorUsed, we're using an anyColor source
    for (let i = 0; i < needed; i++) {
      if (remainingPool.anyColor && anyColorUsed < remainingPool.anyColor) {
        anyColorUsed++;
      }
    }
    
    remainingPool[colorKey] -= needed;
  }
  
  // Decrease anyColor count by the number of anyColor sources we've used
  if (remainingPool.anyColor) {
    remainingPool.anyColor = Math.max(0, remainingPool.anyColor - anyColorUsed);
  }
  
  // Then, pay hybrid costs (can use any of the specified colors)
  if (parsedCost.hybrid && parsedCost.hybrid.length > 0) {
    for (const hybridOptions of parsedCost.hybrid) {
      let paid = false;
      
      // Check if this is a Phyrexian cost (has LIFE: option)
      const isPhyrexianCost = hybridOptions.some(o => o.startsWith('LIFE:'));
      
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
                if (colorKey === 'colorless' || colorKey === 'anyColor') continue; // Skip special keys
                const available = remainingPool[colorKey as keyof typeof remainingPool];
                if (available > 0) {
                  const toDeduct = Math.min(available, toPay);
                  remainingPool[colorKey as keyof typeof remainingPool] -= toDeduct;
                  toPay -= toDeduct;
                  
                  // Track anyColor usage
                  if (remainingPool.anyColor) {
                    const colorUsed = Math.min(toDeduct, remainingPool.anyColor - anyColorUsed);
                    anyColorUsed += colorUsed;
                  }
                  
                  if (toPay === 0) break;
                }
              }
            }
            if (toPay === 0) {
              // Decrease anyColor for the hybrid payment
              if (remainingPool.anyColor) {
                remainingPool.anyColor = Math.max(0, remainingPool.anyColor - anyColorUsed);
                anyColorUsed = 0; // Reset since we've applied it
              }
              paid = true;
              break;
            }
          }
        } else {
          // Try to pay with this specific color
          const colorKey = manaColorMap[option];
          if (colorKey && remainingPool[colorKey] > 0) {
            // For Phyrexian costs, check if paying with color would leave enough for generic
            if (isPhyrexianCost) {
              // Calculate if we'd have enough after paying this color
              const totalAfterColorPayment = getTotalManaFromPool(remainingPool) - 1;
              if (totalAfterColorPayment < parsedCost.generic) {
                // Not enough mana left for generic if we pay with color
                // Skip this option and try life payment instead
                continue;
              }
            }
            
            // Track anyColor usage
            if (remainingPool.anyColor && anyColorUsed < remainingPool.anyColor) {
              anyColorUsed++;
            }
            
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
    
    // Apply anyColor reduction from hybrid costs
    if (remainingPool.anyColor) {
      remainingPool.anyColor = Math.max(0, remainingPool.anyColor - anyColorUsed);
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
 * Helper function to get commander color identity for a player
 * Returns set of color keys that the player's commander(s) can produce
 * 
 * @param state Game state
 * @param playerId The player whose commander color identity to check
 * @returns Set of color keys in commander's color identity
 */
function getCommanderColorIdentity(state: any, playerId: PlayerID): Set<string> {
  const commanderColors = new Set<string>();
  const commandZone = state?.commandZone?.[playerId];
  
  if (!commandZone) return commanderColors;
  
  const commanderCards = commandZone.commanderCards || commandZone.commanders || [];
  
  for (const commander of commanderCards) {
    if (!commander) continue;
    
    // color_identity is an array like ['W', 'U', 'B', 'R', 'G']
    const colorIdentity = commander.color_identity || [];
    
    for (const color of colorIdentity) {
      const colorUpper = color.toUpperCase();
      const colorKey = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
      }[colorUpper];
      
      if (colorKey) {
        commanderColors.add(colorKey);
      }
    }
  }
  
  return commanderColors;
}

/**
 * Helper function to get colors that opponent permanents can produce
 * Used for conditional mana sources like Exotic Orchard, Fellwar Stone, etc.
 * 
 * This function is designed to work with any permanents, but cards like Exotic Orchard
 * that say "land" should only check lands. The counter tracking works for all permanents.
 * 
 * Implements Rule 106.7: "Some abilities produce mana based on the type of mana another 
 * permanent or permanents 'could produce.' The type of mana a permanent could produce at 
 * any time includes any type of mana that an ability of that permanent would produce if 
 * the ability were to resolve at that time, taking into account any applicable replacement 
 * effects in any possible order. Ignore whether any costs of the ability could or could 
 * not be paid."
 * 
 * @param state Game state
 * @param playerId The player who controls the conditional mana source
 * @param onlyLands If true, only check lands (for Exotic Orchard). If false, check all permanents.
 * @returns Set of color keys that opponent permanents can produce
 */
function getOpponentPermanentColors(state: any, playerId: PlayerID, onlyLands: boolean = true): Set<string> {
  const opponentColors = new Set<string>();
  const battlefield = state.battlefield || [];
  
  for (const permanent of battlefield) {
    // Skip this player's permanents - we only care about opponents
    if (permanent.controller === playerId) continue;
    if (!permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const counters = permanent.counters || {};
    
    // Filter to only lands if requested (for cards like Exotic Orchard that say "land")
    if (onlyLands && !typeLine.includes("land")) continue;
    
    // Check basic lands first
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
        opponentColors.add(colorKey);
      }
      continue;
    }
    
    // Per Rule 106.7, check ALL abilities that could produce mana if they resolved
    // This includes activated abilities, triggered abilities (ETB), and static abilities
    // We check current permanent state (like counters) to determine what it COULD produce
    
    // Pattern to find mana-producing text
    // More specific than just "add" to avoid false matches in flavor text
    // Matches common mana ability patterns:
    // - "{T}: Add {X}" (activated ability)
    // - "When ~ enters the battlefield, add {X}" (triggered ability)
    // - "Add {X}" at start of sentence or after colon (mana ability)
    const manaAbilityPattern = /(?:^|[.:])\s*(?:.*?(?:tap|enters|beginning|end|whenever|when))?\s*(?:.*?)add\s+([^.\n]+)/gi;
    const matches = [...oracleText.matchAll(manaAbilityPattern)];
    
    // Context window for checking conditional text around "any color" abilities
    const ABILITY_CONTEXT_WINDOW = 100;
    
    for (const match of matches) {
      const fullManaText = match[1].trim();
      
      // Get full context to check for conditional clauses
      const fullAbilityContext = match.input?.substring(
        Math.max(0, match.index! - ABILITY_CONTEXT_WINDOW), 
        match.index! + ABILITY_CONTEXT_WINDOW
      ) || '';
      
      // Check for "any color" abilities
      // Note: We need to handle these specially based on conditions
      if (/one mana of any color/i.test(fullManaText)) {
        // Check for conditions that restrict what can be produced
        const hasCommanderCondition = /commander.*color identity/i.test(fullAbilityContext);
        const hasLandCondition = /that (?:a |an )?land.*could produce/i.test(fullAbilityContext);
        const hasPermanentCondition = /that (?:a |an )?permanent.*could produce/i.test(fullAbilityContext);
        
        // Check for replacement effects that depend on counters (Gemstone Caverns)
        // Pattern: "If X has a Y counter on it, instead add one mana of any color"
        const hasCounterReplacement = /if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter.*instead\s+add\s+one\s+mana\s+of\s+any\s+color/i.test(fullAbilityContext);
        
        if (hasCommanderCondition) {
          // Command Tower type - need to check opponent's commander
          // For now, conservatively don't add colors (would need commander info)
          continue;
        } else if (hasLandCondition || hasPermanentCondition) {
          // Exotic Orchard type - skip to avoid infinite recursion
          continue;
        } else if (hasCounterReplacement) {
          // Extract the counter type from the replacement effect
          const counterMatch = fullAbilityContext.match(/if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter/i);
          const requiredCounterType = counterMatch ? counterMatch[1].toLowerCase() : null;
          
          if (requiredCounterType && counters[requiredCounterType] && counters[requiredCounterType] > 0) {
            // This permanent HAS the required counter, so it can produce any color
            opponentColors.add('white');
            opponentColors.add('blue');
            opponentColors.add('black');
            opponentColors.add('red');
            opponentColors.add('green');
          }
          // If it doesn't have the counter, fall through to check the base ability
          continue;
        } else {
          // Unconditional "any color" - add all colors
          opponentColors.add('white');
          opponentColors.add('blue');
          opponentColors.add('black');
          opponentColors.add('red');
          opponentColors.add('green');
          continue;
        }
      }
      
      // Extract specific mana symbols from the ability text
      const manaTokens = fullManaText.match(/\{([wubrgc])\}/gi) || [];
      
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
          opponentColors.add(colorKey);
        }
      }
    }
  }
  
  return opponentColors;
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
      
      // Calculate net mana: even if cost >= produced, still include for mana fixing
      // Example: "{1}, {T}: Add {W}" costs 1 colorless to get 1 white (mana fixing)
      // Signets: "{1}, {T}: Add {W}{U}" costs 1 to get 2 (net +1)
      const netMana = Math.max(1, totalProduced - activationCostAmount);
      
      // For mana fixing sources (cost >= produced), we still count them but as 1 mana
      // This represents the ability to convert generic mana into specific colors
      const manaToAdd = totalProduced > activationCostAmount ? totalProduced - activationCostAmount : 1;
      
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
            pool[colorKey] = (pool[colorKey] || 0) + manaToAdd;
          }
        }
      } else {
        // Add mana for each color produced, accounting for activation cost
        // For signets: produces {W}{U}, costs {1}, so we add 1 of each color (net +1 total)
        // For mana fixing: produces {W}, costs {1}, we add 1 white (for color fixing)
        let addedCount = 0;
        for (const token of producedManaTokens) {
          if (addedCount >= manaToAdd) break;
          
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
            addedCount++;
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
      //
      // IMPORTANT: Exclude conditional "any color" sources like Exotic Orchard which require
      // checking opponent's lands. These patterns indicate conditional production:
      // - "that a land" / "that lands" (Exotic Orchard, Fellwar Stone, etc.)
      // - "among lands" (Reflecting Pool)
      // - "that a permanent" / "among permanents" 
      const isConditionalAnyColor = /that (?:a |an )?(?:land|permanent)|among (?:lands|permanents)/i.test(fullManaText);
      const isUnconditionalAnyColor = /one mana of any color|add.*any color/i.test(fullManaText);
      
      // Check if this is Command Tower or similar that depends on commander color identity
      const isCommanderColorIdentity = /commander.*color identity|color identity.*commander/i.test(fullManaText);
      
      if (isUnconditionalAnyColor && !isConditionalAnyColor) {
        if (isCommanderColorIdentity) {
          // Command Tower and similar - only add colors in commander's color identity
          const commanderColors = getCommanderColorIdentity(state, playerId);
          
          for (const colorKey of commanderColors) {
            pool[colorKey] = (pool[colorKey] || 0) + 1;
          }
          
          // Track as anyColor source only if we have a commander
          // (otherwise it produces nothing)
          if (commanderColors.size > 0) {
            pool.anyColor = (pool.anyColor || 0) + 1;
          }
        } else {
          // True unconditional "any color" sources (Mana Confluence, City of Brass, etc.)
          pool.white = (pool.white || 0) + 1;
          pool.blue = (pool.blue || 0) + 1;
          pool.black = (pool.black || 0) + 1;
          pool.red = (pool.red || 0) + 1;
          pool.green = (pool.green || 0) + 1;
          // Track how many "any color" sources we have for correct total calculation
          pool.anyColor = (pool.anyColor || 0) + 1;
        }
      } else if (isConditionalAnyColor) {
        // Handle conditional "any color" sources like Exotic Orchard, Fellwar Stone, etc.
        // These can only produce colors that opponent permanents can produce
        const opponentColors = getOpponentPermanentColors(state, playerId);
        
        // Add 1 to each color that opponents can produce
        // This ensures we only count mana we can actually produce
        for (const colorKey of opponentColors) {
          pool[colorKey] = (pool[colorKey] || 0) + 1;
        }
        
        // Note: We don't track these in 'anyColor' because they're not truly "any color"
        // They're restricted to what opponents can produce
      }
    }
  }
  
  return pool;
}
