// Origin parent: server/src/state/modules/mana-abilities.ts
// Cluster moved: chosen-color, Mox Amber, spend-restriction, power-threshold,
// commander identity, opponent-land colors, and exclusive helpers used by
// getManaAbilitiesForPermanent (parseSpelledOutManaAmount,
// resolveConditionalAnyColorProduces).
// Public entry symbols: resolvePermanentChosenColorSymbol,
// parseManaSpendRestrictionFromOracle, resolvePowerThresholdInsteadManaAbility,
// isMoxAmberConditionalManaSource, getMoxAmberAvailableColors,
// getLandTopLayerProducibleColorSymbols, getOpponentLandProducibleColorSymbols,
// getCommanderColorIdentity.
// Leaf must not import mana-abilities.ts or mana-abilities-handlers/index.ts.

import { getActualPowerToughness } from "../../utils.js";
import { lookupLocalCardByNameSync } from "../../../services/localCardLookup.js";
import { deriveCardColorIdentity } from "../commander.js";
import {
  DEFAULT_BASIC_LAND_MANA_MAP,
  getEffectiveBasicLandTypes,
  getOverridingLandTypeModifier,
  type ManaAbility,
} from "./manaAbilityLandTypeModifiers.js";

const COLOR_SYMBOL_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

function getCardColorSymbols(card: any): string[] {
  const colors = new Set<string>();

  if (Array.isArray(card?.colors)) {
    for (const color of card.colors) {
      const normalized = String(color || '').toUpperCase();
      if ((COLOR_SYMBOL_ORDER as readonly string[]).includes(normalized)) {
        colors.add(normalized);
      }
    }
  }

  if (colors.size === 0) {
    const manaCost = String(card?.mana_cost || '').toUpperCase();
    const manaTokens = manaCost.match(/\{([^}]+)\}/g) || [];
    for (const token of manaTokens) {
      for (const symbol of COLOR_SYMBOL_ORDER) {
        if (token.includes(symbol)) {
          colors.add(symbol);
        }
      }
    }
  }

  return COLOR_SYMBOL_ORDER.filter((color) => colors.has(color));
}

export function resolvePermanentChosenColorSymbol(permanent: any): 'W' | 'U' | 'B' | 'R' | 'G' | null {
  const colorToSymbol: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };

  const candidates = [
    permanent?.chosenColor,
    permanent?.chosenMana,
    permanent?.card?.chosenColor,
    permanent?.card?.chosenMana,
  ];

  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (!text) continue;

    const braceMatch = text.match(/^\{([WUBRG])\}$/i);
    if (braceMatch?.[1]) {
      return braceMatch[1].toUpperCase() as 'W' | 'U' | 'B' | 'R' | 'G';
    }

    const upper = text.toUpperCase();
    if ((COLOR_SYMBOL_ORDER as readonly string[]).includes(upper)) {
      return upper as 'W' | 'U' | 'B' | 'R' | 'G';
    }

    const fromName = colorToSymbol[text.toLowerCase()];
    if (fromName) {
      return fromName;
    }
  }

  return null;
}

export function parseSpelledOutManaAmount(rawAmount: string): number | undefined {
  const normalized = String(rawAmount || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const wordToAmount: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  return wordToAmount[normalized];
}

/**
 * Parse "Spend this mana only to..." clauses into ManaAbility.spendRestriction.
 * Covers common templates (abilities, creatures, Helga-style MV/{X} creature spells).
 */
export function parseManaSpendRestrictionFromOracle(
  oracleText: string,
): { restriction: import('../../../../../shared/src/types.js').ManaRestrictionType; restrictedTo?: string } | null {
  const text = String(oracleText || '').toLowerCase().replace(/[\u2019\u2018]/g, "'");

  // Powerstone / Vibranium: "This mana can't be spent to cast a nonartifact spell."
  // (CR: still legal for activated abilities, artifact spells, and non-cast costs.)
  if (/this mana can'?t be spent to cast a nonartifact spell/.test(text)) {
    return { restriction: 'no_nonartifact_spells' };
  }

  if (!text.includes('spend this mana only')) return null;

  // Helga: creature spells with mana value N or greater OR creature spells with {X} in their mana costs
  const helgaMatch = text.match(
    /spend this mana only to cast creature spells with mana value\s+(\d+)\s+or greater(?:\s+or creature spells with \{x\} in their mana costs)?/i,
  );
  if (helgaMatch) {
    return {
      restriction: 'creature_spells_mv_or_x',
      restrictedTo: String(helgaMatch[1] || '4'),
    };
  }

  if (/spend this mana only to activate abilities/.test(text)) {
    return { restriction: 'activated_abilities' };
  }

  if (/spend this mana only to cast creature spells|spend this mana only to cast creatures\b/.test(text)) {
    return { restriction: 'creatures' };
  }

  if (/spend this mana only to cast artifact spells|spend this mana only to cast artifacts\b/.test(text)) {
    return { restriction: 'artifacts' };
  }

  if (/spend this mana only to cast instant or sorcery|spend this mana only to cast instants and sorceries/.test(text)) {
    return { restriction: 'instant_sorcery' };
  }

  if (/spend this mana only to cast colorless/.test(text)) {
    return { restriction: 'colorless_spells' };
  }

  if (/spend this mana only to cast legendary/.test(text)) {
    return { restriction: 'legendary' };
  }

  if (/spend this mana only to cast multicolored/.test(text)) {
    return { restriction: 'multicolored' };
  }

  return null;
}

function playerControlsCreatureWithPowerAtLeast(
  gameState: any,
  playerId: string,
  minPower: number,
): boolean {
  const battlefield = gameState?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    if (getEffectivePowerForMana(permanent, gameState) >= minPower) return true;
  }
  return false;
}

