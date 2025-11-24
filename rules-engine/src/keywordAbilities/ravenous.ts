/**
 * Ravenous keyword ability (Rule 702.156)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.156. Ravenous
 * 702.156a Ravenous is a keyword found on some creature cards with {X} in their mana cost. 
 * Ravenous represents both a replacement effect and a triggered ability. "Ravenous" means "This 
 * permanent enters with X +1/+1 counters on it" and "When this permanent enters, if X is 5 or 
 * more, draw a card."
 */

export interface RavenousAbility {
  readonly type: 'ravenous';
  readonly source: string;
  readonly xValue: number;
  readonly countersAdded: number;
  readonly hasDrawnCard: boolean;
}

/**
 * Create a ravenous ability
 * Rule 702.156a
 * @param source - The creature with ravenous
 * @param xValue - Value of X paid
 * @returns Ravenous ability object
 */
export function ravenous(source: string, xValue: number): RavenousAbility {
  return {
    type: 'ravenous',
    source,
    xValue,
    countersAdded: xValue,
    hasDrawnCard: false,
  };
}

/**
 * Check if should draw card
 * Rule 702.156a - Draw if X is 5 or more
 * @param ability - Ravenous ability
 * @returns True if should draw
 */
export function shouldDrawFromRavenous(ability: RavenousAbility): boolean {
  return ability.xValue >= 5;
}

/**
 * Draw card from ravenous trigger
 * Rule 702.156a
 * @param ability - Ravenous ability
 * @returns Updated ability
 */
export function drawFromRavenous(ability: RavenousAbility): RavenousAbility {
  return {
    ...ability,
    hasDrawnCard: true,
  };
}

/**
 * Get counters added by ravenous
 * Rule 702.156a
 * @param ability - Ravenous ability
 * @returns Number of counters
 */
export function getRavenousCounters(ability: RavenousAbility): number {
  return ability.countersAdded;
}

/**
 * Multiple instances of ravenous are not redundant
 * @param abilities - Array of ravenous abilities
 * @returns False
 */
export function hasRedundantRavenous(abilities: readonly RavenousAbility[]): boolean {
  return false;
}
