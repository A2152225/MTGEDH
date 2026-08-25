// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: getAvailableMana (optimistic floating + untapped source pool).
// Public entry symbols: getAvailableMana.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { creatureHasHaste } from "../../../socket/game-actions.js";
import {
  getCommanderColorIdentity,
  getMoxAmberAvailableColors,
  isMoxAmberConditionalManaSource,
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  resolvePowerThresholdInsteadManaAbility,
} from "../mana-abilities.js";
import { canCountPermanentManaAbilities } from "./manaCheckActivationGate.js";
import { stripReminderTextFromOracle } from "./manaCheckOracleText.js";
import {
  getManaPoolFromState,
  manaSymbolToColorKey,
  applyScalingManaToOptimisticPool,
} from "./manaCheckSimplePool.js";
import {
  parseSelfRemoveCounterCost,
  getPermanentCounterAmountForManaCheck,
} from "./manaCheckRemoveCounterCost.js";
import { filterOutCostedTapMatches } from "./manaCheckCostedTapFilter.js";
import { getOpponentPermanentColors, getControlledPermanentColors } from "./manaCheckPermanentColors.js";

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
    
    const oracleText = stripReminderTextFromOracle(permanent.card.oracle_text || '').toLowerCase();
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

    if (!canCountPermanentManaAbilities(state, playerId, permanent.card.oracle_text || '')) {
      continue;
    }
    
    // Special case: Basic lands (Mountain, Island, etc.)
    // Handle these first since they don't have oracle text with mana abilities
    const isBasicLandName = /^(plains|island|swamp|mountain|forest)$/i.test(cardName);
    const isSnowCoveredBasic = /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName);
    if (isBasicLandName || isSnowCoveredBasic) {
      const baseName = cardName.replace(/^snow-covered\s+/i, '');
      const landToColor: Record<string, string> = {
        'plains': 'white',
        'island': 'blue',
        'swamp': 'black',
        'mountain': 'red',
        'forest': 'green',
      };
      const colorKey = landToColor[baseName];
      if (colorKey) {
        pool[colorKey] = (pool[colorKey] || 0) + 1;
      }
      continue; // Skip oracle text check for basic lands
    }

    // Scaling / dynamic / power-threshold-instead mana (Bighorner, Helga, Raucous Audience, etc.)
    // Handle before regex token counting, which truncates at the first period and undercounts.
    const powerInstead = resolvePowerThresholdInsteadManaAbility(state, playerId, permanent.card.oracle_text || '');
    if (powerInstead) {
      const amount = Number(powerInstead.amount || (powerInstead.producesAllAtOnce ? powerInstead.produces.length : 1));
      if (powerInstead.producesAllAtOnce && powerInstead.produces.length > 1) {
        for (const symbol of powerInstead.produces) {
          const colorKey = manaSymbolToColorKey(symbol);
          if (colorKey) pool[colorKey] = (pool[colorKey] || 0) + 1;
        }
      } else if (powerInstead.produces.length === 1) {
        applyScalingManaToOptimisticPool(pool, powerInstead.produces[0], Math.max(1, amount));
      }
      continue;
    }

    const scalingMana = getCreatureCountManaAmount(state, permanent, playerId)
      || getDevotionManaAmount(state, permanent, playerId);
    if (scalingMana && Number(scalingMana.amount || 0) > 0) {
      applyScalingManaToOptimisticPool(pool, scalingMana.color, Number(scalingMana.amount || 0));
      continue;
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
    const noCostMatches = filterOutCostedTapMatches([...oracleText.matchAll(manaAbilityNoCostPattern)], costMatches)
      .filter((match) => {
        const costText = String(match[0] || '').split(':')[0] || '';
        const removeCost = parseSelfRemoveCounterCost(costText, permanent);
        if (!removeCost) return true;
        if (!removeCost.refersToSource) return false;
        return getPermanentCounterAmountForManaCheck(permanent, removeCost.counterType) >= removeCost.count;
      });

    // IMPORTANT: A single permanent can have multiple distinct tap-for-mana abilities (multiple lines).
    // These are alternatives, not additive. We must avoid counting them as multiple mana sources.
    // Example: Riverpyre Verge has "{T}: Add {R}." and "{T}: Add {U}. ..." and should count as 1 mana.
    // We handle multi-ability single-mana cases by:
    // - Inflating each possible color by +1 (for cost-checking)
    // - Adding a marker choiceColors_<letters> so getTotalManaFromPool can correct total mana.
    if (noCostMatches.length > 1) {
      const allManaTexts = noCostMatches.map(m => String(m[1] || '').trim());

      // If any ability is an explicit multi-mana production (e.g., "{U}{R}"), prefer the highest-output ability.
      // Otherwise treat as a 1-mana choice among the available single-symbol options.
      const parsed = allManaTexts.map(t => {
        const hasOrClause = /\{[wubrgc]\}(?:,?\s*\{[wubrgc]\})*,?\s+or\s+\{[wubrgc]\}/i.test(t);
        const manaTokens = t.match(/\{([wubrgc])\}/gi) || [];
        const letters = manaTokens.map(sym => sym.replace(/[{}]/g, '').toUpperCase());
        return { text: t, hasOrClause, manaTokens, letters };
      });

      // Prefer a non-OR ability that produces the most mana at once.
      const best = parsed
        .filter(p => !p.hasOrClause)
        .sort((a, b) => (b.manaTokens.length - a.manaTokens.length))[0];

      if (best && best.manaTokens.length >= 2) {
        // Treat as deterministic multi-mana production.
        for (const token of best.manaTokens) {
          const color = token.replace(/[{}]/g, '').toUpperCase();
          const colorKey = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          }[color];
          if (colorKey) pool[colorKey] = (pool[colorKey] || 0) + 1;
        }
        continue;
      }

      // Aggregate all single-symbol options across the abilities.
      const optionLetters = new Set<string>();
      for (const p of parsed) {
        for (const l of p.letters) optionLetters.add(l);
      }

      // If this includes any-color text, let the normal any-color handler below deal with it
      // by falling back to the single-match handler. (Multi-match any-color sources are rare.
      // Keeping this conservative avoids double-counting.)
      const hasAnyColorText = allManaTexts.some(t => /one mana of any color|add.*any color/i.test(t));
      if (!hasAnyColorText && optionLetters.size >= 2) {
        // Inflate each option color by +1 for cost-checking.
        const lettersSorted = Array.from(optionLetters).sort().join('');
        for (const letter of optionLetters) {
          const colorKey = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          }[letter];
          if (colorKey) pool[colorKey] = (pool[colorKey] || 0) + 1;
        }

        // Marker used by getTotalManaFromPool to subtract inflation.
        const markerKey = `choiceColors_${lettersSorted}`;
        (pool as any)[markerKey] = Number((pool as any)[markerKey] || 0) + 1;
        continue;
      }
      // Else: fall through to process matches normally.
    }

    for (const match of noCostMatches) {
      const fullManaText = match[1].trim();
      const amberColors = isMoxAmberConditionalManaSource(cardName, fullManaText)
        ? getMoxAmberAvailableColors(state, playerId)
        : [];

      if (isMoxAmberConditionalManaSource(cardName, fullManaText)) {
        if (amberColors.length > 1) {
          const lettersSorted = amberColors.slice().sort().join('');
          for (const symbol of amberColors) {
            const colorKey = manaSymbolToColorKey(symbol);
            if (colorKey) {
              pool[colorKey] = (pool[colorKey] || 0) + 1;
            }
          }

          const markerKey = `choiceColors_${lettersSorted}`;
          (pool as any)[markerKey] = Number((pool as any)[markerKey] || 0) + 1;
        } else if (amberColors.length === 1) {
          const colorKey = manaSymbolToColorKey(amberColors[0]);
          if (colorKey) {
            pool[colorKey] = (pool[colorKey] || 0) + 1;
          }
        }
        continue;
      }
      
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
        const orManaSymbols = fullManaText.match(/\{([wubrgc])\}/gi) || [];
        const orColors = orManaSymbols.map(sym => sym.replace(/[{}]/g, '').toUpperCase());
        const optionLetters = new Set(orColors);
        
        if (optionLetters.size >= 2) {
          const lettersSorted = Array.from(optionLetters).sort().join('');
          for (const letter of optionLetters) {
            const colKey = {
              'W': 'white',
              'U': 'blue',
              'B': 'black',
              'R': 'red',
              'G': 'green',
              'C': 'colorless',
            }[letter];
            if (colKey) {
              pool[colKey] = (pool[colKey] || 0) + 1;
            }
          }
          const markerKey = `choiceColors_${lettersSorted}`;
          (pool as any)[markerKey] = Number((pool as any)[markerKey] || 0) + 1;
        } else {
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
              pool[colorKey] = (pool[colorKey] || 0) + 1;
            }
          }
        }
        
        // Skip to next match to avoid double-counting OR mana
        continue;
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
        const checksControlledLands = /that (?:a |an )?land you control could produce|among lands you control/i.test(fullManaText);
        const checksControlledPermanents = /that (?:a |an )?permanent you control could produce|among permanents you control/i.test(fullManaText);

        // Handle conditional "any color" sources like Exotic Orchard, Fellwar Stone, Reflecting Pool, etc.
        const conditionalColors = checksControlledLands || checksControlledPermanents
          ? getControlledPermanentColors(state, playerId, checksControlledLands, String(permanent.id || ''))
          : getOpponentPermanentColors(state, playerId);

        for (const colorKey of conditionalColors) {
          pool[colorKey] = (pool[colorKey] || 0) + 1;
        }

        // Add a choiceColors marker so that other modules and canPayManaCost do not overcount
        // these potential color options as multiple distinct mana sources.
        if (conditionalColors.size >= 2) {
          const optionLetterMap: Record<string, string> = {
            'white': 'W',
            'blue': 'U',
            'black': 'B',
            'red': 'R',
            'green': 'G',
            'colorless': 'C',
          };
          const letters = Array.from(conditionalColors).map(c => optionLetterMap[c]).filter(Boolean);
          if (letters.length >= 2) {
            const lettersSorted = letters.slice().sort().join('');
            const markerKey = `choiceColors_${lettersSorted}`;
            (pool as any)[markerKey] = Number((pool as any)[markerKey] || 0) + 1;
          }
        }
      }
    }

    // Non-tap self remove-counter mana (Gemstone Array, Pentad Prism, etc.).
    const nonTapManaMatches = [...oracleText.matchAll(/([^:.\n]+):\s*add\s+([^.\n]+)/gi)]
      .filter((match) => {
        const costText = String(match[1] || '').trim();
        return Boolean(costText) && !/\{[^}]*\bt\b[^}]*\}/i.test(costText);
      });
    for (const match of nonTapManaMatches) {
      const costText = String(match[1] || '').trim();
      const producedText = String(match[2] || '').trim();
      const removeCost = parseSelfRemoveCounterCost(costText, permanent);
      if (!removeCost?.refersToSource) continue;
      const available = getPermanentCounterAmountForManaCheck(permanent, removeCost.counterType);
      if (available < removeCost.count) continue;

      const uses = Math.max(1, Math.floor(available / Math.max(1, removeCost.count)));
      const isUnconditionalAnyColor = /one mana of any color|add.*any color/i.test(producedText)
        && !/that (?:a |an )?(?:land|permanent)|among (?:lands|permanents)/i.test(producedText);
      if (isUnconditionalAnyColor) {
        for (let useIndex = 0; useIndex < uses; useIndex += 1) {
          pool.white = (pool.white || 0) + 1;
          pool.blue = (pool.blue || 0) + 1;
          pool.black = (pool.black || 0) + 1;
          pool.red = (pool.red || 0) + 1;
          pool.green = (pool.green || 0) + 1;
          pool.anyColor = (pool.anyColor || 0) + 1;
        }
        continue;
      }

      const producedTokens = producedText.match(/\{([wubrgc])\}/gi) || [];
      for (let useIndex = 0; useIndex < uses; useIndex += 1) {
        for (const token of producedTokens) {
          const color = token.replace(/[{}]/g, '').toUpperCase();
          const colorKey = {
            W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless',
          }[color];
          if (colorKey) pool[colorKey] = (pool[colorKey] || 0) + 1;
        }
      }
    }
  }
  
  return pool;
}
