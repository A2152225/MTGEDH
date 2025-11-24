/**
 * Wither keyword ability (Rule 702.80)
 * @module keywordAbilities/wither
 */

/**
 * Wither ability (Rule 702.80)
 * Static ability that causes damage to creatures as -1/-1 counters
 */
export interface WitherAbility {
  readonly type: 'wither';
  readonly source: string;
}

/**
 * Create a wither ability
 * Rule 702.80a: Wither is a static ability. Damage dealt to a creature by a
 * source with wither isn't marked on that creature. Rather, it causes that
 * source's controller to put that many -1/-1 counters on that creature.
 */
export function wither(source: string): WitherAbility {
  return {
    type: 'wither',
    source
  };
}

/**
 * Convert damage to -1/-1 counters for wither
 */
export function witherDamage(ability: WitherAbility, damage: number): number {
  return damage;
}

/**
 * Check if two wither abilities are redundant
 * Rule 702.80d: Multiple instances are redundant
 */
export function areWitherAbilitiesRedundant(a: WitherAbility, b: WitherAbility): boolean {
  return true;
}
