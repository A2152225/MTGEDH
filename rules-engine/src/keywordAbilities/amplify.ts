/**
 * Amplify keyword ability implementation (Rule 702.38)
 * 
 * @see MagicCompRules 702.38
 */

/**
 * Amplify ability interface
 * Rule 702.38a: "Amplify N" means "As this object enters, reveal any number of cards from your hand
 * that share a creature type with it. This permanent enters with N +1/+1 counters on it for each card revealed this way."
 */
export interface AmplifyAbility {
  readonly type: 'amplify';
  readonly value: number;
  readonly source: string;
  readonly revealedCards: readonly string[];
  readonly sharedTypes: readonly string[];
}

/**
 * Creates an Amplify ability
 * 
 * @param source - The source permanent ID
 * @param value - The amplify value (N in "Amplify N")
 * @returns AmplifyAbility object
 */
export function amplify(source: string, value: number): AmplifyAbility {
  return {
    type: 'amplify',
    value,
    source,
    revealedCards: [],
    sharedTypes: [],
  };
}

/**
 * Resolves amplify by revealing cards from hand
 * 
 * @param ability - The amplify ability
 * @param revealedCards - Card IDs revealed from hand
 * @param sharedTypes - Creature types shared with the entering permanent
 * @returns Updated AmplifyAbility
 */
export function resolveAmplify(
  ability: AmplifyAbility,
  revealedCards: readonly string[],
  sharedTypes: readonly string[]
): AmplifyAbility {
  return {
    ...ability,
    revealedCards,
    sharedTypes,
  };
}

/**
 * Calculates the number of counters to add from amplify
 * 
 * @param ability - The amplify ability
 * @returns Number of +1/+1 counters to add
 */
export function getAmplifyCounters(ability: AmplifyAbility): number {
  return ability.revealedCards.length * ability.value;
}

/**
 * Checks if a card can be revealed for amplify
 * Rule 702.38a: Cards must share a creature type with the entering permanent
 * 
 * @param cardTypes - Creature types on the card to reveal
 * @param permanentTypes - Creature types on the entering permanent
 * @returns True if the card shares at least one creature type
 */
export function canRevealForAmplify(
  cardTypes: readonly string[],
  permanentTypes: readonly string[]
): boolean {
  return cardTypes.some(type => permanentTypes.includes(type));
}

/**
 * Checks if amplify abilities are redundant
 * Rule 702.38b: If a creature has multiple instances of amplify, each one works separately
 * 
 * @returns False - amplify instances are never redundant
 */
export function isAmplifyRedundant(): boolean {
  return false; // Rule 702.38b: Each instance works separately
}
