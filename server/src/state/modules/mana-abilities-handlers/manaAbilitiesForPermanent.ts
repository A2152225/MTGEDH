// Origin parent: server/src/state/modules/mana-abilities.ts
// Cluster moved: getManaAbilitiesForPermanent (native + granted tap-for-mana
// abilities, land-type remaps, Mox Amber, spend restrictions).
// Public entry symbols: getManaAbilitiesForPermanent.
// Leaf must not import mana-abilities.ts or mana-abilities-handlers/index.ts.

import { debug } from "../../../utils/debug.js";
import { libraryTopCardHasType } from "../game-state-effects.js";
import { countControlledCreaturesOfChosenType, getChosenTypeManaSpendRestriction } from "../chosen-creature-type.js";
import {
  BASIC_LAND_TYPES,
  DEFAULT_BASIC_LAND_MANA_MAP,
  REALITY_TWIST_BASIC_LAND_MANA_MAP,
  detectManaModifiers,
  getEffectiveBasicLandTypes,
  getOverridingLandTypeModifier,
  isRealityTwistActive,
} from "./manaAbilityLandTypeModifiers.js";
import type { BasicLandType, ManaAbility } from "./manaAbilityLandTypeModifiers.js";
import {
  getCommanderColorIdentity,
  getMoxAmberAvailableColors,
  isMoxAmberConditionalManaSource,
  parseManaSpendRestrictionFromOracle,
  parseSpelledOutManaAmount,
  resolveConditionalAnyColorProduces,
  resolvePermanentChosenColorSymbol,
  resolvePowerThresholdInsteadManaAbility,
} from "./manaAbilityColorRestrictionUtils.js";
import { manaAbilitiesFromContinuousTapGrants } from "./manaAbilityContinuousTapGrants.js";
import { manaAbilitiesFromQuotedTapGrants } from "./manaAbilityQuotedTapGrants.js";
import { appendTapAddMultiManaAbility } from "./manaAbilitySelfDamage.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../staticEffectSpec.js";

/**
 * Get all mana abilities for a permanent, including granted abilities
 */
