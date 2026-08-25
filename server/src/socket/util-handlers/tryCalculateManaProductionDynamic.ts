// server/src/socket/util-handlers/tryCalculateManaProductionDynamic.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: calculateManaProduction STEP 2 dynamic ability family
//   (land count/devotion, creature-count, charge-counter artifacts, Nykthos/Nyx Lotus).
// Public entry symbols: tryCalculateManaProductionDynamic.
// Returns result when this family short-circuits (devotion color-choice with no color);
// undefined falls through to later families.

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import { DEVOTION_COLOR_PATTERNS } from "./manaProductionDevotionPatterns.js";
import { shouldApplyDevotionColorChoiceMana } from "./manaProductionDevotionHelpers.js";
import { battlefieldPermanentInstanceCount, countControlledCreaturesOfChosenType } from "../../state/modules/chosen-creature-type.js";

export type CalculateManaProductionDynamicArgs = {
  result: ManaProductionInfo;
  cardName: string;
  oracleText: string;
  manaOracleText: string;
  typeLine: string;
  battlefield: any[];
  playerId: string;
  permanent: any;
  chosenColor?: string;
  selectedAbilityLine: { lineText: string; costText: string; effectText: string } | undefined;
  selectedAbilityEffectText: string;
};

export function tryCalculateManaProductionDynamic(
  args: CalculateManaProductionDynamicArgs,
): ManaProductionInfo | undefined {
  const {
    result,
    cardName,
    oracleText,
    manaOracleText,
    typeLine,
    battlefield,
    playerId,
    permanent,
    chosenColor,
    selectedAbilityLine,
    selectedAbilityEffectText,
  } = args;

  // ===== STEP 2: Check for dynamic mana production =====
  
  // Gaea's Cradle - "Add {G} for each creature you control"
  if (cardName.includes("gaea's cradle") || 
      (oracleText.includes('add {g}') && oracleText.includes('for each creature'))) {
    const creatureCount = battlefield.reduce((sum: number, p: any) => {
      if (!p || p.controller !== playerId) return sum;
      if (!(p.card?.type_line || p.type_line || '').toLowerCase().includes('creature')) return sum;
      return sum + battlefieldPermanentInstanceCount(p);
    }, 0);
    result.isDynamic = true;
    result.baseAmount = creatureCount;
    result.dynamicDescription = `{G} for each creature you control (${creatureCount})`;
    result.colors = ['G'];
  }
  
  // Serra's Sanctum - "Add {W} for each enchantment you control"
  if (cardName.includes("serra's sanctum") ||
      (oracleText.includes('add {w}') && oracleText.includes('for each enchantment'))) {
    const enchantmentCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('enchantment')
    ).length;
    result.isDynamic = true;
    result.baseAmount = enchantmentCount;
    result.dynamicDescription = `{W} for each enchantment you control (${enchantmentCount})`;
    result.colors = ['W'];
  }
  
  // Tolarian Academy - "Add {U} for each artifact you control"
  if (cardName.includes("tolarian academy") ||
      (oracleText.includes('add {u}') && oracleText.includes('for each artifact'))) {
    const artifactCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('artifact')
    ).length;
    result.isDynamic = true;
    result.baseAmount = artifactCount;
    result.dynamicDescription = `{U} for each artifact you control (${artifactCount})`;
    result.colors = ['U'];
  }
  
  // Three Tree City - Has two abilities:
  // 1. {T}: Add {C}
  // 2. {2}, {T}: Choose a color. Add an amount of mana of that color equal to creatures of the chosen type.
  // The chosen creature type is stored on the permanent
  if (cardName.includes("three tree city")) {
    const selectedThreeTreeIsDynamicLine = !selectedAbilityLine ||
      (selectedAbilityEffectText.includes('choose a color') && selectedAbilityEffectText.includes('creatures of the chosen type'));
    const selectedThreeTreeIsColorlessLine = selectedAbilityLine && /\badd\s+\{c\}/i.test(selectedAbilityEffectText);

    if (selectedThreeTreeIsColorlessLine) {
      result.baseAmount = 1;
      result.colors = ['C'];
      result.isDynamic = false;
      result.dynamicDescription = undefined;
      result.requiresColorChoice = false;
    }

    // Get the chosen creature type from the permanent
    const chosenCreatureType = (permanent?.chosenCreatureType || '').toLowerCase();

    if (selectedThreeTreeIsDynamicLine && chosenCreatureType) {
      const creatureCount = countControlledCreaturesOfChosenType({ battlefield }, playerId, chosenCreatureType);
      
      result.isDynamic = true;
      result.baseAmount = creatureCount;
      result.dynamicDescription = `Choose a color. Add ${creatureCount} mana of that color (one for each ${chosenCreatureType} you control)`;
      // Mark as "any_combination" to trigger color choice prompt
      result.color = 'any_combination';
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      // Mark that this ability requires paying {2}
      result.activationCost = '{2}';
      result.requiresColorChoice = true;
    } else if (!selectedAbilityLine) {
      // No creature type chosen yet, just produces {C}
      result.baseAmount = 1;
      result.colors = ['C'];
    }
  }
  
  // Karametra's Acolyte - "Add an amount of {G} equal to your devotion to green"
  // This is a key devotion-based mana ability that needs proper support
    if (cardName.includes("karametra's acolyte") || 
      (manaOracleText.includes('devotion to green') && manaOracleText.includes('add'))) {
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count {G} symbols using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS['G'];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes green
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes('G')) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{G} for devotion to green (${devotion})`;
    result.colors = ['G'];
  }
  
  // Elvish Archdruid - "Add {G} for each Elf you control"
  if (cardName.includes('elvish archdruid')) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `{G} for each Elf you control (${elfCount})`;
    result.colors = ['G'];
  }
  
  // Joraga Treespeaker - Leveler card (Rule 702.87)
  // Level 0: No mana ability
  // Level 1-4: {T}: Add {G}{G}
  // Level 5+: {T}: Add {G}{G} AND other Elves you control have this ability
  if (cardName.includes('joraga treespeaker')) {
    const levelCounters = permanent?.counters?.level || 0;
    if (levelCounters >= 1) {
      // At level 1+, produces {G}{G}
      result.baseAmount = 2;
      result.colors = ['G'];
      result.dynamicDescription = `{G}{G} (Level ${levelCounters})`;
    } else {
      // Level 0: no mana ability (card just taps for nothing or has no mana ability)
      result.baseAmount = 0;
      result.colors = [];
      result.dynamicDescription = `No mana (Level 0 - needs 1+ level counters)`;
    }
  }
  
  // Check if this elf is affected by a level 5+ Joraga Treespeaker
  // At level 5+, Joraga Treespeaker grants "{T}: Add {G}{G}" to all Elves you control
  if (typeLine.includes('elf') && !cardName.includes('joraga treespeaker')) {
    // Check if player controls a Joraga Treespeaker with 5+ level counters
    const joragaLevel5Plus = battlefield.find((p: any) =>
      p && p.controller === playerId &&
      (p.card?.name || '').toLowerCase().includes('joraga treespeaker') &&
      (p.counters?.level || 0) >= 5
    );
    
    if (joragaLevel5Plus) {
      // This Elf gains "{T}: Add {G}{G}" from the level 5+ Joraga Treespeaker
      // Override existing mana production if this gives more
      if (result.baseAmount < 2 || !result.colors.includes('G')) {
        result.baseAmount = 2;
        result.colors = ['G'];
        result.dynamicDescription = `{G}{G} from Joraga Treespeaker (level 5+)`;
      }
    }
  }
  
  // Generic leveler card support - check for level-dependent mana abilities
  // Pattern: "LEVEL N1-N2" ... "{T}: Add {X}" or "LEVEL N3+" ... "{T}: Add {X}"
  if (manaOracleText.includes('level up') || manaOracleText.includes('level ')) {
    const levelCounters = permanent?.counters?.level || 0;
    
    // Look for level ability patterns with mana production
    // Pattern: LEVEL N-M ... {T}: Add {mana} or LEVEL N+ ... {T}: Add {mana}
    // Note: Using matchAll for safe iteration of global matches
    const levelRangePattern = /level\s+(\d+)-(\d+)[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    const levelPlusPattern = /level\s+(\d+)\+[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    
    let foundLevelAbility = false;
    
    // Check range patterns first (LEVEL N-M)
    for (const match of manaOracleText.matchAll(levelRangePattern)) {
      const minLevel = parseInt(match[1], 10);
      const maxLevel = parseInt(match[2], 10);
      const manaSymbols = match[3].match(/\{[wubrgc]\}/gi) || [];
      
      if (levelCounters >= minLevel && levelCounters <= maxLevel) {
        result.baseAmount = manaSymbols.length;
        result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
        result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, range ${minLevel}-${maxLevel})`;
        foundLevelAbility = true;
        break;
      }
    }
    
    // If no range matched, check plus patterns (LEVEL N+)
    if (!foundLevelAbility) {
      for (const match of manaOracleText.matchAll(levelPlusPattern)) {
        const minLevel = parseInt(match[1], 10);
        const manaSymbols = match[2].match(/\{[wubrgc]\}/gi) || [];
        
        if (levelCounters >= minLevel) {
          result.baseAmount = manaSymbols.length;
          result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
          result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, ${minLevel}+)`;
          foundLevelAbility = true;
          break;
        }
      }
    }
  }
  
  // Wirewood Channeler, Priest of Titania style - "Add {G} for each Elf"
  if (manaOracleText.includes('for each elf') || 
      (cardName.includes('priest of titania')) ||
      (cardName.includes('wirewood channeler'))) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `Mana for each Elf you control (${elfCount})`;
    if (cardName.includes('wirewood channeler')) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['G'];
    }
  }
  
  // Everflowing Chalice - "Add {C} for each charge counter on Everflowing Chalice"
  if (cardName.includes('everflowing chalice') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('add'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `{C} for each charge counter (${chargeCounters})`;
    result.colors = ['C'];
  }
  
  // Astral Cornucopia - "Add one mana of any color for each charge counter"
  if (cardName.includes('astral cornucopia') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('any color'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana for each charge counter (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Gemstone Array - Based on charge counters (can remove to add mana)
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one counter for one mana
      result.dynamicDescription = `Remove charge counter for mana (${chargeCounters} available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Empowered Autogenerator - "Add X mana of any one color, where X is the number of charge counters"
  if (cardName.includes('empowered autogenerator')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana equal to charge counters (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Nykthos / Nyx Lotus devotion ability — not the basic {T}: Add {C} line
  if (shouldApplyDevotionColorChoiceMana(
    cardName,
    selectedAbilityEffectText,
    manaOracleText,
    oracleText,
  )) {
    if (!chosenColor || !['W', 'U', 'B', 'R', 'G'].includes(chosenColor)) {
      result.isDynamic = true;
      result.baseAmount = 0;
      result.dynamicDescription = 'Choose a color. Add mana equal to your devotion to that color';
      result.colors = ['any'];
      result.requiresColorChoice = true;
      result.dynamicAmountSource = 'devotion';
      return result;
    }

    // Calculate devotion for the chosen color
    const devotionColor = chosenColor as 'W' | 'U' | 'B' | 'R' | 'G';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count occurrences of the color symbol using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes this color (e.g., {W/U} counts for both W and U)
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = [devotionColor];
  }
  
  // Cabal Coffers - "Add {B} for each Swamp you control"
  if (cardName.includes('cabal coffers') ||
      (oracleText.includes('add {b}') && oracleText.includes('for each swamp'))) {
    const swampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = swampCount;
    result.dynamicDescription = `{B} for each Swamp you control (${swampCount})`;
    result.colors = ['B'];
  }
  
  // Cabal Stronghold - Similar to Cabal Coffers but only basic Swamps
  if (cardName.includes('cabal stronghold')) {
    const basicSwampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('basic') &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = basicSwampCount;
    result.dynamicDescription = `{B} for each basic Swamp (${basicSwampCount})`;
    result.colors = ['B'];
  }
  
  // Nyx Lotus - "Add X mana of any one color, where X is your devotion to that color"
  if (cardName.includes('nyx lotus')) {
    if (!chosenColor || !['W', 'U', 'B', 'R', 'G'].includes(chosenColor)) {
      result.isDynamic = true;
      result.baseAmount = 0;
      result.dynamicDescription = 'Choose a color. Add mana equal to your devotion to that color';
      result.colors = ['any'];
      result.requiresColorChoice = true;
      result.dynamicAmountSource = 'devotion';
      return result;
    }

    const devotionColor = chosenColor as 'W' | 'U' | 'B' | 'R' | 'G';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Use pre-compiled pattern for devotion color matching
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = [devotionColor];
  }
  return undefined;
}
