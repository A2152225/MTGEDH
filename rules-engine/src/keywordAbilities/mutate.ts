/**
 * Mutate keyword ability (Rule 702.140)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.140. Mutate
 * 702.140a Mutate appears on some creature cards. It represents a static ability that functions 
 * while the spell with mutate is on the stack. "Mutate [cost]" means "You may pay [cost] rather 
 * than pay this spell's mana cost. If you do, it becomes a mutating creature spell and targets 
 * a non-Human creature with the same owner as this spell."
 * 702.140b As a mutating creature spell begins resolving, if its target is illegal, it ceases 
 * to be a mutating creature spell and continues resolving as a creature spell.
 * 702.140c As a mutating creature spell resolves, if its target is legal, it doesn't enter the 
 * battlefield. Rather, it merges with the target creature and becomes one object represented by 
 * more than one card or token. The spell's controller chooses whether the spell is put on top 
 * of the creature or on the bottom. The resulting permanent is a mutated permanent.
 * 702.140d An ability that triggers whenever a creature mutates triggers when a spell merges 
 * with a creature as a result of a resolving mutating creature spell.
 * 702.140e A mutated permanent has all abilities of each card and token that represents it. Its 
 * other characteristics are derived from the topmost card or token.
 * 
 * Important interactions:
 * - Illegal Target (702.140b): If target is removed, spell resolves as normal creature.
 * - Summoning Sickness: Mutated creature inherits summoning sickness state of target.
 * - Legendary Rules: Only matters if the top card is legendary.
 * - Copying: A copy of a mutated creature copies the entire stack.
 * - Command Zone: All cards in the mutation go together when sent to command zone.
 * - Leaving Battlefield: Cards separate when the mutated permanent leaves the battlefield.
 */

export interface MutateAbility {
  readonly type: 'mutate';
  readonly source: string;
  readonly mutateCost: string;
  readonly hasMutated: boolean;
  readonly targetCreature?: string;
  readonly onTop: boolean; // Whether mutating card is on top
  readonly mergedCards: readonly string[];
}

/**
 * A mutated permanent on the battlefield.
 * Represents a creature that has been merged with one or more mutating spells.
 * Rule 702.140c-e
 */
export interface MutatedPermanent {
  /** The permanent ID on the battlefield */
  readonly permanentId: string;
  /** Controller of the mutated permanent */
  readonly controller: string;
  /** Owner of all cards in the mutation stack (must be same for all cards) */
  readonly owner: string;
  /** Cards in the mutation stack, ordered from top to bottom */
  readonly cardStack: readonly MutatedCard[];
  /** Number of times this creature has been mutated */
  readonly mutationCount: number;
  /** Whether the creature had summoning sickness before the last mutation */
  readonly summoningSicknessInherited: boolean;
}

/**
 * A card within a mutated permanent's stack
 */
export interface MutatedCard {
  /** Card ID */
  readonly id: string;
  /** Card name */
  readonly name: string;
  /** Card type line */
  readonly typeLine: string;
  /** Oracle text (abilities) */
  readonly oracleText: string;
  /** Power (if creature) */
  readonly power?: string;
  /** Toughness (if creature) */
  readonly toughness?: string;
  /** Mana cost */
  readonly manaCost?: string;
  /** Whether this is the original creature (bottom of stack originally) */
  readonly isOriginal: boolean;
  /** Whether this card is a commander */
  readonly isCommander?: boolean;
}

/**
 * Result of validating a mutate target
 */
export interface MutateTargetValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Information about a valid mutate target
 */
export interface MutateTargetInfo {
  readonly permanentId: string;
  readonly cardName: string;
  readonly controller: string;
  readonly owner: string;
  readonly typeLine: string;
  readonly power?: string;
  readonly toughness?: string;
  readonly imageUrl?: string;
  readonly isAlreadyMutated: boolean;
  readonly mutationCount?: number;
}

/**
 * Create a mutate ability
 * Rule 702.140a
 * @param source - The creature card with mutate
 * @param mutateCost - Alternative cost to mutate
 * @returns Mutate ability object
 */
export function mutate(source: string, mutateCost: string): MutateAbility {
  return {
    type: 'mutate',
    source,
    mutateCost,
    hasMutated: false,
    onTop: true,
    mergedCards: [],
  };
}

/**
 * Cast spell with mutate, targeting a creature
 * Rule 702.140a - Targets non-Human creature with same owner
 * @param ability - Mutate ability
 * @param targetCreature - ID of target creature
 * @returns Updated ability
 */
export function castWithMutate(ability: MutateAbility, targetCreature: string): MutateAbility {
  return {
    ...ability,
    hasMutated: true,
    targetCreature,
  };
}

/**
 * Merge with target creature
 * Rule 702.140c - Controller chooses top or bottom
 * @param ability - Mutate ability
 * @param onTop - Whether mutating card goes on top
 * @param mergedCards - IDs of all cards in mutated permanent
 * @returns Updated ability
 */
export function completeMutate(
  ability: MutateAbility,
  onTop: boolean,
  mergedCards: readonly string[]
): MutateAbility {
  return {
    ...ability,
    onTop,
    mergedCards,
  };
}

