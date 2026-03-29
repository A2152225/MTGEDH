/**
 * Absorb keyword ability (Rule 702.64)
 * 
 * @module keywordAbilities/absorb
 */

/**
 * Represents an absorb ability on a permanent.
 * Rule 702.64: Absorb is a static ability. "Absorb N" means "If a source would deal 
 * damage to this creature, prevent N of that damage."
 */
export interface AbsorbAbility {
  readonly type: 'absorb';
  readonly count: number;
  readonly source: string;
}

export interface AbsorbResult {
  readonly originalDamage: number;
  readonly preventedDamage: number;
  readonly remainingDamage: number;
}

/**
 * Creates an absorb ability.
 * 
 * @param source - The source permanent with absorb
 * @param count - Amount of damage to absorb
 * @returns An absorb ability
 * 
 * @example
 * ```typescript
 * const ability = absorb('Vigean Hydropon', 3);
 * ```
 */
export function absorb(source: string, count: number): AbsorbAbility {
  return {
    type: 'absorb',
    count,
    source
  };
}

/**
 * Calculates damage after absorption.
 * 
 * @param ability - The absorb ability
 * @param damage - Original damage amount
 * @returns Damage after absorption
 */
export function applyAbsorb(ability: AbsorbAbility, damage: number): number {
  return Math.max(0, damage - ability.count);
}

export function getAbsorbPrevention(ability: AbsorbAbility, damage: number): number {
  return Math.min(Math.max(0, damage), ability.count);
}

export function resolveAbsorb(ability: AbsorbAbility, damage: number): AbsorbResult {
  const preventedDamage = getAbsorbPrevention(ability, damage);

  return {
    originalDamage: Math.max(0, damage),
    preventedDamage,
    remainingDamage: applyAbsorb(ability, damage),
  };
}
