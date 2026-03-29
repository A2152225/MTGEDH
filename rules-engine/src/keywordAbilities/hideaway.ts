/**
 * Hideaway keyword ability (Rule 702.75)
 * @module keywordAbilities/hideaway
 */

/**
 * Hideaway ability (Rule 702.75)
 * Triggered ability that exiles a card face down when permanent enters
 */
export interface HideawayAbility {
  readonly type: 'hideaway';
  readonly source: string;
  readonly count: number;
  readonly exiledCard?: string;
}

/**
 * Create a hideaway ability
 * Rule 702.75a: "Hideaway N" means "When this permanent enters, look at the top
 * N cards of your library. Exile one of them face down and put the rest on the
 * bottom of your library in a random order."
 */
export function hideaway(source: string, count: number = 4): HideawayAbility {
  return {
    type: 'hideaway',
    source,
    count
  };
}

/**
 * Complete hideaway by exiling a card
 */
export function completeHideaway(ability: HideawayAbility, exiledCard: string): HideawayAbility {
  return {
    ...ability,
    exiledCard
  };
}

/**
 * Get the exiled card
 */
export function getHideawayCard(ability: HideawayAbility): string | undefined {
  return ability.exiledCard;
}

/**
 * Gets the number of cards hideaway will look at from the library.
 *
 * @param ability - The hideaway ability
 * @param librarySize - The current library size
 * @returns The actual number of cards looked at
 */
export function getHideawayLookCount(ability: HideawayAbility, librarySize: number): number {
  return Math.min(ability.count, librarySize);
}

/**
 * Check if hideaway ability has triggered
 */
export function hasHideawayTriggered(ability: HideawayAbility): boolean {
  return ability.exiledCard !== undefined;
}

/**
 * Creates the resolution summary for hideaway.
 *
 * @param ability - The hideaway ability after resolution
 * @param lookedAtCards - The cards looked at from the top of the library
 * @returns Summary of the hidden card and cards sent to the bottom, or null if unresolved
 */
export function createHideawayResolutionResult(
  ability: HideawayAbility,
  lookedAtCards: readonly string[]
): {
  source: string;
  lookedAtCount: number;
  exiledCard: string;
  bottomedCards: readonly string[];
} | null {
  if (!ability.exiledCard) {
    return null;
  }

  return {
    source: ability.source,
    lookedAtCount: getHideawayLookCount(ability, lookedAtCards.length),
    exiledCard: ability.exiledCard,
    bottomedCards: lookedAtCards.filter(card => card !== ability.exiledCard),
  };
}

/**
 * Check if two hideaway abilities are redundant
 * Multiple instances trigger separately
 */
export function areHideawayAbilitiesRedundant(a: HideawayAbility, b: HideawayAbility): boolean {
  // Multiple instances are not redundant; each triggers separately
  return false;
}
