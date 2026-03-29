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
 * Checks whether level up can be activated under normal timing restrictions.
 * Level up may be activated only as a sorcery from the battlefield.
 *
 * @param ability - The level up ability
 * @param zone - The permanent's current zone
 * @param isSorcerySpeed - Whether the player currently has sorcery-speed timing
 * @returns True if level up can be activated now
 */
export function canActivateLevelUpAbility(
  ability: LevelUpAbility,
  zone: string,
  isSorcerySpeed: boolean
): boolean {
  return zone === 'battlefield' && isSorcerySpeed;
}

/**
 * Creates the result of activating level up once.
 *
 * @param ability - The level up ability
 * @param zone - The permanent's current zone
 * @param isSorcerySpeed - Whether the player currently has sorcery-speed timing
 * @returns Activation summary, or null if level up cannot be activated now
 */
export function createLevelUpActivationResult(
  ability: LevelUpAbility,
  zone: string,
  isSorcerySpeed: boolean
): {
  source: string;
  costPaid: string;
  newLevelCounters: number;
} | null {
  if (!canActivateLevelUpAbility(ability, zone, isSorcerySpeed)) {
    return null;
  }

  const updatedAbility = activateLevelUp(ability);
  return {
    source: ability.source,
    costPaid: ability.cost,
    newLevelCounters: updatedAbility.levelCounters,
  };
}

/**
 * Check if two level up abilities are redundant
 * Multiple instances are redundant
 */
export function areLevelUpAbilitiesRedundant(a: LevelUpAbility, b: LevelUpAbility): boolean {
  return a.cost === b.cost;
}
