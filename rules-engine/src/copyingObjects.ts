/**
 * Rule 707: Copying Objects
 * 
 * This module implements the comprehensive rules for copying objects in Magic: The Gathering,
 * including copying permanents, spells, abilities, and cards.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 707
 */

/**
 * Copiable values are the characteristics derived from the text printed on the object,
 * as modified by other copy effects, face-down status, and certain replacement effects.
 * 
 * Rule 707.2: The copiable values include: name, mana cost, color indicator, card type,
 * subtype, supertype, rules text, power, toughness, and/or loyalty.
 * 
 * NOT copied: Other effects, status, counters, and stickers.
 */
export interface CopiableValues {
  readonly name: string;
  readonly manaCost: string | null;
  readonly colorIndicator: readonly string[] | null;
  readonly cardTypes: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly rulesText: string;
  readonly power: number | string | null; // number or * or null
  readonly toughness: number | string | null; // number or * or null
  readonly loyalty: number | null;
}

/**
 * Represents a copy effect that can be applied to an object.
 * 
 * Rule 707.9: Copy effects may include modifications or exceptions.
 */
export interface CopyEffect {
  readonly sourceId: string;
  readonly copiableValues: CopiableValues;
  readonly modifications?: CopyModification[];
  readonly exceptions?: CopyException[];
}

/**
 * Modifications to characteristics as part of the copying process.
 * 
 * Rule 707.9b: Some copy effects modify a characteristic as part of the copying process.
 */
export interface CopyModification {
  readonly type: 'add-ability' | 'modify-types' | 'modify-power-toughness' | 'modify-colors' | 'modify-other';
  readonly description: string;
  readonly applyModification: (values: CopiableValues) => CopiableValues;
}

/**
 * Exceptions to the copying process.
 * 
 * Rule 707.9c: Some copy effects don't copy certain characteristics.
 */
export interface CopyException {
  readonly type: 'retain-original' | 'dont-copy' | 'provide-specific-values' | 'additional-effect';
  readonly characteristicsAffected: readonly ('name' | 'mana-cost' | 'color' | 'types' | 'power-toughness' | 'loyalty' | 'abilities')[];
  readonly description: string;
}

/**
 * Represents a permanent copy operation.
 */
export interface PermanentCopy {
  readonly type: 'permanent';
  readonly copyId: string;
  readonly sourceId: string;
  readonly copiableValues: CopiableValues;
  readonly enteredAsCopy: boolean; // Rule 707.5: "as a copy" or "that's a copy"
  readonly modifications: readonly CopyModification[];
}

/**
 * Represents a spell copy operation.
 * 
 * Rule 707.10: To copy a spell means to put a copy of it onto the stack.
 * A copy of a spell isn't cast.
 */
export interface SpellCopy {
  readonly type: 'spell';
  readonly copyId: string;
  readonly originalSpellId: string;
  readonly copiableValues: CopiableValues;
  readonly mode: number | null; // Modal spell mode
  readonly targets: readonly string[];
  readonly xValue: number | null;
  readonly wasKicked: boolean;
  readonly additionalCosts: readonly string[];
  readonly alternativeCosts: readonly string[];
  readonly controllerId: string; // Rule 707.10: Copy is controlled by player who put it on stack
  readonly ownerId: string; // Rule 707.10: Copy is owned by player under whose control it was put
}

/**
 * Represents an ability copy operation.
 * 
 * Rule 707.10: To copy an ability means to put a copy of it onto the stack.
 * A copy of an activated ability isn't activated.
 */
export interface AbilityCopy {
  readonly type: 'ability';
  readonly copyId: string;
  readonly originalAbilityId: string;
  readonly sourceId: string; // Rule 707.10b: Copy has same source as original
  readonly copiableValues: CopiableValues;
  readonly mode: number | null;
  readonly targets: readonly string[];
  readonly xValue: number | null;
  readonly controllerId: string;
}

/**
 * Represents a token created as a copy of another object.
 */
export interface TokenCopy {
  readonly type: 'token';
  readonly tokenId: string;
  readonly sourceId: string;
  readonly copiableValues: CopiableValues;
  readonly isDoubleFaced: boolean; // Rule 707.8a: Tokens can be double-faced
  readonly frontFace: CopiableValues;
  readonly backFace: CopiableValues | null;
  readonly currentFaceUp: 'front' | 'back';
}

