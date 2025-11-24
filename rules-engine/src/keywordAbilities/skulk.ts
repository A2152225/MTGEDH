/**
 * Skulk keyword ability (Rule 702.118)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.118. Skulk
 * 702.118a Skulk is an evasion ability.
 * 702.118b A creature with skulk can't be blocked by creatures with greater power. (See rule 
 * 509, "Declare Blockers Step.")
 * 702.118c Multiple instances of skulk on the same creature are redundant.
 */

export interface SkulkAbility {
  readonly type: 'skulk';
  readonly source: string;
}

/**
 * Create a skulk ability
 * Rule 702.118
 * @param source - The creature with skulk
 * @returns Skulk ability object
 */
export function skulk(source: string): SkulkAbility {
  return {
    type: 'skulk',
    source,
  };
}

/**
 * Check if a creature can block a creature with skulk
 * Rule 702.118b - Can't be blocked by creatures with greater power
 * @param attackerPower - Power of creature with skulk
 * @param blockerPower - Power of potential blocker
 * @returns True if blocker can block skulk creature
 */
export function canBlockSkulk(attackerPower: number, blockerPower: number): boolean {
  return blockerPower <= attackerPower;
}

/**
 * Check if skulk creature can be blocked
 * Rule 702.118b
 * @param ability - Skulk ability
 * @param attackerPower - Power of skulk creature
 * @param blockerPower - Power of potential blocker
 * @returns True if can be blocked
 */
export function canBlockWithSkulk(
  ability: SkulkAbility,
  attackerPower: number,
  blockerPower: number
): boolean {
  return canBlockSkulk(attackerPower, blockerPower);
}

/**
 * Multiple instances of skulk are redundant
 * Rule 702.118c
 * @param abilities - Array of skulk abilities
 * @returns True if more than one instance
 */
export function hasRedundantSkulk(abilities: readonly SkulkAbility[]): boolean {
  return abilities.length > 1;
}