/**
 * Check if spell was mutated
 * @param ability - Mutate ability
 * @returns True if mutated
 */
export function hasMutated(ability: MutateAbility): boolean {
  return ability.hasMutated;
}

/**
 * Check if mutating card is on top
 * Rule 702.140e - Topmost card determines characteristics
 * @param ability - Mutate ability
 * @returns True if on top
 */
export function isOnTop(ability: MutateAbility): boolean {
  return ability.onTop;
}

/**
 * Get merged cards
 * Rule 702.140e - Has all abilities of merged cards
 * @param ability - Mutate ability
 * @returns IDs of merged cards
 */
export function getMergedCards(ability: MutateAbility): readonly string[] {
  return ability.mergedCards;
}

/**
 * Multiple instances of mutate are not redundant
 * @param abilities - Array of mutate abilities
 * @returns False
 */
export function hasRedundantMutate(abilities: readonly MutateAbility[]): boolean {
  return false;
}

/**
 * Check if a permanent is a valid mutate target
 * Rule 702.140a: Must be non-Human creature with same owner as the spell
 * 
 * @param permanent - The potential target permanent
 * @param spellOwner - Owner of the mutate spell
 * @returns Validation result
 */
export function isValidMutateTarget(
  permanent: {
    owner: string;
    card?: {
      type_line?: string;
    };
    typeLine?: string;
  },
  spellOwner: string
): MutateTargetValidation {
  const typeLine = (permanent.card?.type_line || permanent.typeLine || '').toLowerCase();
  
  // Must be a creature
  if (!typeLine.includes('creature')) {
    return { valid: false, reason: 'Target must be a creature' };
  }
  
  // Must not be Human
  if (typeLine.includes('human')) {
    return { valid: false, reason: 'Cannot mutate onto a Human creature' };
  }
  
  // Must have same owner as the spell
  if (permanent.owner !== spellOwner) {
    return { valid: false, reason: 'Target creature must have the same owner as the spell' };
  }
  
  return { valid: true };
}

/**
 * Get all valid mutate targets on the battlefield
 * 
 * @param battlefield - Array of permanents on the battlefield
 * @param spellOwner - Owner of the mutate spell
 * @param mutatedPermanents - Map of mutated permanents (permanentId -> MutatedPermanent)
 * @returns Array of valid mutate target info
 */
export function getValidMutateTargets(
  battlefield: readonly any[],
  spellOwner: string,
  mutatedPermanents?: Map<string, MutatedPermanent>
): MutateTargetInfo[] {
  const targets: MutateTargetInfo[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const validation = isValidMutateTarget(perm, spellOwner);
    if (!validation.valid) continue;
    
    const mutated = mutatedPermanents?.get(perm.id);
    
    targets.push({
      permanentId: perm.id,
      cardName: perm.card.name || 'Unknown Creature',
      controller: perm.controller,
      owner: perm.owner,
      typeLine: perm.card.type_line || '',
      power: perm.card.power,
      toughness: perm.card.toughness,
      imageUrl: perm.card.image_uris?.small || perm.card.image_uris?.normal,
      isAlreadyMutated: !!mutated,
      mutationCount: mutated?.mutationCount,
    });
  }
  
  return targets;
}

/**
 * Create a new mutated permanent by merging a spell with a target creature
 * Rule 702.140c
 * 
 * @param targetPermanent - The target creature permanent
 * @param mutatingCard - The card being mutated onto the target
 * @param onTop - Whether the mutating card goes on top
 * @param existingMutation - Existing mutation data if target is already mutated
 * @returns New MutatedPermanent state
 */
export function createMutatedPermanent(
  targetPermanent: any,
  mutatingCard: any,
  onTop: boolean,
  existingMutation?: MutatedPermanent
): MutatedPermanent {
  const targetCard = targetPermanent.card;
  
  // Create MutatedCard for the mutating spell
  const newMutatedCard: MutatedCard = {
    id: mutatingCard.id,
    name: mutatingCard.name || 'Unknown',
    typeLine: mutatingCard.type_line || '',
    oracleText: mutatingCard.oracle_text || '',
    power: mutatingCard.power,
    toughness: mutatingCard.toughness,
    manaCost: mutatingCard.mana_cost,
    isOriginal: false,
    isCommander: mutatingCard.isCommander,
  };
  
  let cardStack: MutatedCard[];
  
  if (existingMutation) {
    // Already mutated - add to existing stack
    if (onTop) {
      cardStack = [newMutatedCard, ...existingMutation.cardStack];
    } else {
      cardStack = [...existingMutation.cardStack, newMutatedCard];
    }
  } else {
    // First mutation - create stack with target creature and new card
    const originalCard: MutatedCard = {
      id: targetCard.id,
      name: targetCard.name || 'Unknown',
      typeLine: targetCard.type_line || '',
      oracleText: targetCard.oracle_text || '',
      power: targetCard.power,
      toughness: targetCard.toughness,
      manaCost: targetCard.mana_cost,
      isOriginal: true,
      isCommander: targetPermanent.isCommander,
    };
    
    if (onTop) {
      cardStack = [newMutatedCard, originalCard];
    } else {
      cardStack = [originalCard, newMutatedCard];
    }
  }
  
  return {
    permanentId: targetPermanent.id,
    controller: targetPermanent.controller,
    owner: targetPermanent.owner,
    cardStack,
    mutationCount: (existingMutation?.mutationCount || 0) + 1,
    summoningSicknessInherited: !targetPermanent.summoningSickness,
  };
}

