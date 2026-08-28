// Origin parent: server/src/state/modules/mana-abilities.ts
// Cluster moved: ManaAbility / ManaModifier types, basic-land-type helpers,
// KNOWN_MANA_MODIFIERS, and detectManaModifiers.
// Public entry symbols: ManaAbility, ManaModifier, getEffectiveBasicLandTypes,
// detectManaModifiers.
// Leaf must not import mana-abilities.ts or mana-abilities-handlers/index.ts.

import { controllerHasLeftTheGame } from '../../../../../rules-engine/src/playerInGameStatus.js';

export interface ManaAbility {
  id: string;
  cost: string; // Usually "{T}" for tap, can include additional costs like "{T}, Pay 1 life"
  produces: string[]; // Colors that can be produced: ['W','U','B','R','G'] or ['any']
  amount?: number; // Amount of mana produced per color (default 1). E.g., Sol Ring produces 2 colorless, so amount=2
  producesAllAtOnce?: boolean; // True for lands like Rakdos Carnarium that produce {B}{R} (both, not choice)
  isGranted?: boolean; // True if granted by another permanent
  grantedBy?: string; // ID of permanent granting this ability
  additionalCosts?: Array<{ // Additional costs beyond tapping
    type: 'pay_life' | 'pay_mana' | 'sacrifice';
    amount?: number; // For pay_life or pay_mana
    manaCost?: string; // For pay_mana (e.g., "{1}")
  }>;
  damageEffect?: { // For pain lands like Adarkar Wastes
    type: 'damage_self';
    amount: number;
  };
  spendRestriction?: {
    restriction: import('../../../../../shared/src/index.js').ManaRestrictionType;
    restrictedTo?: string;
  };
}

export interface ManaModifier {
  permanentId: string;
  cardName: string;
  type: 'grant_ability' | 'land_type' | 'mana_multiplier' | 'extra_mana';
  affects: 'lands' | 'creatures' | 'all_lands' | 'nonbasic_lands' | 'basic_lands' | 'specific';
  grantedAbility?: ManaAbility;
  landTypes?: string[]; // For land type modifiers
  multiplier?: number; // For mana doubling (2 = double, 3 = triple)
  extraMana?: { colors: string[]; amount: number }; // For "add one additional mana"
  overridesExisting?: boolean; // Blood Moon style - replaces other abilities
  requiresColorChoice?: boolean; // For Caged Sun - needs color selection at ETB
  landTypeRequired?: string; // Only applies to lands with this type (e.g., 'swamp' for Crypt Ghast)
  requiresImprintedLandType?: boolean; // For Extraplanar Lens
  affectsAllPlayers?: boolean; // For symmetric effects like Mana Flare
  untilEndOfTurn?: boolean; // For effects that only last until end of turn
}

export const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;
export type BasicLandType = typeof BASIC_LAND_TYPES[number];

type OrderedLandTypeModifier = {
  modifier: ManaModifier;
  sourcePermanent: any;
  sourceIndex: number;
};

export const DEFAULT_BASIC_LAND_MANA_MAP: Record<BasicLandType, string> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
};

export const REALITY_TWIST_BASIC_LAND_MANA_MAP: Record<BasicLandType, string> = {
  plains: 'R',
  island: 'U',
  swamp: 'G',
  mountain: 'W',
  forest: 'B',
};

function getPrintedBasicLandTypes(typeLine: string): Set<BasicLandType> {
  const normalizedTypeLine = String(typeLine || '').toLowerCase();
  const printedTypes = new Set<BasicLandType>();
  for (const basicType of BASIC_LAND_TYPES) {
    if (normalizedTypeLine.includes(basicType)) {
      printedTypes.add(basicType);
    }
  }
  return printedTypes;
}

function getModifierBasicLandTypes(modifier: ManaModifier): Set<BasicLandType> {
  const landTypes = new Set<BasicLandType>();
  for (const landType of modifier.landTypes || []) {
    const normalizedLandType = String(landType || '').toLowerCase();
    if (BASIC_LAND_TYPES.includes(normalizedLandType as BasicLandType)) {
      landTypes.add(normalizedLandType as BasicLandType);
    }
  }
  return landTypes;
}