/**
 * Raucous Audience-style upgrades:
 * "{T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead."
 */
export function resolvePowerThresholdInsteadManaAbility(
  gameState: any,
  playerId: string,
  oracleText: string,
): ManaAbility | null {
  const match = String(oracleText || '').match(
    /\{t\}:\s*add\s+(\{[wubrgc]\})\.\s*if you control a creature with power\s+(\d+)\s+or greater,\s*add\s+((?:\{[wubrgc]\})+)\s+instead/i,
  );
  if (!match) return null;

  const threshold = Number.parseInt(String(match[2] || '4'), 10) || 4;
  const upgraded = Boolean(playerControlsCreatureWithPowerAtLeast(gameState, playerId, threshold));
  const manaBlob = upgraded ? String(match[3] || '') : String(match[1] || '');
  const symbols = manaBlob.match(/\{([wubrgc])\}/gi) || [];
  if (symbols.length === 0) return null;

  const colors: string[] = [];
  for (const sym of symbols) {
    const color = sym.replace(/[{}]/g, '').toUpperCase();
    if (!colors.includes(color)) colors.push(color);
  }

  if (colors.length === 1) {
    return {
      id: upgraded ? 'native_power_upgrade' : 'native_power_base',
      cost: '{T}',
      produces: colors,
      amount: symbols.length,
    };
  }

  return {
    id: upgraded ? 'native_power_upgrade_multi' : 'native_power_base_multi',
    cost: '{T}',
    produces: colors,
    producesAllAtOnce: true,
  };
}

export function isMoxAmberConditionalManaSource(cardName: string, text: string): boolean {
  const normalizedName = String(cardName || '').trim().toLowerCase();
  const normalizedText = String(text || '').trim().toLowerCase();
  return normalizedName === 'mox amber' || normalizedText.includes('among legendary creatures and planeswalkers you control');
}

export function getMoxAmberAvailableColors(gameState: any, playerId: string): string[] {
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
  const colors = new Set<string>();

  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== String(playerId)) continue;

    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    const isQualifyingCreature = typeLine.includes('legendary') && typeLine.includes('creature');
    const isQualifyingPlaneswalker = typeLine.includes('planeswalker');

    if (!isQualifyingCreature && !isQualifyingPlaneswalker) continue;

    for (const color of getCardColorSymbols(permanent.card)) {
      colors.add(color);
    }
  }

  return COLOR_SYMBOL_ORDER.filter((color) => colors.has(color));
}

const COLOR_KEY_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

/**
 * Colors a land can produce from its own type line, granted basic types
 * (Yavimaya / Urborg / Dryad), Command Tower identity, and printed add
 * abilities. Skips "could produce" clauses so a second Exotic Orchard /
 * Fellwar Stone / Reflecting Pool does not recurse.
 */
export function getLandTopLayerProducibleColorSymbols(gameState: any, permanent: any): string[] {
  const card = permanent?.card;
  if (!card) return [];
  const typeLine = String(card.type_line || '').toLowerCase();
  const effectiveTypes = getEffectiveBasicLandTypes(gameState, permanent);
  if (!typeLine.includes('land') && effectiveTypes.length === 0) return [];

  const colors = new Set<string>();
  const oracleText = String(card.oracle_text || '').toLowerCase();
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  const isCouldProduceSource =
    /that (?:a |an )?(?:land|permanent).*could produce/i.test(oracleText)
    || /among (?:lands|permanents)/i.test(oracleText);

  for (const landType of effectiveTypes) {
    const mana = DEFAULT_BASIC_LAND_MANA_MAP[landType];
    if (mana) colors.add(mana);
  }

  if (getOverridingLandTypeModifier(gameState, permanent)) {
    return [...COLOR_SYMBOL_ORDER, 'C'].filter((color) => colors.has(color));
  }

  const isCommanderIdentitySource =
    /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(oracleText);
  if (isCommanderIdentitySource) {
    const controllerId = String(permanent.controller || '');
    if (controllerId) {
      for (const colorKey of getCommanderColorIdentity(gameState, controllerId)) {
        const symbol = COLOR_KEY_TO_SYMBOL[colorKey];
        if (symbol) colors.add(symbol);
      }
    }
  }

  if (!isCouldProduceSource) {
    const hasCounterReplacement =
      /if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter.*instead\s+add\s+one\s+mana\s+of\s+any\s+color/i.test(oracleText);
    if (hasCounterReplacement) {
      const counterMatch = oracleText.match(/if\s+.*\s+has\s+(?:a|an)\s+(\w+)\s+counter/i);
      const requiredCounterType = String(counterMatch?.[1] || '').toLowerCase();
      if (requiredCounterType && Number(counters[requiredCounterType] || 0) > 0) {
        for (const symbol of COLOR_SYMBOL_ORDER) colors.add(symbol);
      }
    } else if (
      /one mana of any color|add.*any color/i.test(oracleText)
      && !isCommanderIdentitySource
    ) {
      for (const symbol of COLOR_SYMBOL_ORDER) colors.add(symbol);
    }

    for (const match of oracleText.matchAll(/\{([wubrgc])\}/gi)) {
      const symbol = String(match[1] || '').toUpperCase();
      if ((COLOR_SYMBOL_ORDER as readonly string[]).includes(symbol as any) || symbol === 'C') {
        colors.add(symbol);
      }
    }
  }

  return [...COLOR_SYMBOL_ORDER, 'C'].filter((color) => colors.has(color));
}