/**
 * Get the characteristics of a mutated permanent (from top card)
 * Rule 702.140e: Characteristics are derived from topmost card
 * 
 * @param mutated - The mutated permanent
 * @returns Top card characteristics
 */
export function getMutatedPermanentCharacteristics(mutated: MutatedPermanent): {
  name: string;
  typeLine: string;
  power?: string;
  toughness?: string;
  manaCost?: string;
} {
  const topCard = mutated.cardStack[0];
  return {
    name: topCard.name,
    typeLine: topCard.typeLine,
    power: topCard.power,
    toughness: topCard.toughness,
    manaCost: topCard.manaCost,
  };
}

/**
 * Get all abilities of a mutated permanent (from all cards)
 * Rule 702.140e: Has all abilities of each card
 * 
 * @param mutated - The mutated permanent
 * @returns Combined oracle text from all cards
 */
export function getMutatedPermanentAbilities(mutated: MutatedPermanent): string[] {
  const abilities: string[] = [];
  
  for (const card of mutated.cardStack) {
    if (card.oracleText) {
      // Split oracle text by line breaks to get individual abilities
      const cardAbilities = card.oracleText.split('\n').filter(a => a.trim());
      abilities.push(...cardAbilities);
    }
  }
  
  return abilities;
}

/**
 * Check if a mutated permanent contains a commander
 * Important for commander zone interactions
 * 
 * @param mutated - The mutated permanent
 * @returns True if any card in the stack is a commander
 */
export function mutatedPermanentContainsCommander(mutated: MutatedPermanent): boolean {
  return mutated.cardStack.some(card => card.isCommander);
}

/**
 * Get the commander card(s) from a mutated permanent
 * 
 * @param mutated - The mutated permanent
 * @returns Array of commander cards in the mutation
 */
export function getCommandersFromMutation(mutated: MutatedPermanent): MutatedCard[] {
  return mutated.cardStack.filter(card => card.isCommander);
}

/**
 * Separate cards when a mutated permanent leaves the battlefield
 * Rule 702.140e: Cards split apart when leaving battlefield
 * 
 * @param mutated - The mutated permanent
 * @param destinationZone - Where the permanent is going
 * @returns Array of individual cards to move to the zone
 */
export function separateMutatedPermanent(
  mutated: MutatedPermanent,
  destinationZone: 'hand' | 'graveyard' | 'exile' | 'library' | 'command'
): Array<{ cardId: string; zone: string; isCommander: boolean }> {
  const result: Array<{ cardId: string; zone: string; isCommander: boolean }> = [];
  
  for (const card of mutated.cardStack) {
    result.push({
      cardId: card.id,
      zone: destinationZone,
      isCommander: card.isCommander || false,
    });
  }
  
  return result;
}

/**
 * Check if the top card of a mutated permanent is legendary
 * Important for legendary rule (only checks top card)
 * 
 * @param mutated - The mutated permanent
 * @returns True if top card is legendary
 */
export function isMutatedPermanentLegendary(mutated: MutatedPermanent): boolean {
  const topCard = mutated.cardStack[0];
  return topCard.typeLine.toLowerCase().includes('legendary');
}

/**
 * Parse mutate cost from oracle text
 * 
 * @param oracleText - Oracle text to parse
 * @returns Mutate cost if found, undefined otherwise
 */
export function parseMutateCost(oracleText: string): string | undefined {
  if (!oracleText) return undefined;
  
  // Match patterns like "Mutate {2}{G}{G}" or "Mutate {1}{U/B}{U/B}"
  const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (mutateMatch) {
    return mutateMatch[1].trim();
  }
  
  return undefined;
}

/**
 * Check if a card has mutate ability
 * 
 * @param oracleText - Oracle text to check
 * @returns True if card has mutate
 */
export function hasMutateAbility(oracleText: string): boolean {
  if (!oracleText) return false;
  return /\bmutate\b/i.test(oracleText);
}

/**
 * Create a copy of a mutated permanent
 * Rule: A copy of a mutated creature copies the entire stack at that moment
 * 
 * @param mutated - The mutated permanent to copy
 * @param newPermanentId - ID for the copy
 * @param newController - Controller of the copy
 * @returns New mutated permanent that is a copy
 */
export function copyMutatedPermanent(
  mutated: MutatedPermanent,
  newPermanentId: string,
  newController: string
): MutatedPermanent {
  return {
    ...mutated,
    permanentId: newPermanentId,
    controller: newController,
    // Copy the card stack but mark none as original since it's a copy
    cardStack: mutated.cardStack.map(card => ({
      ...card,
      isOriginal: false,
      // Copies are not commanders
      isCommander: false,
    })),
  };
}
