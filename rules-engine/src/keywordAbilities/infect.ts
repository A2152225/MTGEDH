/**
 * Infect keyword ability (Rule 702.90)
 * @module keywordAbilities/infect
 */

/**
 * Infect ability (Rule 702.90)
 * Static ability that deals damage as poison/counters
 */
export interface InfectAbility {
  readonly type: 'infect';
  readonly source: string;
}

/**
 * Create an infect ability
 * Rule 702.90a: Infect is a static ability.
 * Rule 702.90b: Damage to players gives poison counters instead of life loss.
 * Rule 702.90c: Damage to creatures puts -1/-1 counters instead of marking damage.
 */
export function infect(source: string): InfectAbility {
  return {
    type: 'infect',
    source
  };
}

/**
 * Convert damage to poison counters for players
 */
export function infectDamageToPlayer(ability: InfectAbility, damage: number): number {
  return damage;
}

/**
 * Convert damage to -1/-1 counters for creatures
 */
export function infectDamageToCreature(ability: InfectAbility, damage: number): number {
  return damage;
}

/**
 * Check if two infect abilities are redundant
 * Rule 702.90f: Multiple instances are redundant
 */
export function areInfectAbilitiesRedundant(a: InfectAbility, b: InfectAbility): boolean {
  return true;
}
