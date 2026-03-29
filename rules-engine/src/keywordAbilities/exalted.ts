/**
 * Exalted keyword ability (Rule 702.83)
 * @module keywordAbilities/exalted
 */

/**
 * Exalted ability (Rule 702.83)
 * Triggered ability that gives bonus to creatures attacking alone
 */
export interface ExaltedAbility {
  readonly type: 'exalted';
  readonly source: string;
}

/**
 * Create an exalted ability
 * Rule 702.83a: "Exalted" means "Whenever a creature you control attacks alone,
 * that creature gets +1/+1 until end of turn."
 */
export function exalted(source: string): ExaltedAbility {
  return {
    type: 'exalted',
    source
  };
}

/**
 * Check if creature is attacking alone
 * Rule 702.83b: A creature "attacks alone" if it's the only creature declared
 * as an attacker in a given combat phase.
 */
export function isAttackingAlone(attackers: readonly string[]): boolean {
  return attackers.length === 1;
}

/**
 * Get exalted bonus
 * Each exalted trigger gives +1/+1
 */
export function getExaltedBonus(): { power: number; toughness: number } {
  return { power: 1, toughness: 1 };
}

/**
 * Checks whether exalted should trigger for the given attack declaration.
 *
 * @param ability - The exalted ability
 * @param attackers - The creatures declared as attackers
 * @param attackerId - The creature receiving the exalted bonus
 * @returns True if the named creature attacked alone
 */
export function shouldTriggerExalted(
  ability: ExaltedAbility,
  attackers: readonly string[],
  attackerId: string
): boolean {
  return isAttackingAlone(attackers) && attackers[0] === attackerId;
}

/**
 * Gets the total bonus from one or more exalted triggers.
 *
 * @param triggerCount - The number of exalted triggers that resolved
 * @returns The combined power and toughness bonus
 */
export function getTotalExaltedBonus(triggerCount: number): { power: number; toughness: number } {
  const normalizedTriggerCount = Math.max(0, triggerCount);
  return {
    power: normalizedTriggerCount,
    toughness: normalizedTriggerCount,
  };
}

/**
 * Creates the result of exalted bonuses applying to an attacking creature.
 *
 * @param ability - The exalted ability
 * @param attackers - The creatures declared as attackers
 * @param attackerId - The creature receiving the exalted bonus
 * @param triggerCount - The number of exalted triggers that resolved
 * @returns Bonus summary, or null if exalted does not trigger
 */
export function createExaltedAttackResult(
  ability: ExaltedAbility,
  attackers: readonly string[],
  attackerId: string,
  triggerCount = 1
): {
  source: string;
  attacker: string;
  powerBonus: number;
  toughnessBonus: number;
} | null {
  if (!shouldTriggerExalted(ability, attackers, attackerId)) {
    return null;
  }

  const bonus = getTotalExaltedBonus(triggerCount);
  return {
    source: ability.source,
    attacker: attackerId,
    powerBonus: bonus.power,
    toughnessBonus: bonus.toughness,
  };
}

/**
 * Check if two exalted abilities are redundant
 * Rule 702.83: Multiple instances trigger separately
 */
export function areExaltedAbilitiesRedundant(a: ExaltedAbility, b: ExaltedAbility): boolean {
  return false;
}
