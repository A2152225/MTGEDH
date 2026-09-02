// server/src/socket/util-handlers/tryCalculateManaProductionLandBasic.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: the first contiguous calculateManaProduction ability-family run
//   (STEP 1 base production: dual/tri or-choice, {T}: Add, granted/any-color,
//   thriving/chosen-color, basic land types, dual/tri refinement, legacy overlay).
// Public entry symbols: tryCalculateManaProductionLandBasic.
// Returns a result only when this family fully short-circuits; undefined falls through.

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import { parseSpelledOutAmount } from "./manaProductionAmountParse.js";
import { getEffectiveBasicLandTypes as getPrintedAndChosenBasicLandTypes, manaColorForBasicLandType } from "../../../../shared/src/landTypes.js";
import {
  getEffectiveBasicLandTypes as getBattlefieldGrantedBasicLandTypes,
  getMoxAmberAvailableColors,
  isMoxAmberConditionalManaSource,
  resolvePermanentChosenColorSymbol,
  getCommanderColorIdentity,
  getOpponentLandProducibleColorSymbols,
} from "../../state/modules/mana-abilities.js";

export type CalculateManaProductionLandBasicArgs = {
  result: ManaProductionInfo;
  card: any;
  typeLine: string;
  manaOracleText: string;
  grantedAbilities: string[];
  spelledAnyColorAmount: number | undefined;
  normalizedChosenColor: string | undefined;
  cardName: string;
  oracleText: string;
  permanent: any;
  gameState: any;
  playerId: string;
  chosenColor?: string;
  selectedLegacyManaAbility: any;
  selectedLegacyManaColors: string[];
  hasSelectedLegacyManaAbility: boolean;
};