/**
 * Colors opponent lands could produce (Rule 106.7), as WUBRG symbols.
 * Used by Fellwar Stone / Exotic Orchard-style mana abilities.
 * Each opponent land is resolved at the top layer only.
 */
export function getOpponentLandProducibleColorSymbols(gameState: any, playerId: string): string[] {
  const colors = new Set<string>();
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || permanent.controller === playerId) continue;
    for (const symbol of getLandTopLayerProducibleColorSymbols(gameState, permanent)) {
      if ((COLOR_SYMBOL_ORDER as readonly string[]).includes(symbol as any)) {
        colors.add(symbol);
      }
    }
  }

  return COLOR_SYMBOL_ORDER.filter((color) => colors.has(color));
}

export function resolveConditionalAnyColorProduces(gameState: any, playerId: string, abilityText: string): string[] | null {
  const text = String(abilityText || '');
  const isOpponentLandOrPermanent =
    /that (?:a |an )?(?:land|permanent) an opponent controls could produce/i.test(text)
    || /that (?:a |an )?land.*could produce/i.test(text);
  const isControlledLandOrPermanent =
    /that (?:a |an )?(?:land|permanent) you control could produce|among (?:lands|permanents) you control/i.test(text);

  if (isControlledLandOrPermanent) {
    // Reflecting Pool-style: not handled here yet; avoid falsely offering WUBRG.
    return [];
  }
  if (isOpponentLandOrPermanent) {
    return getOpponentLandProducibleColorSymbols(gameState, playerId);
  }
  return null;
}

/**
 * Get commander color identity for a player
 * Returns set of color keys (white, blue, black, red, green) in commander's color identity
 */
export function getCommanderColorIdentity(gameState: any, playerId: string): Set<string> {
  const commanderColors = new Set<string>();
  const commandZone = gameState?.commandZone?.[playerId];
  
  if (!commandZone) return commanderColors;

  const addColorSymbols = (symbols: string[]) => {
    for (const color of symbols) {
      const colorUpper = color.toUpperCase();
      const colorKey = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
      }[colorUpper];
      
      if (colorKey) {
        commanderColors.add(colorKey);
      }
    }
  };
  
  const commanderCards = commandZone.commanderCards || commandZone.commanders || [];
  
  for (const commander of commanderCards) {
    if (!commander) continue;
    addColorSymbols(deriveCardColorIdentity(commander));
  }

  if (commanderColors.size === 0) {
    const commanderNames = Array.isArray(commandZone.commanderNames) ? commandZone.commanderNames : [];
    for (const rawName of commanderNames) {
      const name = String(rawName || '').trim();
      if (!name) continue;
      const lookedUp = lookupLocalCardByNameSync(name);
      if (lookedUp) {
        addColorSymbols(deriveCardColorIdentity(lookedUp));
      }
    }
  }
  
  return commanderColors;
}

/**
 * Calculate effective power for a permanent (including counters, modifiers, etc.)
 * This is a simplified version for use in mana ability calculations
 */
export function getEffectivePowerForMana(permanent: any, gameState?: any): number {
  // Use pre-calculated effectivePower if available
  if (typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }

  const basePower = getActualPowerToughness(permanent, gameState).power;
  
  // Check for other counter types that affect power (+1/+0, +2/+2, etc.)
  let otherCounterPower = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (
        counterType === '+1/+1' ||
        counterType === '-1/-1' ||
        counterType === 'plus_one' ||
        counterType === 'plusOne' ||
        counterType === 'p1p1' ||
        counterType === 'minus_one' ||
        counterType === 'minusOne' ||
        counterType === 'm1m1'
      ) continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const pMod = parseInt(counterMatch[1], 10);
        otherCounterPower += pMod * (count as number);
      }
    }
  }
  
  // Add modifiers from equipment, auras, anthems, lords, etc.
  let modifierPower = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierPower += mod.power || 0;
      }
    }
  }
  
  return Math.max(0, basePower + otherCounterPower + modifierPower);
}
