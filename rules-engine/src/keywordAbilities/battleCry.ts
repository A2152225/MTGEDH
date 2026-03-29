/**
 * Battle Cry keyword ability (Rule 702.91)
 * @module keywordAbilities/battleCry
 */

/**
 * Battle Cry ability (Rule 702.91)
 * Triggered ability that boosts other attacking creatures
 */
export interface BattleCryAbility {
  readonly type: 'battleCry';
  readonly source: string;
}

export interface BattleCryBonus {
  readonly power: number;
  readonly toughness: number;
}

/**
 * Create a battle cry ability
 * Rule 702.91a: "Battle cry" means "Whenever this creature attacks, each other
 * attacking creature gets +1/+0 until end of turn."
 */
export function battleCry(source: string): BattleCryAbility {
  return {
    type: 'battleCry',
    source
  };
}

/**
 * Get battle cry bonus
 */
export function getBattleCryBonus(): { power: number; toughness: number } {
  return { power: 1, toughness: 0 };
}

export function shouldTriggerBattleCry(isAttacking: boolean): boolean {
  return isAttacking;
}

export function getBattleCryAffectedAttackers(
  sourceId: string,
  attackingCreatureIds: readonly string[]
): string[] {
  return attackingCreatureIds.filter(creatureId => creatureId !== sourceId);
}

export function createBattleCryBonuses(
  sourceId: string,
  attackingCreatureIds: readonly string[]
): ReadonlyMap<string, BattleCryBonus> {
  const bonuses = new Map<string, BattleCryBonus>();

  for (const creatureId of getBattleCryAffectedAttackers(sourceId, attackingCreatureIds)) {
    bonuses.set(creatureId, getBattleCryBonus());
  }

  return bonuses;
}

/**
 * Check if two battle cry abilities are redundant
 * Rule 702.91b: Multiple instances trigger separately
 */
export function areBattleCryAbilitiesRedundant(a: BattleCryAbility, b: BattleCryAbility): boolean {
  return false;
}