export function tryCalculateManaProductionLandBasic(
  args: CalculateManaProductionLandBasicArgs,
): ManaProductionInfo | undefined {
  const {
    result,
    card,
    typeLine,
    manaOracleText,
    grantedAbilities,
    spelledAnyColorAmount,
    normalizedChosenColor,
    cardName,
    oracleText,
    permanent,
    gameState,
    playerId,
    chosenColor,
    selectedLegacyManaAbility,
    selectedLegacyManaColors,
    hasSelectedLegacyManaAbility,
  } = args;

  // ===== STEP 1: Determine base mana production from the card itself =====
  
  // Check for standard mana ability patterns: "{T}: Add {X}" or "{T}: Add {X}{X}"
  // This MUST match the TAP SYMBOL followed by colon followed by Add to identify a mana ability
  // This avoids matching triggered abilities or reminder text like "firebending" which mentions adding mana
  // Pattern: \{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)
  // This matches: {T}: Add {R}, or {1}, {T}: Add {R}{R}, etc.
  // Prefer full-card oracle for land tap lines so parenthetical shock-land reminders
  // ("({T}: Add {G} or {U}.)") are not lost when reminder text is stripped elsewhere.
  const landTapOracleText = typeLine.includes('land')
    ? String(card.oracle_text || '').toLowerCase()
    : manaOracleText;

  // Dual/tri "or" choice lands — one mana of a chosen color (not consecutive multi-mana).
  if (!hasSelectedLegacyManaAbility) {
    const dualOrMatch = landTapOracleText.match(
      /\{t\}(?:[,\s]*[^:]*)?:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i,
    );
    const triOrMatch = landTapOracleText.match(
      /\{t\}(?:[,\s]*[^:]*)?:\s*add\s+\{([wubrgc])\},\s*\{([wubrgc])\},\s*or\s+\{([wubrgc])\}/i,
    );
    if (triOrMatch) {
      result.baseAmount = 1;
      result.requiresColorChoice = true;
      for (const idx of [1, 2, 3]) {
        const color = String(triOrMatch[idx] || '').toUpperCase();
        if (color && !result.colors.includes(color)) result.colors.push(color);
      }
    } else if (dualOrMatch) {
      result.baseAmount = 1;
      result.requiresColorChoice = true;
      for (const idx of [1, 2]) {
        const color = String(dualOrMatch[idx] || '').toUpperCase();
        if (color && !result.colors.includes(color)) result.colors.push(color);
      }
    }

    if (
      normalizedChosenColor
      && result.requiresColorChoice === true
      && result.colors.map((c) => String(c).toUpperCase()).includes(normalizedChosenColor)
    ) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    }
  }

  const manaAbilityMatch = manaOracleText.match(/\{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)/gi);
  
  if (result.colors.length === 0 && manaAbilityMatch && manaAbilityMatch.length > 0) {
    // Use ONLY the first mana ability found (the basic tap-for-mana ability)
    const firstManaAbility = manaAbilityMatch[0];
    const symbols = firstManaAbility.match(/\{[wubrgc]\}/gi) || [];
    if (symbols.length > 0) {
      result.baseAmount = symbols.length;
      // Get the color(s) from the first mana ability only
      for (const sym of symbols) {
        const color = sym.replace(/[{}]/g, '').toUpperCase();
        if (!result.colors.includes(color)) {
          result.colors.push(color);
        }
      }
    }
  } else if (result.colors.length === 0) {
    // Fallback: Check for simpler fixed mana patterns without tap requirement
    // (for special cases like artifacts that have different activation patterns)
    const fixedManaMatch = manaOracleText.match(/add\s+((?:\{[wubrgc]\})+)/gi);
    if (fixedManaMatch && result.colors.length === 0) {
      // Only use first match to avoid picking up reminder text
      const firstMatch = fixedManaMatch[0];
      const symbols = firstMatch.match(/\{[wubrgc]\}/gi) || [];
      if (symbols.length > 0) {
        result.baseAmount = symbols.length;
        for (const sym of symbols) {
          const color = sym.replace(/[{}]/g, '').toUpperCase();
          if (!result.colors.includes(color)) {
            result.colors.push(color);
          }
        }
      }
    }
  }
  
  const grantedManaColorMap: Record<string, string> = {
    tap_for_white: 'W',
    tap_for_blue: 'U',
    tap_for_black: 'B',
    tap_for_red: 'R',
    tap_for_green: 'G',
    tap_for_colorless: 'C',
  };
  const grantedSpecificColors = Object.entries(grantedManaColorMap)
    .filter(([ability]) => grantedAbilities.includes(ability))
    .map(([, color]) => color);
  const hasGrantedAnyColorMana = grantedAbilities.some((ability) =>
    ability === 'tap_for_any_color' ||
    /\{t\}:\s*add\s+(?:one\s+)?mana of any color/.test(ability) ||
    /\{t\}:\s*add\s+(?:one\s+)?mana of any one color/.test(ability)
  );

  if (hasGrantedAnyColorMana) {
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (normalizedChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else {
      result.colors = ['any'];
      result.requiresColorChoice = true;
    }
  } else if (grantedSpecificColors.length > 0) {
    for (const color of grantedSpecificColors) {
      if (!result.colors.includes(color)) result.colors.push(color);
    }
    if (result.colors.length > 1) result.requiresColorChoice = true;
  }

  const isMoxAmberConditionalSource = isMoxAmberConditionalManaSource(cardName, oracleText);

  if (isMoxAmberConditionalSource) {
    const availableColors = getMoxAmberAvailableColors(gameState, playerId);
    if (availableColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && availableColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (availableColors.length === 1) {
      result.colors = [availableColors[0]];
      result.requiresColorChoice = false;
    } else {
      result.colors = availableColors;
      result.requiresColorChoice = true;
    }
  }

  const isCommanderColorIdentitySource =
    !isMoxAmberConditionalSource
    && /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(manaOracleText);
  const isOpponentLandConditionalSource =
    !isMoxAmberConditionalSource
    && !isCommanderColorIdentitySource
    && /that (?:a |an )?(?:land|permanent) an opponent controls could produce|that (?:a |an )?land.*could produce/i.test(manaOracleText);

  if (!hasSelectedLegacyManaAbility && isCommanderColorIdentitySource) {
    const commanderColors = Array.from(getCommanderColorIdentity(gameState, playerId))
      .map((key) => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[key]))
      .filter((sym): sym is string => Boolean(sym));
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (commanderColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && commanderColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (commanderColors.length === 1) {
      result.colors = commanderColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = commanderColors;
      result.requiresColorChoice = true;
    }
  } else if (!hasSelectedLegacyManaAbility && isOpponentLandConditionalSource) {
    const opponentColors = getOpponentLandProducibleColorSymbols(gameState, playerId);
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (opponentColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && opponentColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (opponentColors.length === 1) {
      result.colors = opponentColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = opponentColors;
      result.requiresColorChoice = true;
    }
  }

  const spelledChosenColorAmount = (() => {
    const match = manaOracleText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r\b/i);
    return match ? parseSpelledOutAmount(String(match[1] || '')) : undefined;
  })();
  const permanentChosenColor = resolvePermanentChosenColorSymbol(permanent);
  const effectiveChosenColor = normalizedChosenColor || permanentChosenColor || undefined;

  // Thriving lands: "Add {G} or one mana of the chosen color" — one mana, choose fixed or ETB color.
  const thrivingOrChosenMatch = !hasSelectedLegacyManaAbility
    ? manaOracleText.match(/\badd\s+\{([wubrgc])\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r\b/i)
    : null;
  if (thrivingOrChosenMatch) {
    const fixedColor = String(thrivingOrChosenMatch[1] || '').toUpperCase();
    const choiceColors: string[] = [fixedColor];
    if (permanentChosenColor && permanentChosenColor !== fixedColor) {
      choiceColors.push(permanentChosenColor);
    }
    result.baseAmount = 1;
    if (
      normalizedChosenColor
      && choiceColors.includes(normalizedChosenColor)
    ) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (choiceColors.length === 1) {
      result.colors = choiceColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = choiceColors;
      result.requiresColorChoice = true;
    }
  }
  // "Add N mana of the chosen color" — reuse ETB color choice (Throne of Eldraine, etc.)
  else if (!hasSelectedLegacyManaAbility && /\bmana\s+of\s+the\s+chosen\s+colou?r\b/i.test(manaOracleText)) {
    if (typeof spelledChosenColorAmount === 'number' && spelledChosenColorAmount > 0) {
      result.baseAmount = spelledChosenColorAmount;
    }
    if (effectiveChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(effectiveChosenColor)) {
      result.colors = [effectiveChosenColor];
      result.requiresColorChoice = false;
    }
  }
  // Check for "any color" patterns
  else if (
    !hasSelectedLegacyManaAbility
    && !isMoxAmberConditionalSource
    && !isCommanderColorIdentitySource
    && !isOpponentLandConditionalSource
    && (manaOracleText.includes('any color') || manaOracleText.includes('mana of any color'))
  ) {
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (effectiveChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(effectiveChosenColor)) {
      result.colors = [effectiveChosenColor];
      result.requiresColorChoice = false;
    } else {
      result.colors = ['any'];
      result.requiresColorChoice = true;
    }
  }
  
  // Handle basic land types (printed + chosen-type grants like Thran Portal,
  // plus battlefield grants such as Yavimaya, Cradle of Growth / Urborg).
  if (!hasSelectedLegacyManaAbility) {
    const effectiveBasicTypes = [
      ...getPrintedAndChosenBasicLandTypes(permanent as any),
      ...getBattlefieldGrantedBasicLandTypes(gameState, permanent),
    ];
    let addedGrantedOrPrintedType = false;
    for (const landType of effectiveBasicTypes) {
      const mana = manaColorForBasicLandType(landType);
      if (mana && !result.colors.includes(mana)) {
        result.colors.push(mana);
        addedGrantedOrPrintedType = true;
      }
    }
    if (!addedGrantedOrPrintedType && effectiveBasicTypes.length === 0) {
      if (typeLine.includes('plains') && !result.colors.includes('W')) result.colors.push('W');
      if (typeLine.includes('island') && !result.colors.includes('U')) result.colors.push('U');
      if (typeLine.includes('swamp') && !result.colors.includes('B')) result.colors.push('B');
      if (typeLine.includes('mountain') && !result.colors.includes('R')) result.colors.push('R');
      if (typeLine.includes('forest') && !result.colors.includes('G')) result.colors.push('G');
    }
  }

  // Dual/tri lands (and shock lands with parenthetical "{T}: Add {G} or {U}") produce ONE mana
  // of a chosen color — never all listed colors at once. Without this, auto-tap payment for {2}
  // can treat Breeding Pool as 2 mana from a single tap.
  if (
    !hasSelectedLegacyManaAbility
    && result.requiresColorChoice !== true
    && !result.colors.some((color) => String(color || '').toUpperCase() === 'ANY')
  ) {
    const fixedColors = result.colors
      .map((color) => String(color || '').toUpperCase())
      .filter((color) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color));
    if (fixedColors.length > 1) {
      const fullOracleLower = String(card.oracle_text || '').toLowerCase();
      const hasExplicitOrChoice =
        /add\s+\{[wubrgc]\}\s+or\s+\{[wubrgc]\}/i.test(fullOracleLower)
        || /add\s+\{[wubrgc]\},\s*\{[wubrgc]\},\s*or\s+\{[wubrgc]\}/i.test(fullOracleLower);
      const hasConsecutiveMultiMana = /add\s+(?:\{[wubrgc]\}){2,}/i.test(fullOracleLower);
      const looksLikeAllAtOnce =
        hasConsecutiveMultiMana
        && Number(result.baseAmount || 0) >= fixedColors.length
        && !hasExplicitOrChoice;
      if (!looksLikeAllAtOnce) {
        result.requiresColorChoice = true;
        result.baseAmount = 1;
        if (normalizedChosenColor && fixedColors.includes(normalizedChosenColor)) {
          result.colors = [normalizedChosenColor];
          result.requiresColorChoice = false;
        }
      }
    }
  }

  if (hasSelectedLegacyManaAbility) {
    const explicitAmount = Number(selectedLegacyManaAbility?.amount || 0);
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    } else if (Number.isFinite(explicitAmount) && explicitAmount > 0) {
      result.baseAmount = explicitAmount;
    }

    if (selectedLegacyManaAbility?.producesAllAtOnce === true && selectedLegacyManaColors.length > 0) {
      result.colors = selectedLegacyManaColors;
      result.requiresColorChoice = false;
    } else if (selectedLegacyManaColors.length > 1) {
      if (normalizedChosenColor && selectedLegacyManaColors.includes(normalizedChosenColor)) {
        result.colors = [normalizedChosenColor];
        result.requiresColorChoice = false;
      } else {
        result.colors = selectedLegacyManaColors;
        result.requiresColorChoice = true;
      }
    } else if (selectedLegacyManaColors.length === 1) {
      result.colors = selectedLegacyManaColors;
      result.requiresColorChoice = false;
    }
  }
  return undefined;
}
