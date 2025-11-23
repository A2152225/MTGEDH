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
 * Check if hideaway ability has triggered
 */
export function hasHideawayTriggered(ability: HideawayAbility): boolean {
  return ability.exiledCard !== undefined;
}

/**
 * Check if two hideaway abilities are redundant
 * Multiple instances trigger separately
 */
export function areHideawayAbilitiesRedundant(a: HideawayAbility, b: HideawayAbility): boolean {
  // Multiple instances are not redundant; each triggers separately
  return false;
}