export function getManaAbilitiesForPermanent(
  gameState: any,
  permanent: any,
  playerId: string
): ManaAbility[] {
  const abilities: ManaAbility[] = [];
  const card = permanent?.card;
  if (!card) return abilities;
  
  // For MDFCs (Modal Double-Faced Cards), use the selected face if specified
  // The selectedMDFCFace property is set when the card is played (see game-actions.ts playLand)
  let typeLine = (card.type_line || "").toLowerCase();
  let oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check if this is an MDFC and which face was selected
  const selectedFace = card.selectedMDFCFace;
  const cardFaces = card.card_faces;
  if (selectedFace !== undefined && Array.isArray(cardFaces) && cardFaces[selectedFace]) {
    const face = cardFaces[selectedFace];
    // Use the selected face's oracle text and type line for ability detection
    typeLine = (face.type_line || "").toLowerCase();
    oracleText = (face.oracle_text || "").toLowerCase();
    debug(2, `[getManaAbilitiesForPermanent] Using MDFC face ${selectedFace} for ${card.name}: ${face.name}`);
  }

  // Ignore quoted grant text like Cryptolith Rite's
  // `Creatures you control have "{T}: Add one mana of any color."`
  // when determining whether THIS permanent has its own native mana ability.
  const nativeOracleText = oracleText
    .replace(/(?:other\s+)?(?:nontoken\s+)?creatures you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '')
    .replace(/(?:other\s+)?lands you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '')
    .replace(/(?:other\s+)?permanents you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '')
    .replace(/as long as the top card of your library is a land card, this(?: creature)? has\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '');
  const cardName = String(card.name || '').toLowerCase();
  
  const isCreature = typeLine.includes("creature");
  const isBasic = typeLine.includes("basic");
  const isPlaneswalker = typeLine.includes("planeswalker");
  const effectiveBasicLandTypes = new Set<BasicLandType>(getEffectiveBasicLandTypes(gameState, permanent));
  const isLand = typeLine.includes("land") || effectiveBasicLandTypes.size > 0;
  const landTypeOverride = isLand ? getOverridingLandTypeModifier(gameState, permanent) : undefined;
  const landOracleText = landTypeOverride ? '' : oracleText;
  const realityTwistActive = isRealityTwistActive(gameState);
  
  // IMPORTANT: Planeswalkers should NEVER have tap abilities for mana
  // Even if their text mentions "{T}: Add {G}" (e.g., when creating tokens with that ability)
  if (isPlaneswalker) {
    return abilities; // Return empty - planeswalkers don't tap for mana
  }
  
  // Check for Metalcraft requirement (e.g., Mox Opal)
  // Rule 702.80 - Metalcraft abilities only work if you control 3+ artifacts
  if (oracleText.includes('metalcraft')) {
    const battlefield = gameState?.battlefield || [];
    const artifactCount = battlefield.filter((p: any) => {
      if (p.controller !== playerId) return false;
      const permTypeLine = (p.card?.type_line || '').toLowerCase();
      return permTypeLine.includes('artifact');
    }).length;
    
    if (artifactCount < 3) {
      // Metalcraft is not active - return no mana abilities for this permanent
      // (or only colorless if the card has a non-metalcraft ability)
      debug(2, `[getManaAbilitiesForPermanent] Metalcraft not active for ${card.name} (${artifactCount}/3 artifacts)`);
      return abilities; // Return empty - no mana abilities available
    }
  }
  
  // Get modifiers affecting this player
  const modifiers = detectManaModifiers(gameState, playerId);
  
  // Parse native mana abilities from oracle text
  // ========================================================================
  // CRITICAL: Check for explicit mana choice patterns FIRST
  // This prevents dual lands with basic types (e.g., Underground Sea = Island Swamp)
  // from being parsed as two separate single-color abilities
  // ========================================================================
  
  let hasExplicitChoicePattern = false;

  // Raucous Audience-style: "{T}: Add {G}. If you control a creature with power 4+, add {G}{G} instead."
  // Resolve before fixed-symbol parsing so we keep the upgraded amount, not only the base.
  const powerInsteadAbility = resolvePowerThresholdInsteadManaAbility(gameState, playerId, nativeOracleText);
  if (powerInsteadAbility) {
    abilities.push(powerInsteadAbility);
    hasExplicitChoicePattern = true;
  }
  
  if (isLand && landOracleText && !powerInsteadAbility) {
    // ========================================================================
    // Check for multi-mana producers (bounce lands like Rakdos Carnarium,
    // Ancient Tomb {C}{C} with optional same-ability self-damage)
    // Pattern: "{T}: Add {X}{Y}..." where X, Y are mana symbols (same or different)
    // These lands produce BOTH colors at once (not a choice)
    // ========================================================================
    if (appendTapAddMultiManaAbility(abilities, landOracleText)) {
      hasExplicitChoicePattern = true;
    }
    
    // ========================================================================
    // Check for tri-lands and dual lands with "or" format (choice of colors)
    // Pattern: "{T}: Add {X}, {Y}, or {Z}" - tri-lands like Jungle Shrine
    // Pattern: "{T}: Add {X} or {Y}" - filter/pain lands
    // These lands produce ONE color of your choice (not all at once)
    // ========================================================================
    
    // Tri-land pattern: "{t}: add {X}, {Y}, or {Z}" (e.g., Jungle Shrine)
    const triLandMatch = landOracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\},\s*\{([wubrgc])\},\s*or\s+\{([wubrgc])\}/i);
    if (triLandMatch) {
      const colors = [
        triLandMatch[1].toUpperCase(),
        triLandMatch[2].toUpperCase(),
        triLandMatch[3].toUpperCase()
      ];
      // Tri-land - offers a choice of 3 colors
      abilities.push({
        id: 'native_choice_3',
        cost: '{T}',
        produces: colors,
        producesAllAtOnce: false // Choice, not all at once
      });
      hasExplicitChoicePattern = true;
    }
    
    // Dual land "or" pattern: "{t}: add {X} or {Y}" (filter/pain lands)
    // This handles: Underground Sea, Boros Guildgate, pain lands, etc.
    const dualOrMatch = landOracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i);
    if (dualOrMatch) {
      const colors = [
        dualOrMatch[1].toUpperCase(),
        dualOrMatch[2].toUpperCase()
      ];
      // Only add if an ability with these exact colors and choice semantics doesn't already exist
      const colorKey = colors.slice().sort().join(',');
      const alreadyHasChoiceAbility = abilities.some(a => 
        !a.producesAllAtOnce && 
        a.produces.slice().sort().join(',') === colorKey
      );
      if (!alreadyHasChoiceAbility) {
        abilities.push({
          id: 'native_choice_2',
          cost: '{T}',
          produces: colors,
          producesAllAtOnce: false // Choice, not all at once
        });
        hasExplicitChoicePattern = true;
      }
    }

    // Thriving lands: "{T}: Add {G} or one mana of the chosen color."
    const thrivingOrChosenMatch = landOracleText.match(
      /\{t\}:\s*add\s+\{([wubrgc])\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r/i,
    );
    if (thrivingOrChosenMatch && !hasExplicitChoicePattern) {
      const fixedColor = String(thrivingOrChosenMatch[1] || '').toUpperCase();
      const chosenSymbol = resolvePermanentChosenColorSymbol(permanent);
      const colors = [fixedColor];
      if (chosenSymbol && chosenSymbol !== fixedColor) {
        colors.push(chosenSymbol);
      }
      if (colors.length > 0) {
        abilities.push({
          id: colors.length > 1 ? 'native_choice_2' : `native_${fixedColor.toLowerCase()}`,
          cost: '{T}',
          produces: colors,
          producesAllAtOnce: false,
        });
        hasExplicitChoicePattern = true;
      }
    }
  }
  
  // ========================================================================
  // Basic lands and lands with basic types
  // ONLY parse individual abilities if no explicit choice pattern was found
  // This prevents Underground Sea from getting U + B + (U or B choice)
  // ========================================================================
  if (!hasExplicitChoicePattern && isLand && (isBasic || effectiveBasicLandTypes.size > 0)) {
    const manaMap = realityTwistActive ? REALITY_TWIST_BASIC_LAND_MANA_MAP : DEFAULT_BASIC_LAND_MANA_MAP;
    for (const landType of BASIC_LAND_TYPES) {
      if (!effectiveBasicLandTypes.has(landType)) {
        continue;
      }
      const producedColor = manaMap[landType];
      abilities.push({ id: `native_${producedColor.toLowerCase()}`, cost: '{T}', produces: [producedColor] });
    }
  }
  
  // "Add one mana of any color" (like City of Brass, Mana Confluence, Command Tower)
  // Only match if this is a tap ability for lands or it's explicitly a mana ability
  if (isLand && landOracleText.includes("{t}:") && landOracleText.includes("add one mana of any color")) {
    // Check if this is restricted to commander's color identity
    // Pattern: "add one mana of any color in your commander's color identity"
    const isCommanderRestricted = /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(landOracleText);
    
    if (isCommanderRestricted) {
      // Get commander color identity for this player
      const commanderColors = getCommanderColorIdentity(gameState, playerId);
      
      if (commanderColors.size > 0) {
        // Only add colors in commander's color identity
        const produces: string[] = [];
        for (const colorKey of commanderColors) {
          const colorSymbol = {
            'white': 'W',
            'blue': 'U',
            'black': 'B',
            'red': 'R',
            'green': 'G',
          }[colorKey];
          if (colorSymbol) {
            produces.push(colorSymbol);
          }
        }
        abilities.push({ id: 'native_commander_any', cost: '{T}', produces });
      }
      // If no commander, this source produces nothing
    } else {
      const conditionalProduces = resolveConditionalAnyColorProduces(gameState, playerId, landOracleText);
      if (conditionalProduces) {
        if (conditionalProduces.length > 0) {
          abilities.push({ id: 'native_conditional_any', cost: '{T}', produces: conditionalProduces });
        }
      } else {
        // Unrestricted "any color" source (City of Brass, Mana Confluence, etc.)
        abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
      }
    }
  }
  
  // Colorless mana producers (lands with explicit colorless production).
  // Negative lookahead skips `{C}{C}` so Ancient Tomb stays native_multi_same.
  if (isLand && landOracleText.match(/\{t\}:\s*add\s*\{c\}(?!\{)/i)) {
    abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
  }
  
  // ========================================================================
  // Pain lands with damage (Adarkar Wastes, Yavimaya Coast, etc.)
  // Pattern: "{T}: Add {X} or {Y}. ~ deals 1 damage to you."
  // These lands have TWO abilities:
  // 1. {T}: Add {C} (already detected above)
  // 2. {T}: Add {X} or {Y} + deal 1 damage
  // ========================================================================
  if (isLand && landOracleText) {
    // Look for pain land pattern: "{t}: add {X} or {Y}. ~ deals N damage to you"
    // OR: "{t}: add {X} or {Y}. this land deals N damage to you"
    const painLandMatch = landOracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}\.\s*(?:~|this land)\s+deals\s+(\d+)\s+damage\s+to\s+you/i);
    if (painLandMatch) {
      const colors = [
        painLandMatch[1].toUpperCase(),
        painLandMatch[2].toUpperCase()
      ];
      const damageAmount = parseInt(painLandMatch[3], 10);
      
      // Only add if we haven't already added this via the "or" pattern detection
      const colorKey = colors.slice().sort().join(',');
      const alreadyHasPainAbility = abilities.some(a => 
        a.produces.slice().sort().join(',') === colorKey && a.damageEffect
      );
      
      if (!alreadyHasPainAbility) {
        abilities.push({
          id: 'native_pain',
          cost: '{T}',
          produces: colors,
          producesAllAtOnce: false,
          damageEffect: {
            type: 'damage_self',
            amount: damageAmount
          }
        });
        // Mark that we found a pain land pattern to skip the generic "or" detection
        hasExplicitChoicePattern = true;
      }
    }
  }
  
  // ========================================================================
  // Lands with "Pay life" costs (Sunbaked Canyon, Horizon Canopy, etc.)
  // Pattern: "{T}, Pay N life: Add {X} or {Y}"
  // ========================================================================
  if (isLand && landOracleText) {
    const payLifeAnyColorMatch = landOracleText.match(/\{t\},\s*pay\s+(\d+)\s+life:\s*add\s+one\s+mana\s+of\s+any\s+color/i);
    if (payLifeAnyColorMatch) {
      const lifeAmount = parseInt(payLifeAnyColorMatch[1], 10);
      abilities.push({
        id: 'native_pay_life_any',
        cost: `{T}, Pay ${lifeAmount} life`,
        produces: ['W', 'U', 'B', 'R', 'G'],
        producesAllAtOnce: false,
        additionalCosts: [{
          type: 'pay_life',
          amount: lifeAmount,
        }],
      });
    }

    const payLifeMatch = landOracleText.match(/\{t\},\s*pay\s+(\d+)\s+life:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i);
    if (payLifeMatch) {
      const lifeAmount = parseInt(payLifeMatch[1], 10);
      const colors = [
        payLifeMatch[2].toUpperCase(),
        payLifeMatch[3].toUpperCase()
      ];
      
      abilities.push({
        id: 'native_pay_life',
        cost: `{T}, Pay ${lifeAmount} life`,
        produces: colors,
        producesAllAtOnce: false,
        additionalCosts: [{
          type: 'pay_life',
          amount: lifeAmount
        }]
      });
    }
  }
  
  // ========================================================================
  // Simple single-color lands (Windbrisk Heights, Desert of the Fervent, etc.)
  // Pattern: "{T}: Add {X}." where X is a single colored mana symbol
  // This catches lands that don't have basic types and weren't caught by choice patterns
  // ========================================================================
  if (isLand && !hasExplicitChoicePattern && landOracleText) {
    // Check for each colored mana - only add if not already present
    const singleColorPatterns = [
      { pattern: /\{t\}:\s*add\s+\{w\}\.?/i, color: 'W', id: 'native_w' },
      { pattern: /\{t\}:\s*add\s+\{u\}\.?/i, color: 'U', id: 'native_u' },
      { pattern: /\{t\}:\s*add\s+\{b\}\.?/i, color: 'B', id: 'native_b' },
      { pattern: /\{t\}:\s*add\s+\{r\}\.?/i, color: 'R', id: 'native_r' },
      { pattern: /\{t\}:\s*add\s+\{g\}\.?/i, color: 'G', id: 'native_g' },
    ];
    
    for (const { pattern, color, id } of singleColorPatterns) {
      if (pattern.test(landOracleText)) {
        // Only add if we don't already have this color
        const alreadyHasColor = abilities.some(a => 
          a.produces.length === 1 && a.produces[0] === color && !a.additionalCosts
        );
        if (!alreadyHasColor) {
          abilities.push({ id, cost: '{T}', produces: [color] });
        }
      }
    }
  }
  
  // Check for creatures/artifacts with explicit tap-for-mana abilities in oracle text
  // Pattern: "{T}: Add {X}" where X is a mana symbol
  // This handles creatures like Llanowar Elves, Birds of Paradise, mana rocks, etc.
  // IMPORTANT: Only detect mana abilities if the ability is a simple "{T}: Add" pattern
  // Avoid false positives for cards with complex abilities that happen to include "add" text
  
  // List of card patterns that should NOT be considered mana producers
  const nonManaProducerPatterns = [
    'draw', 'search', 'look at', 'reveal', 'exile', 'put a', 'create', 'target', 
    'counter', 'destroy', 'return', 'mill', 'scry', 'surveil',
    'sacrifice', 'discard', 'copy', 'choose', 'gain', 'lose', 'prevent',
    'deals', 'damage', 'life', 'graveyard', 'library', 'hand'
  ];
  
  // Check if this is a mana-producing tap ability (not a utility ability)
  const hasManaProducingTapAbility = (text: string): boolean => {
    // Look for pattern: "{t}: add {X}" or "{t}: add one mana" or "{t}: add X mana"
    // Should match: "{t}: add {g}", "{t}: add one mana of any color", "{t}: add {c}{c}"
    // Should match: "{t}: add an amount of {g}" (Bighorner Rancher pattern)
    // Should NOT match: "{t}: look at the top card...add it to your hand"
    // Should NOT match: "{2}, {t}: search your library..."
    // Should NOT match: "add a +1/+1 counter", "in addition to"
    // Should NOT match: "create a token with...{t}: add {g}" (token creation)
    
    // Pattern for mana abilities - must have "{t}:" followed by "add" and then a mana indicator
    const manaPatterns = [
      /\{t\}:\s*add\s+\{[wubrgc]\}/i,              // {t}: add {G}
      /\{t\}:\s*add\s+\{[wubrgc]\}\{[wubrgc]\}/i,  // {t}: add {C}{C}
      /\{t\}:\s*add\s+one\s+mana/i,                // {t}: add one mana of any color
      /\{t\}:\s*add\s+\w+\s+mana/i,                // {t}: add X mana, add two mana, etc.
      /\{t\}:\s*add\s+an\s+amount\s+of\s+\{[wubrgc]\}/i, // {t}: add an amount of {G} (Bighorner Rancher)
      /\{t\},\s*sacrifice[^:]*:\s*add\s+/i,        // {t}, sacrifice: add (treasure-like)

      // Tap abilities with additional costs before the ':'
      // Examples: "{T}, Pay 2 life, Sacrifice this artifact: Add one mana of any color."
      /\{t\},[^:]*:\s*add\s+\{[wubrgc]\}/i,              // {t}, ...: add {G}
      /\{t\},[^:]*:\s*add\s+one\s+mana/i,                // {t}, ...: add one mana ...
      /\{t\},[^:]*:\s*add\s+\w+\s+mana/i,                // {t}, ...: add X mana
    ];
    
    for (const pattern of manaPatterns) {
      if (pattern.test(text)) {
        // Additional check: make sure this isn't part of a "create" clause
        // Find the match position
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
          // Look backwards from the match to see if "create" appears nearby
          // Skip this guard for tokens themselves (Vibranium/Powerstone oracle is only the mana line).
          const beforeMatch = text.substring(Math.max(0, match.index - 100), match.index);
          const permanentIsToken = Boolean((permanent as any)?.isToken) || /\btoken\b/i.test(typeLine);
          if (!permanentIsToken && beforeMatch.includes('create')) {
            // This is likely a token creation ability, not the permanent's own ability
            continue;
          }
        }
        return true;
      }
    }
    
    return false;
  };
  
  // Some mana abilities have additional costs before the ':' (e.g. "{T}, Sacrifice this: Add ...").
  // Treat those as valid tap-for-mana abilities too.
  if (
    !powerInsteadAbility
    && !isLand
    && (nativeOracleText.includes('{t}:') || nativeOracleText.includes('{t},'))
    && hasManaProducingTapAbility(nativeOracleText)
  ) {
    // IMPORTANT: Skip cards with "add an amount of", "add X mana in any combination"
    // or other variable/scaling patterns - those are handled by getDevotionManaAmount 
    // or getCreatureCountManaAmount functions
    const hasScalingManaAbility = 
      oracleText.includes("add an amount of") ||
      oracleText.includes("add x mana") ||
      oracleText.includes("mana in any combination") ||
      oracleText.includes("equal to your devotion") ||
      oracleText.includes("equal to the greatest power") ||
      oracleText.includes("for each");
    
    if (!hasScalingManaAbility) {
      // ========================================================================
      // Check for multi-mana producers FIRST (Sol Ring {C}{C}, Thran Dynamo {C}{C}{C}, etc.)
      // Pattern: "{T}: Add {X}{Y}..." where X, Y, Z... are mana symbols (same or different)
      // This handles artifacts that produce 2+ fixed mana of specified types.
      // Note: Variable mana (devotion, creature count) is handled by hasScalingManaAbility check above.
      // ========================================================================
      let handledAsMultiMana = appendTapAddMultiManaAbility(abilities, nativeOracleText);
      
      // Dual-choice tap abilities (Talismans): "{T}: Add {U} or {R}. This artifact deals 1 damage to you."
      // Must run before the single-symbol `{T}: Add {U}` scan, which otherwise collapses
      // the first listed color into native_u and never offers a choice.
      if (!handledAsMultiMana) {
        const dualOrMatch = nativeOracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i);
        if (dualOrMatch) {
          const colors = [
            dualOrMatch[1].toUpperCase(),
            dualOrMatch[2].toUpperCase(),
          ];
          const colorKey = colors.slice().sort().join(',');
          const alreadyHasChoiceAbility = abilities.some((ability) =>
            !ability.producesAllAtOnce &&
            ability.produces.slice().sort().join(',') === colorKey
          );
          if (!alreadyHasChoiceAbility) {
            const damageMatch = nativeOracleText.match(
              /\{t\}:\s*add\s+\{[wubrgc]\}\s+or\s+\{[wubrgc]\}\.\s*(?:~|this artifact|[^.]+?)\s+deals\s+(\d+)\s+damage\s+to\s+you/i,
            );
            const damageAmount = damageMatch ? parseInt(damageMatch[1], 10) : 0;
            abilities.push({
              id: 'native_choice_2',
              cost: '{T}',
              produces: colors,
              producesAllAtOnce: false,
              ...(Number.isFinite(damageAmount) && damageAmount > 0
                ? { damageEffect: { type: 'damage_self', amount: damageAmount } }
                : {}),
            });
          }
        }
      }

      // Only check single-color patterns if we didn't already handle as multi-mana
      if (!handledAsMultiMana) {
        // Negative lookahead skips "{T}: Add {U} or {R}" so dual-choice stays one ability.
        if (nativeOracleText.match(/\{t\}:\s*add\s+\{w\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_w', cost: '{T}', produces: ['W'] });
        }
        if (nativeOracleText.match(/\{t\}:\s*add\s+\{u\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_u', cost: '{T}', produces: ['U'] });
        }
        if (nativeOracleText.match(/\{t\}:\s*add\s+\{b\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_b', cost: '{T}', produces: ['B'] });
        }
        if (nativeOracleText.match(/\{t\}:\s*add\s+\{r\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_r', cost: '{T}', produces: ['R'] });
        }
        if (nativeOracleText.match(/\{t\}:\s*add\s+\{g\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_g', cost: '{T}', produces: ['G'] });
        }
        // Check for colorless mana
        if (nativeOracleText.match(/\{t\}:\s*add\s*\{c\}(?!\s+or\s+\{)/i)) {
          abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
        }
      }
      let handledExplicitAnyColorChoice = false;
      const nativeOracleLines = nativeOracleText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of nativeOracleLines) {
        const chosenColorMatch = line.match(
          /^((?:\{[^}]+\}|[^:])*?)\s*:\s*add\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+color/i,
        );
        if (chosenColorMatch) {
          const cost = String(chosenColorMatch[1] || '{T}').trim() || '{T}';
          const amount = parseSpelledOutManaAmount(String(chosenColorMatch[2] || 'one')) || 1;
          const colorSymbol = resolvePermanentChosenColorSymbol(permanent);
          if (colorSymbol) {
            abilities.push({
              id: 'native_chosen_color',
              cost,
              produces: [colorSymbol],
              amount,
            });
            handledExplicitAnyColorChoice = true;
          }
          continue;
        }

        const anyColorMatch = line.match(/^((?:\{[^}]+\}|[^:])*?)\s*:\s*add\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+any(?:\s+one)?\s+color/i);
        if (!anyColorMatch) {
          continue;
        }

        const cost = String(anyColorMatch[1] || '{T}').trim() || '{T}';
        const amount = parseSpelledOutManaAmount(String(anyColorMatch[2] || 'one')) || 1;

        if (isMoxAmberConditionalManaSource(cardName, line)) {
          const produces = getMoxAmberAvailableColors(gameState, playerId);
          if (produces.length > 0) {
            abilities.push({
              id: `native_any_${abilities.length}`,
              cost,
              produces,
              ...(amount > 1 ? { amount } : null),
            });
            handledExplicitAnyColorChoice = true;
          }
          continue;
        }

        const isCommanderRestricted = /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(line);
        if (isCommanderRestricted) {
          const commanderColors = getCommanderColorIdentity(gameState, playerId);
          if (commanderColors.size > 0) {
            const produces: string[] = [];
            for (const colorKey of commanderColors) {
              const colorSymbol = {
                white: 'W',
                blue: 'U',
                black: 'B',
                red: 'R',
                green: 'G',
              }[colorKey];
              if (colorSymbol) {
                produces.push(colorSymbol);
              }
            }
            if (produces.length > 0) {
              abilities.push({
                id: `native_commander_any_${abilities.length}`,
                cost,
                produces,
                ...(amount > 1 ? { amount } : null),
              });
              handledExplicitAnyColorChoice = true;
            }
          }
          continue;
        }

        const conditionalProduces = resolveConditionalAnyColorProduces(gameState, playerId, line);
        if (conditionalProduces) {
          if (conditionalProduces.length > 0) {
            abilities.push({
              id: `native_conditional_any_${abilities.length}`,
              cost,
              produces: conditionalProduces,
              ...(amount > 1 ? { amount } : null),
            });
            handledExplicitAnyColorChoice = true;
          }
          continue;
        }

        abilities.push({
          id: `native_any_${abilities.length}`,
          cost,
          produces: ['W', 'U', 'B', 'R', 'G'],
          ...(amount > 1 ? { amount } : null),
        });
        handledExplicitAnyColorChoice = true;
      }
      // Check for "any color" mana (Birds of Paradise, Arcane Signet, etc.) - but not variable amounts.
      // Support additional costs in the activation cost, e.g. "{T}, Pay 2 life, Sacrifice this: Add one mana of any color."
      if (!handledExplicitAnyColorChoice && nativeOracleText.match(/\{t\}[^:]*:\s*add\s+one\s+mana\s+of\s+any\s+color/i)) {
        if (isMoxAmberConditionalManaSource(cardName, nativeOracleText)) {
          const produces = getMoxAmberAvailableColors(gameState, playerId);
          if (produces.length > 0) {
            abilities.push({ id: 'native_any', cost: '{T}', produces });
          }
        }
        else {
        // Check if this is restricted to commander's color identity
        // Pattern: "add one mana of any color in your commander's color identity"
        const isCommanderRestricted = /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(nativeOracleText);
        
        if (isCommanderRestricted) {
          // Get commander color identity for this player
          const commanderColors = getCommanderColorIdentity(gameState, playerId);
          
          if (commanderColors.size > 0) {
            // Only add colors in commander's color identity
            const produces: string[] = [];
            for (const colorKey of commanderColors) {
              const colorSymbol = {
                'white': 'W',
                'blue': 'U',
                'black': 'B',
                'red': 'R',
                'green': 'G',
              }[colorKey];
              if (colorSymbol) {
                produces.push(colorSymbol);
              }
            }
            abilities.push({ id: 'native_commander_any', cost: '{T}', produces });
          }
          // If no commander, this source produces nothing
        } else {
          const conditionalProduces = resolveConditionalAnyColorProduces(gameState, playerId, nativeOracleText);
          if (conditionalProduces) {
            if (conditionalProduces.length > 0) {
              abilities.push({ id: 'native_conditional_any', cost: '{T}', produces: conditionalProduces });
            }
          } else {
            // Unrestricted "any color" source (Birds of Paradise, Chromatic Lantern, etc.)
            abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
          }
        }
        }
      }
    }
  }

  // Explicitly add Three Tree City's dynamic activated mana ability
  if (cardName.includes("three tree city")) {
    const chosenType = permanent?.chosenCreatureType;
    let amount = 0;
    if (chosenType) {
      amount = countControlledCreaturesOfChosenType(gameState, playerId, chosenType);
    }
    abilities.push({
      id: 'native_dynamic',
      cost: '{2}, {T}',
      produces: ['W', 'U', 'B', 'R', 'G'],
      producesAllAtOnce: false,
      amount: amount,
    });
  }
  
  const topLandManaMatch = oracleText.match(
    /\{t\}:\s*add\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+any(?:\s+one)?\s+color/i,
  );
  const hasTopLandConditionalMana = /as long as the top card of your library is a land card/i.test(oracleText);
  if (topLandManaMatch && hasTopLandConditionalMana && isCreature && String(permanent?.controller || '') === String(playerId || '')) {
    if (libraryTopCardHasType(gameState, playerId, 'land')) {
      const amount = parseSpelledOutManaAmount(String(topLandManaMatch[1] || 'two')) || 2;
      abilities.push({
        id: 'top_land_conditional_any_color',
        cost: '{T}',
        produces: ['W', 'U', 'B', 'R', 'G'],
        amount,
      });
    }
  }

  const continuousGrants = getContinuousGrantedAbilitiesForPermanent(permanent, gameState);
  abilities.push(...manaAbilitiesFromContinuousTapGrants(continuousGrants, String(permanent?.id || '')));
  abilities.push(...manaAbilitiesFromQuotedTapGrants(continuousGrants, String(permanent?.id || ''), parseManaSpendRestrictionFromOracle));

  // Apply granted abilities from modifiers
  for (const modifier of modifiers) {
    if (modifier.type === 'grant_ability' && modifier.grantedAbility) {
      const shouldApply = 
        (modifier.affects === 'lands' && isLand && permanent.controller === playerId) ||
        (modifier.affects === 'creatures' && isCreature && permanent.controller === playerId) ||
        (modifier.affects === 'all_lands' && isLand);
      
      if (shouldApply) {
        abilities.push({
          ...modifier.grantedAbility,
          isGranted: true,
          grantedBy: modifier.permanentId,
        });
      }
    }
    
  }
  
  // Deduplicate abilities by produced colors
  const uniqueAbilities: ManaAbility[] = [];
  const seenProductions = new Set<string>();
  
  for (const ability of abilities) {
    const key = ability.produces.sort().join(',') + (Number(ability.amount || 1) > 1 ? `x${ability.amount}` : '') + (ability.producesAllAtOnce ? '&' : '');
    if (!seenProductions.has(key)) {
      seenProductions.add(key);
      uniqueAbilities.push(ability);
    }
  }

  const chosenTypeSpendRestriction = getChosenTypeManaSpendRestriction(permanent, oracleText);
  if (chosenTypeSpendRestriction) {
    for (const ability of uniqueAbilities) {
      const producesAnyColor = ability.produces.length >= 5
        || ability.id === 'native_any'
        || ability.id === 'native_commander_any'
        || ability.id === 'native_pay_life_any';
      if (producesAnyColor) {
        ability.spendRestriction = chosenTypeSpendRestriction;
      }
    }
  }

  const oracleSpendRestriction = parseManaSpendRestrictionFromOracle(oracleText);
  if (oracleSpendRestriction) {
    for (const ability of uniqueAbilities) {
      if (!ability.spendRestriction) {
        ability.spendRestriction = oracleSpendRestriction;
      }
    }
  }
  
  return uniqueAbilities;
}
