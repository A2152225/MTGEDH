/**
 * Annihilator keyword ability (Rule 702.86)
 * @module keywordAbilities/annihilator
 */

/**
 * Annihilator ability (Rule 702.86)
 * Triggered ability that forces defending player to sacrifice permanents
 */
export interface AnnihilatorAbility {
  readonly type: 'annihilator';
  readonly source: string;
  readonly count: number;
}

export interface AnnihilatorTrigger {
  readonly source: string;
  readonly defendingPlayerId: string;
  readonly permanentsToSacrifice: number;
}

export interface AnnihilatorSummary {
  readonly source: string;
  readonly annihilatorCount: number;
  readonly triggers: boolean;
  readonly defendingPlayerId?: string;
}

/**
 * Create an annihilator ability
 * Rule 702.86a: "Annihilator N" means "Whenever this creature attacks,
 * defending player sacrifices N permanents."
 */
export function annihilator(source: string, count: number): AnnihilatorAbility {
  return {
    type: 'annihilator',
    source,
    count
  };
}

/**
 * Get number of permanents to sacrifice
 */
export function getAnnihilatorCount(ability: AnnihilatorAbility): number {
  return ability.count;
}

export function shouldTriggerAnnihilator(
  isAttacking: boolean,
  defendingPlayerId: string | undefined
): boolean {
  return isAttacking && typeof defendingPlayerId === 'string' && defendingPlayerId.length > 0;
}

export function createAnnihilatorTrigger(
  ability: AnnihilatorAbility,
  defendingPlayerId: string
): AnnihilatorTrigger {
  return {
    source: ability.source,
    defendingPlayerId,
    permanentsToSacrifice: ability.count,
  };
}

export function getCombinedAnnihilatorCount(
  abilities: readonly AnnihilatorAbility[]
): number {
  return abilities.reduce((total, ability) => total + ability.count, 0);
}

/**
 * Check if two annihilator abilities are redundant
 * Rule 702.86b: Multiple instances trigger separately
 */
export function areAnnihilatorAbilitiesRedundant(a: AnnihilatorAbility, b: AnnihilatorAbility): boolean {
  return false;
}

export function createAnnihilatorSummary(
  ability: AnnihilatorAbility,
  isAttacking: boolean,
  defendingPlayerId?: string,
): AnnihilatorSummary {
  return {
    source: ability.source,
    annihilatorCount: ability.count,
    triggers: shouldTriggerAnnihilator(isAttacking, defendingPlayerId),
    defendingPlayerId,
  };
}