/**
 * Union type for all copy types.
 */
export type Copy = PermanentCopy | SpellCopy | AbilityCopy | TokenCopy;

/**
 * Extract copiable values from an object.
 * 
 * Rule 707.2: Copiable values are derived from printed text, modified by copy effects,
 * face-down status, and certain replacement effects.
 * 
 * @param objectId - The ID of the object to extract values from
 * @param currentValues - The current characteristics of the object
 * @returns The copiable values
 */
export function getCopiableValues(
  objectId: string,
  currentValues: CopiableValues
): CopiableValues {
  // Return the copiable values (in actual implementation, this would filter
  // out effects that aren't copiable like continuous effects, counters, etc.)
  return { ...currentValues };
}

/**
 * Create a copy of a permanent.
 * 
 * Rule 707.1: Some objects become or turn another object into a "copy" of a permanent.
 * 
 * @param copyId - The ID for the new copy
 * @param sourceId - The ID of the permanent being copied
 * @param copiableValues - The copiable values to copy
 * @param enteredAsCopy - Whether it enters as a copy (Rule 707.5)
 * @param modifications - Optional modifications to the copy
 * @returns A new permanent copy
 */
export function createPermanentCopy(
  copyId: string,
  sourceId: string,
  copiableValues: CopiableValues,
  enteredAsCopy: boolean = false,
  modifications: readonly CopyModification[] = []
): PermanentCopy {
  return {
    type: 'permanent',
    copyId,
    sourceId,
    copiableValues: applyModifications(copiableValues, modifications),
    enteredAsCopy,
    modifications,
  };
}

/**
 * Create a copy of a spell on the stack.
 * 
 * Rule 707.10: To copy a spell means to put a copy of it onto the stack.
 * A copy isn't cast and copies all characteristics and decisions.
 * 
 * @param copyId - The ID for the new copy
 * @param originalSpellId - The ID of the spell being copied
 * @param copiableValues - The copiable values to copy
 * @param decisions - The decisions made when casting the original spell
 * @param controllerId - The player who controls the copy
 * @param ownerId - The owner of the copy
 * @returns A new spell copy
 */
export function createSpellCopy(
  copyId: string,
  originalSpellId: string,
  copiableValues: CopiableValues,
  decisions: {
    mode?: number;
    targets?: readonly string[];
    xValue?: number;
    wasKicked?: boolean;
    additionalCosts?: readonly string[];
    alternativeCosts?: readonly string[];
  },
  controllerId: string,
  ownerId: string
): SpellCopy {
  return {
    type: 'spell',
    copyId,
    originalSpellId,
    copiableValues,
    mode: decisions.mode ?? null,
    targets: decisions.targets ?? [],
    xValue: decisions.xValue ?? null,
    wasKicked: decisions.wasKicked ?? false,
    additionalCosts: decisions.additionalCosts ?? [],
    alternativeCosts: decisions.alternativeCosts ?? [],
    controllerId,
    ownerId,
  };
}

/**
 * Create a copy of an ability on the stack.
 * 
 * Rule 707.10: To copy an ability means to put a copy of it onto the stack.
 * 
 * @param copyId - The ID for the new copy
 * @param originalAbilityId - The ID of the ability being copied
 * @param sourceId - The source of the ability
 * @param copiableValues - The copiable values to copy
 * @param decisions - The decisions made when activating/triggering the original
 * @param controllerId - The player who controls the copy
 * @returns A new ability copy
 */
export function createAbilityCopy(
  copyId: string,
  originalAbilityId: string,
  sourceId: string,
  copiableValues: CopiableValues,
  decisions: {
    mode?: number;
    targets?: readonly string[];
    xValue?: number;
  },
  controllerId: string
): AbilityCopy {
  return {
    type: 'ability',
    copyId,
    originalAbilityId,
    sourceId, // Rule 707.10b: Copy has same source
    copiableValues,
    mode: decisions.mode ?? null,
    targets: decisions.targets ?? [],
    xValue: decisions.xValue ?? null,
    controllerId,
  };
}

