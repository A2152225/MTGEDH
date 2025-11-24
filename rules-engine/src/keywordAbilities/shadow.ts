/**
 * Shadow keyword ability implementation
 * Rule 702.28
 * 
 * Shadow is an evasion ability.
 */

/**
 * Shadow ability
 * Rule 702.28a
 * 
 * Creatures with shadow can block or be blocked by only creatures with shadow.
 */
export interface ShadowAbility {
  readonly type: 'shadow';
  readonly source: string;
}

/**
 * Creates a shadow ability
 * Rule 702.28a
 * 
 * @param source - The creature with shadow
 * @returns Shadow ability
 */
export function shadow(source: string): ShadowAbility {
  return {
    type: 'shadow',
    source,
  };
}

/**
 * Checks if a creature with shadow can block another creature
 * Rule 702.28a
 * 
 * @param blockerHasShadow - Whether the blocking creature has shadow
 * @param attackerHasShadow - Whether the attacking creature has shadow
 * @returns True if the block is legal
 */
export function canBlockWithShadow(blockerHasShadow: boolean, attackerHasShadow: boolean): boolean {
  if (!blockerHasShadow) return !attackerHasShadow;
  return attackerHasShadow;
}

/**
 * Checks if a creature can be blocked by a creature with shadow
 * Rule 702.28a
 * 
 * @param attackerHasShadow - Whether the attacker has shadow
 * @param blockerHasShadow - Whether the potential blocker has shadow
 * @returns True if blocking is legal
 */
export function canBeBlockedByShadow(attackerHasShadow: boolean, blockerHasShadow: boolean): boolean {
  if (!attackerHasShadow) return !blockerHasShadow;
  return blockerHasShadow;
}

/**
 * Checks if multiple shadow abilities are redundant
 * Rule 702.28b - Multiple instances of shadow are redundant
 * 
 * @param abilities - Array of shadow abilities
 * @returns True if more than one shadow
 */
export function hasRedundantShadow(abilities: readonly ShadowAbility[]): boolean {
  return abilities.length > 1;
}
