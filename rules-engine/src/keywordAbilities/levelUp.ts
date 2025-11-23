/**
 * Level Up keyword ability (Rule 702.87)
 * @module keywordAbilities/levelUp
 */

/**
 * Level Up ability (Rule 702.87)
 * Activated ability for leveler cards
 */
export interface LevelUpAbility {
  readonly type: 'levelUp';
  readonly source: string;
  readonly cost: string;
  readonly levelCounters: number;
}

/**
 * Create a level up ability
 * Rule 702.87a: "Level up [cost]" means "[Cost]: Put a level counter on this
 * permanent. Activate only as a sorcery."
 */
export function levelUp(source: string, cost: string): LevelUpAbility {
  return {
    type: 'levelUp',
    source,
    cost,
    levelCounters: 0
  };
}

/**
 * Activate level up ability
 */
export function activateLevelUp(ability: LevelUpAbility): LevelUpAbility {
  return {
    ...ability,
    levelCounters: ability.levelCounters + 1
  };
}

/**
 * Get current level counters
 */
export function getLevelCounters(ability: LevelUpAbility): number {
  return ability.levelCounters;
}

/**
 * Check if two level up abilities are redundant
 * Multiple instances are redundant
 */
export function areLevelUpAbilitiesRedundant(a: LevelUpAbility, b: LevelUpAbility): boolean {
  return a.cost === b.cost;
}