/**
 * Create a token that is a copy of another object.
 * 
 * Rule 707.1: Some effects create a token that's a copy of another object.
 * 
 * @param tokenId - The ID for the new token
 * @param sourceId - The ID of the object being copied
 * @param copiableValues - The copiable values to copy
 * @param isDoubleFaced - Whether the token is double-faced (Rule 707.8a)
 * @param backFace - The back face values if double-faced
 * @param faceUp - Which face is currently up
 * @returns A new token copy
 */
export function createTokenCopy(
  tokenId: string,
  sourceId: string,
  copiableValues: CopiableValues,
  isDoubleFaced: boolean = false,
  backFace: CopiableValues | null = null,
  faceUp: 'front' | 'back' = 'front'
): TokenCopy {
  return {
    type: 'token',
    tokenId,
    sourceId,
    copiableValues,
    isDoubleFaced,
    frontFace: copiableValues,
    backFace,
    currentFaceUp: faceUp,
  };
}

/**
 * Apply modifications to copiable values.
 * 
 * Rule 707.9: Copy effects may include modifications or exceptions.
 * 
 * @param values - The original copiable values
 * @param modifications - The modifications to apply
 * @returns The modified copiable values
 */
export function applyModifications(
  values: CopiableValues,
  modifications: readonly CopyModification[]
): CopiableValues {
  return modifications.reduce(
    (current, mod) => mod.applyModification(current),
    values
  );
}

/**
 * Change what a permanent is copying while it remains on the battlefield.
 * 
 * Rule 707.4: Some effects cause a permanent that's copying a permanent to copy a
 * different object while remaining on the battlefield. The change doesn't trigger
 * enters/leaves-the-battlefield abilities and doesn't change noncopy effects.
 * 
 * @param permanentId - The ID of the permanent changing its copy
 * @param newSourceId - The ID of the new object to copy
 * @param newCopiableValues - The new copiable values
 * @returns Updated permanent copy
 */
export function changeWhatPermanentIsCopying(
  permanentId: string,
  newSourceId: string,
  newCopiableValues: CopiableValues,
  modifications: readonly CopyModification[] = []
): PermanentCopy {
  return {
    type: 'permanent',
    copyId: permanentId,
    sourceId: newSourceId,
    copiableValues: applyModifications(newCopiableValues, modifications),
    enteredAsCopy: false, // Already on battlefield
    modifications,
  };
}

/**
 * Choose new targets for a copy of a spell or ability.
 * 
 * Rule 707.10c: Some effects copy a spell or ability and state that its controller
 * may choose new targets. The player may leave any number unchanged, even if illegal.
 * 
 * @param copy - The spell or ability copy
 * @param newTargets - The new targets (can include original targets)
 * @returns Updated copy with new targets
 */
export function chooseNewTargetsForCopy(
  copy: SpellCopy | AbilityCopy,
  newTargets: readonly string[]
): SpellCopy | AbilityCopy {
  return { ...copy, targets: newTargets };
}

/**
 * Check if a copy should cease to exist due to state-based actions.
 * 
 * Rule 707.10a: If a copy of a spell is in a zone other than the stack, it ceases to exist.
 * If a copy of a card is in any zone other than the stack or battlefield, it ceases to exist.
 * 
 * @param copy - The copy to check
 * @param zone - The zone the copy is in
 * @returns Whether the copy should cease to exist
 */
export function shouldCopyCeaseToExist(
  copy: Copy,
  zone: 'stack' | 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library' | 'command'
): boolean {
  if (copy.type === 'spell') {
    // Spell copies cease to exist if not on stack
    return zone !== 'stack';
  }
  
  if (copy.type === 'ability') {
    // Ability copies only exist on stack
    return zone !== 'stack';
  }
  
  if (copy.type === 'permanent' || copy.type === 'token') {
    // Card copies cease to exist if not on stack or battlefield
    return zone !== 'stack' && zone !== 'battlefield';
  }
  
  return false;
}

/**
 * Check if linked abilities should be linked on the copy.
 * 
 * Rule 707.7: If a pair of linked abilities are copied, those abilities will be
 * similarly linked to one another on the object that copied them.
 * 
 * @param originalAbilityId - The ID of the original ability
 * @param linkedAbilityId - The ID of the linked ability
 * @returns Whether the abilities should be linked on the copy
 */
export function areAbilitiesLinkedOnCopy(
  originalAbilityId: string,
  linkedAbilityId: string
): boolean {
  // Abilities that were linked on the original are linked on the copy
  // They can't be linked to any other abilities
  return true;
}