export function isRealityTwistActive(gameState: any): boolean {
  return Array.isArray(gameState?.battlefield) && gameState.battlefield.some((entry: any) =>
    String(entry?.card?.name || '').trim().toLowerCase() === 'reality twist'
    && !controllerHasLeftTheGame(gameState, entry?.controller)
  );
}

function modifierAppliesToLand(
  modifier: ManaModifier,
  permanent: any,
  playerId: string,
  isBasic: boolean,
): boolean {
  if (modifier.type !== 'land_type') return false;
  if (modifier.affects === 'all_lands') return true;
  if (modifier.affects === 'nonbasic_lands') return !isBasic;
  if (modifier.affects === 'basic_lands') return isBasic;
  if (modifier.affects === 'lands') return String(permanent?.controller || '') === playerId;
  return false;
}

function getOrderedLandTypeModifiers(gameState: any, playerId: string): OrderedLandTypeModifier[] {
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
  const battlefieldIndexById = new Map<string, number>();

  battlefield.forEach((permanent: any, index: number) => {
    const permanentId = String(permanent?.id || '').trim();
    if (permanentId) {
      battlefieldIndexById.set(permanentId, index);
    }
  });

  return detectManaModifiers(gameState, playerId)
    .filter((modifier): modifier is ManaModifier => modifier.type === 'land_type')
    .map(modifier => {
      const sourcePermanent = battlefield.find((permanent: any) => permanent?.id === modifier.permanentId);
      return {
        modifier,
        sourcePermanent,
        sourceIndex: battlefieldIndexById.get(String(modifier.permanentId || '')) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .filter(effect => Boolean(effect.sourcePermanent))
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function isLandTypeModifierSourceActive(
  effect: OrderedLandTypeModifier,
  allEffects: OrderedLandTypeModifier[],
): boolean {
  const sourcePermanent = effect.sourcePermanent;
  const sourceTypeLine = String(sourcePermanent?.card?.type_line || '').toLowerCase();
  if (!sourceTypeLine.includes('land')) {
    return true;
  }

  const sourceController = String(sourcePermanent?.controller || '').trim();
  const sourceIsBasic = sourceTypeLine.includes('basic');

  return !allEffects.some(otherEffect => {
    if (otherEffect.modifier.permanentId === effect.modifier.permanentId) {
      return false;
    }
    if (!otherEffect.modifier.overridesExisting) {
      return false;
    }
    return modifierAppliesToLand(otherEffect.modifier, sourcePermanent, sourceController, sourceIsBasic);
  });
}

function getActiveLandTypeModifiers(gameState: any, playerId: string): OrderedLandTypeModifier[] {
  const orderedModifiers = getOrderedLandTypeModifiers(gameState, playerId);
  return orderedModifiers.filter(effect => isLandTypeModifierSourceActive(effect, orderedModifiers));
}

export function getOverridingLandTypeModifier(gameState: any, permanent: any): OrderedLandTypeModifier | undefined {
  const playerId = String(permanent?.controller || '').trim();
  if (!playerId) {
    return undefined;
  }

  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const isBasic = typeLine.includes('basic');
  const activeModifiers = getActiveLandTypeModifiers(gameState, playerId);

  for (let index = activeModifiers.length - 1; index >= 0; index -= 1) {
    const effect = activeModifiers[index];
    if (!effect.modifier.overridesExisting) {
      continue;
    }
    if (modifierAppliesToLand(effect.modifier, permanent, playerId, isBasic)) {
      return effect;
    }
  }

  return undefined;
}

export function getEffectiveBasicLandTypes(gameState: any, permanent: any): BasicLandType[] {
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('land')) {
    return [];
  }

  const playerId = String(permanent?.controller || '').trim();
  const isBasic = typeLine.includes('basic');
  const modifiers = playerId ? getActiveLandTypeModifiers(gameState, playerId) : [];

  let effectiveTypes = getPrintedBasicLandTypes(typeLine);

  for (const effect of modifiers) {
    if (!modifierAppliesToLand(effect.modifier, permanent, playerId, isBasic)) {
      continue;
    }

    const modifierLandTypes = getModifierBasicLandTypes(effect.modifier);
    if (effect.modifier.overridesExisting) {
      effectiveTypes = modifierLandTypes;
      continue;
    }

    for (const landType of modifierLandTypes) {
      effectiveTypes.add(landType);
    }
  }

  return BASIC_LAND_TYPES.filter(landType => effectiveTypes.has(landType));
}

/**
 * Known mana modifier cards
 */
const KNOWN_MANA_MODIFIERS: Record<string, Omit<ManaModifier, 'permanentId' | 'cardName'>> = {
  // Grant "{T}: Add any color" to lands
  "chromatic lantern": {
    type: 'grant_ability',
    affects: 'lands',
    grantedAbility: { id: 'chromatic', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Grant "{T}: Add any color" to creatures
  "cryptolith rite": {
    type: 'grant_ability',
    affects: 'creatures',
    grantedAbility: { id: 'cryptolith', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Grant "{T}: Add {G}" to creatures
  "citanul hierophants": {
    type: 'grant_ability',
    affects: 'creatures',
    grantedAbility: { id: 'citanul', cost: '{T}', produces: ['G'] },
  },
  
  // All lands are Swamps (can tap for {B})
  "urborg, tomb of yawgmoth": {
    type: 'land_type',
    affects: 'all_lands',
    landTypes: ['swamp'],
    grantedAbility: { id: 'urborg', cost: '{T}', produces: ['B'] },
  },
  
  // All lands are Forests (can tap for {G})
  "yavimaya, cradle of growth": {
    type: 'land_type',
    affects: 'all_lands',
    landTypes: ['forest'],
    grantedAbility: { id: 'yavimaya', cost: '{T}', produces: ['G'] },
  },
  
  // Lands are all basic types
  "prismatic omen": {
    type: 'land_type',
    affects: 'lands',
    landTypes: ['plains', 'island', 'swamp', 'mountain', 'forest'],
    grantedAbility: { id: 'prismatic', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Nonbasic lands are Mountains (only {R})
  "blood moon": {
    type: 'land_type',
    affects: 'nonbasic_lands',
    landTypes: ['mountain'],
    grantedAbility: { id: 'bloodmoon', cost: '{T}', produces: ['R'] },
    overridesExisting: true,
  },
  
  // Same as Blood Moon
  "magus of the moon": {
    type: 'land_type',
    affects: 'nonbasic_lands',
    landTypes: ['mountain'],
    grantedAbility: { id: 'magus', cost: '{T}', produces: ['R'] },
    overridesExisting: true,
  },
  
  // Nonbasic lands are basic Plains (only {W})
  "celestial dawn": {
    type: 'land_type',
    affects: 'lands', // All your lands
    landTypes: ['plains'],
    grantedAbility: { id: 'celestial', cost: '{T}', produces: ['W'] },
    overridesExisting: true,
  },
  
  // Double mana from permanents
  "mana reflection": {
    type: 'mana_multiplier',
    affects: 'lands', // Actually all permanents
    multiplier: 2,
  },
  
  // Triple mana from permanents
  "nyxbloom ancient": {
    type: 'mana_multiplier',
    affects: 'lands', // Actually all permanents
    multiplier: 3,
  },
  
  // Triple mana from BASIC lands only
  "virtue of strength": {
    type: 'mana_multiplier',
    affects: 'basic_lands', // Only basic lands
    multiplier: 3,
  },
  
  // Lands produce extra mana
  "zendikar resurgent": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 }, // Same color as produced
  },
  
  // Lands produce extra {W} or {G}
  "mirari's wake": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 },
  },
  
  // Caged Sun - Whenever you tap a land for mana of the chosen color, add one additional mana of that color
  // Note: Caged Sun requires a color choice when it enters; we'll handle it with dynamic detection
  "caged sun": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['chosen'], amount: 1 }, // Chosen color
    requiresColorChoice: true,
  },
  
  // Gauntlet of Power - Same as Caged Sun but also affects basics that tap for the chosen color
  "gauntlet of power": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['chosen'], amount: 1 },
    requiresColorChoice: true,
  },
  
  // Gauntlet of Might - Red creatures get +1/+1, Mountains produce extra {R}
  "gauntlet of might": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['R'], amount: 1 },
    landTypeRequired: 'mountain',
  },
  
  // Extraplanar Lens - When tapping an imprinted land type, add one mana of any type that land could produce
  "extraplanar lens": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 },
    requiresImprintedLandType: true,
  },
  
  // Nirkana Revenant - Swamps produce extra {B}
  "nirkana revenant": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
  },
  
  // Crypt Ghast - Swamps produce extra {B}
  "crypt ghast": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
  },
  
  // Nissa, Who Shakes the World - Forests produce extra {G}
  // "Whenever you tap a Forest for mana, add an additional {G}."
  "nissa, who shakes the world": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['G'], amount: 1 },
    landTypeRequired: 'forest',
  },
  
  // Vorinclex, Voice of Hunger - Lands produce double mana
  "vorinclex, voice of hunger": {
    type: 'mana_multiplier',
    affects: 'lands',
    multiplier: 2,
  },
  
  // High Tide - Islands produce extra {U} (until end of turn, but we treat it as continuous for simplicity)
  "high tide": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['U'], amount: 1 },
    landTypeRequired: 'island',
    untilEndOfTurn: true,
  },
  
  // Bubbling Muck - Swamps produce extra {B} (until end of turn)
  "bubbling muck": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
    untilEndOfTurn: true,
  },
  
  // Heartbeat of Spring - All lands produce extra mana (affects all players)
  "heartbeat of spring": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Mana Flare - All lands produce extra mana (affects all players)
  "mana flare": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Dictate of Karametra - All lands produce extra mana (affects all players)
  "dictate of karametra": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Keeper of Progenitus - Lands that could produce {R}, {G}, or {W} produce extra
  "keeper of progenitus": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['R', 'G', 'W'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Creatures tap for mana equal to power
  "selvala, heart of the wilds": {
    type: 'grant_ability',
    affects: 'specific', // Just Selvala herself
    grantedAbility: { id: 'selvala', cost: '{G}, {T}', produces: ['G'] }, // Actually adds G equal to power
  },
  
  // Elves tap for {G}
  "priest of titania": {
    type: 'grant_ability',
    affects: 'specific',
    grantedAbility: { id: 'priest', cost: '{T}', produces: ['G'] }, // Adds {G} for each Elf
  },
  
  // Tap any creature for mana of any color in its cost
  "bloom tender": {
    type: 'grant_ability',
    affects: 'specific',
    grantedAbility: { id: 'bloom', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] }, // Based on permanents
  },
};

