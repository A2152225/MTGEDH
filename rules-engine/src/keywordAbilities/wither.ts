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
  return Math.max(0, damage);
}

/**
 * Gets the number of -1/-1 counters wither creates on a creature.
 * Damage dealt to noncreatures is not converted into counters.
 *
 * @param ability - The wither ability
 * @param damage - The damage that would be dealt
 * @param targetIsCreature - Whether the damaged object is a creature
 * @returns The number of -1/-1 counters created
 */
export function getWitherCounters(
  ability: WitherAbility,
  damage: number,
  targetIsCreature: boolean
): number {
  return targetIsCreature ? witherDamage(ability, damage) : 0;
}

/**
 * Creates the result of damage from a source with wither.
 *
 * @param ability - The wither ability
 * @param damage - The damage that would be dealt
 * @param targetIsCreature - Whether the damaged object is a creature
 * @returns Summary of counters placed versus normal damage marking
 */
export function createWitherDamageResult(
  ability: WitherAbility,
  damage: number,
  targetIsCreature: boolean
): {
  source: string;
  countersPlaced: number;
  damageMarked: number;
} {
  const normalizedDamage = witherDamage(ability, damage);
  return {
    source: ability.source,
    countersPlaced: targetIsCreature ? normalizedDamage : 0,
    damageMarked: targetIsCreature ? 0 : normalizedDamage,
  };
}

/**
 * Check if two wither abilities are redundant
 * Rule 702.80d: Multiple instances are redundant
 */
export function areWitherAbilitiesRedundant(a: WitherAbility, b: WitherAbility): boolean {
  return true;
}