/**
 * Create a double-faced token copy of a double-faced permanent.
 * 
 * Rule 707.8a: If an effect creates a token that is a copy of a double-faced permanent,
 * the resulting token is a double-faced token with both faces.
 * 
 * @param tokenId - The ID for the token
 * @param sourceId - The ID of the double-faced permanent being copied
 * @param frontFace - The front face copiable values
 * @param backFace - The back face copiable values
 * @param currentFaceUp - Which face is currently up
 * @returns A double-faced token copy
 */
export function createDoubleFacedTokenCopy(
  tokenId: string,
  sourceId: string,
  frontFace: CopiableValues,
  backFace: CopiableValues,
  currentFaceUp: 'front' | 'back' = 'front'
): TokenCopy {
  return createTokenCopy(
    tokenId,
    sourceId,
    currentFaceUp === 'front' ? frontFace : backFace,
    true,
    backFace,
    currentFaceUp
  );
}

/**
 * Helper function to create a modification that adds an ability.
 * 
 * Rule 707.9a: Some copy effects cause the copy to gain an ability as part of
 * the copying process.
 * 
 * @param abilityText - The text of the ability to add
 * @returns A copy modification that adds the ability
 */
export function addAbilityModification(abilityText: string): CopyModification {
  return {
    type: 'add-ability',
    description: `Add ability: ${abilityText}`,
    applyModification: (values) => ({
      ...values,
      rulesText: values.rulesText + '\n' + abilityText,
    }),
  };
}

/**
 * Helper function to create a modification that changes types.
 * 
 * Rule 707.9b: Some copy effects modify characteristics as part of the copying process.
 * 
 * @param additionalTypes - Types to add (e.g., ["Enchantment"])
 * @param description - Description of the modification
 * @returns A copy modification that adds types
 */
export function addTypesModification(
  additionalTypes: readonly string[],
  description: string
): CopyModification {
  return {
    type: 'modify-types',
    description,
    applyModification: (values) => ({
      ...values,
      cardTypes: [...values.cardTypes, ...additionalTypes],
    }),
  };
}

/**
 * Helper function to create a modification that sets power/toughness.
 * 
 * Rule 707.9b: Example - Quicksilver Gargantuan enters as 7/7 copy.
 * 
 * @param power - The power to set
 * @param toughness - The toughness to set
 * @returns A copy modification that sets P/T
 */
export function setPowerToughnessModification(
  power: number | string,
  toughness: number | string
): CopyModification {
  return {
    type: 'modify-power-toughness',
    description: `Set power/toughness to ${power}/${toughness}`,
    applyModification: (values) => ({
      ...values,
      power,
      toughness,
    }),
  };
}

/**
 * Create a copy exception that retains original values.
 * 
 * Rule 707.9c: Some copy effects don't copy certain characteristics and the
 * affected objects instead retain their original values.
 * 
 * @param characteristics - The characteristics to not copy
 * @param description - Description of the exception
 * @returns A copy exception
 */
export function retainOriginalException(
  characteristics: readonly ('name' | 'mana-cost' | 'color' | 'types' | 'power-toughness' | 'loyalty' | 'abilities')[],
  description: string
): CopyException {
  return {
    type: 'retain-original',
    characteristicsAffected: characteristics,
    description,
  };
}

/**
 * Cast a copy of an object (not just copying a spell on the stack).
 * 
 * Rule 707.12: An effect that instructs a player to cast a copy of an object follows
 * the rules for casting spells, but the copy is created in the same zone and then cast.
 * 
 * @param objectId - The ID of the object to copy and cast
 * @param copiableValues - The copiable values of the object
 * @param zone - The zone the object is in
 * @param controllerId - The player casting the copy
 * @returns A spell copy ready to be cast
 */
export function createCopyToCast(
  objectId: string,
  copiableValues: CopiableValues,
  zone: string,
  controllerId: string
): SpellCopy {
  // Create the copy in the same zone, then it will be cast
  const copyId = `${objectId}-copy-${Date.now()}`;
  return {
    type: 'spell',
    copyId,
    originalSpellId: objectId,
    copiableValues,
    mode: null,
    targets: [],
    xValue: null,
    wasKicked: false,
    additionalCosts: [],
    alternativeCosts: [],
    controllerId,
    ownerId: controllerId,
  };
}