/**
 * Detect mana modifiers from battlefield permanents
 */
export function detectManaModifiers(
  gameState: any,
  playerId: string
): ManaModifier[] {
  const modifiers: ManaModifier[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (controllerHasLeftTheGame(gameState, permanent.controller)) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const controller = permanent.controller;
    
    // Check known cards
    for (const [knownName, modifierInfo] of Object.entries(KNOWN_MANA_MODIFIERS)) {
      if (cardName.includes(knownName)) {
        // Only apply if controller matches or it's a global effect
        const isGlobalEffect = modifierInfo.affects === 'all_lands' || 
                              modifierInfo.affects === 'nonbasic_lands';
        
        if (controller === playerId || isGlobalEffect) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || knownName,
            ...modifierInfo,
          });
        }
      }
    }
    
    // Generic detection for "lands you control have" patterns
    if (controller === playerId) {
      if (oracleText.includes("lands you control have") && oracleText.includes("add one mana of any color")) {
        if (!modifiers.some(m => m.permanentId === permanent.id)) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Unknown",
            type: 'grant_ability',
            affects: 'lands',
            grantedAbility: { id: `grant_${permanent.id}`, cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
          });
        }
      }
      
      if (oracleText.includes("creatures you control have") && oracleText.includes("add one mana")) {
        if (!modifiers.some(m => m.permanentId === permanent.id)) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Unknown",
            type: 'grant_ability',
            affects: 'creatures',
            grantedAbility: { id: `grant_${permanent.id}`, cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
          });
        }
      }
    }
  }
  
  return modifiers;
}
