// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: getOpponentPermanentColors, getControlledPermanentColors
// (conditional mana like Exotic Orchard / Fellwar Stone).
// Public entry symbols: getOpponentPermanentColors, getControlledPermanentColors.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { getCommanderColorIdentity, getLandTopLayerProducibleColorSymbols } from "../mana-abilities.js";
import { stripReminderTextFromOracle } from "./manaCheckOracleText.js";

const SYMBOL_TO_COLOR_KEY: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

function addLandTopLayerColors(state: any, permanent: any, into: Set<string>): void {
  for (const symbol of getLandTopLayerProducibleColorSymbols(state, permanent)) {
    const colorKey = SYMBOL_TO_COLOR_KEY[symbol];
    if (colorKey) into.add(colorKey);
  }
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
export function getOpponentPermanentColors(state: any, playerId: PlayerID, onlyLands: boolean = true): Set<string> {
  const opponentColors = new Set<string>();
  const battlefield = state.battlefield || [];
  
  for (const permanent of battlefield) {
    // Skip this player's permanents - we only care about opponents
    if (permanent.controller === playerId) continue;
    if (!permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = stripReminderTextFromOracle(permanent.card.oracle_text || '').toLowerCase();
    const counters = permanent.counters || {};
    
    // Lands (including Ashaya creature-lands): printed types, grants, Command Tower
    // identity — never recurse into another Exotic Orchard / Fellwar / Reflecting Pool.
    if (onlyLands) {
      addLandTopLayerColors(state, permanent, opponentColors);
      continue;
    }

    if (typeLine.includes("land")) {
      addLandTopLayerColors(state, permanent, opponentColors);
      continue;
    }
    
    // Check basic lands and land subtypes first (Rule 305.6)
    const isBasicOrSubtype = /^(plains|island|swamp|mountain|forest)$/i.test(cardName) ||
      /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName) ||
      typeLine.includes("plains") || typeLine.includes("island") || typeLine.includes("swamp") || typeLine.includes("mountain") || typeLine.includes("forest");
    
    if (isBasicOrSubtype) {
      if (/plains/i.test(cardName) || typeLine.includes("plains")) opponentColors.add("white");
      if (/island/i.test(cardName) || typeLine.includes("island")) opponentColors.add("blue");
      if (/swamp/i.test(cardName) || typeLine.includes("swamp")) opponentColors.add("black");
      if (/mountain/i.test(cardName) || typeLine.includes("mountain")) opponentColors.add("red");
      if (/forest/i.test(cardName) || typeLine.includes("forest")) opponentColors.add("green");
      
      // Skip further parsing for basic-named lands with no other abilities (keeps it clean)
      if (/^(plains|island|swamp|mountain|forest)$/i.test(cardName) || /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName)) {
        continue;
      }
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
          // Command Tower type - check the controller's commander
          const controllerId = permanent.controller;
          if (controllerId) {
            const commanderColors = getCommanderColorIdentity(state, controllerId);
            for (const col of commanderColors) {
              opponentColors.add(col);
            }
          }
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

export function getControlledPermanentColors(
  state: any,
  playerId: PlayerID,
  onlyLands: boolean = true,
  excludedPermanentId?: string,
): Set<string> {
  const controlledColors = new Set<string>();
  const battlefield = state.battlefield || [];

  for (const permanent of battlefield) {
    if (permanent.controller !== playerId) continue;
    if (!permanent.card) continue;
    if (excludedPermanentId && String(permanent.id || '') === excludedPermanentId) continue;

    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const cardName = (permanent.card.name || '').toLowerCase();
    const oracleText = stripReminderTextFromOracle(permanent.card.oracle_text || '').toLowerCase();
    const counters = permanent.counters || {};

    if (onlyLands) {
      addLandTopLayerColors(state, permanent, controlledColors);
      continue;
    }

    if (typeLine.includes('land')) {
      addLandTopLayerColors(state, permanent, controlledColors);
      continue;
    }

    // Check basic lands and land subtypes first (Rule 305.6)
    const isBasicOrSubtype = /^(plains|island|swamp|mountain|forest)$/i.test(cardName) ||
      /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName) ||
      typeLine.includes("plains") || typeLine.includes("island") || typeLine.includes("swamp") || typeLine.includes("mountain") || typeLine.includes("forest");
    
    if (isBasicOrSubtype) {
      if (/plains/i.test(cardName) || typeLine.includes("plains")) controlledColors.add("white");
      if (/island/i.test(cardName) || typeLine.includes("island")) controlledColors.add("blue");
      if (/swamp/i.test(cardName) || typeLine.includes("swamp")) controlledColors.add("black");
      if (/mountain/i.test(cardName) || typeLine.includes("mountain")) controlledColors.add("red");
      if (/forest/i.test(cardName) || typeLine.includes("forest")) controlledColors.add("green");
      
      // Skip further parsing for basic-named lands with no other abilities (keeps it clean)
      if (/^(plains|island|swamp|mountain|forest)$/i.test(cardName) || /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName)) {
        continue;
      }
    }

    const manaAbilityPattern = /(?:^|[.:])\s*(?:.*?(?:tap|enters|beginning|end|whenever|when))?\s*(?:.*?)add\s+([^.\n]+)/gi;
    const matches = [...oracleText.matchAll(manaAbilityPattern)];
    const abilityContextWindow = 100;

    for (const match of matches) {
      const fullManaText = match[1].trim();
      const fullAbilityContext = match.input?.substring(
        Math.max(0, match.index! - abilityContextWindow),
        match.index! + abilityContextWindow,
      ) || '';

      if (/one mana of any color/i.test(fullManaText)) {
        const hasCommanderCondition = /commander.*color identity/i.test(fullAbilityContext);
        const hasOpponentLandCondition = /that (?:a |an )?land an opponent controls could produce/i.test(fullAbilityContext);
        const hasOpponentPermanentCondition = /that (?:a |an )?permanent an opponent controls could produce/i.test(fullAbilityContext);
        const hasControlledLandCondition = /that (?:a |an )?land you control could produce|among lands you control/i.test(fullAbilityContext);
        const hasControlledPermanentCondition = /that (?:a |an )?permanent you control could produce|among permanents you control/i.test(fullAbilityContext);
        const hasCounterReplacement = /if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter.*instead\s+add\s+one\s+mana\s+of\s+any\s+color/i.test(fullAbilityContext);

        if (hasCommanderCondition) {
          const commanderColors = getCommanderColorIdentity(state, playerId);
          for (const col of commanderColors) {
            controlledColors.add(col);
          }
          continue;
        } else if (hasOpponentLandCondition || hasOpponentPermanentCondition) {
          continue;
        } else if (hasControlledLandCondition || hasControlledPermanentCondition) {
          const nestedColors = getControlledPermanentColors(
            state,
            playerId,
            hasControlledLandCondition,
            String(permanent.id || ''),
          );
          for (const colorKey of nestedColors) {
            controlledColors.add(colorKey);
          }
          continue;
        } else if (hasCounterReplacement) {
          const counterMatch = fullAbilityContext.match(/if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter/i);
          const requiredCounterType = counterMatch ? counterMatch[1].toLowerCase() : null;

          if (requiredCounterType && counters[requiredCounterType] && counters[requiredCounterType] > 0) {
            controlledColors.add('white');
            controlledColors.add('blue');
            controlledColors.add('black');
            controlledColors.add('red');
            controlledColors.add('green');
          }
          continue;
        } else {
          controlledColors.add('white');
          controlledColors.add('blue');
          controlledColors.add('black');
          controlledColors.add('red');
          controlledColors.add('green');
          continue;
        }
      }

      const manaTokens = fullManaText.match(/\{([wubrgc])\}/gi) || [];
      for (const token of manaTokens) {
        const color = token.replace(/[{}]/g, '').toUpperCase();
        const colorKey = {
          W: 'white',
          U: 'blue',
          B: 'black',
          R: 'red',
          G: 'green',
          C: 'colorless',
        }[color];
        if (colorKey) controlledColors.add(colorKey);
      }
    }
  }

  return controlledColors;
}
