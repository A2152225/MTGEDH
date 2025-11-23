/**
 * Devour keyword ability (Rule 702.82)
 * @module keywordAbilities/devour
 */

/**
 * Devour ability (Rule 702.82)
 * Static ability that sacrifices creatures for +1/+1 counters
 */
export interface DevourAbility {
  readonly type: 'devour';
  readonly source: string;
  readonly count: number;
  readonly quality?: string; // For "Devour [quality] N" variant
  readonly devoured: number;
}

/**
 * Create a devour ability
 * Rule 702.82a: "Devour N" means "As this object enters, you may sacrifice any
 * number of creatures. This permanent enters with N +1/+1 counters on it for each
 * creature sacrificed this way."
 */
export function devour(source: string, count: number, quality?: string): DevourAbility {
  return {
    type: 'devour',
    source,
    count,
    quality,
    devoured: 0
  };
}

/**
 * Sacrifice creatures for devour
 */
export function sacrificeForDevour(ability: DevourAbility, creatureCount: number): DevourAbility {
  return {
    ...ability,
    devoured: creatureCount
  };
}

/**
 * Calculate counters from devour
 */
export function getDevourCounters(ability: DevourAbility): number {
  return ability.devoured * ability.count;
}

/**
 * Get number of creatures devoured
 */
export function getCreaturesDevoured(ability: DevourAbility): number {
  return ability.devoured;
}

/**
 * Check if two devour abilities are redundant
 * Multiple instances are not redundant
 */
export function areDevourAbilitiesRedundant(a: DevourAbility, b: DevourAbility): boolean {
  return a.count === b.count && a.quality === b.quality;
}
