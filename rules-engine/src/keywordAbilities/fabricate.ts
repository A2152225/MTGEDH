/**
 * Fabricate keyword ability (Rule 702.123)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.123. Fabricate
 * 702.123a Fabricate is a triggered ability. "Fabricate N" means "When this permanent enters, 
 * you may put N +1/+1 counters on it. If you don't, create N 1/1 colorless Servo artifact 
 * creature tokens."
 * 702.123b If a permanent has multiple instances of fabricate, each triggers separately.
 */

export interface FabricateAbility {
  readonly type: 'fabricate';
  readonly source: string;
  readonly fabricateValue: number;
  readonly choseCounters: boolean | null; // null = not yet chosen
  readonly tokensCreated: readonly string[];
}

/**
 * Create a fabricate ability
 * Rule 702.123a
 * @param source - The permanent with fabricate
 * @param fabricateValue - Number of counters or tokens
 * @returns Fabricate ability object
 */
export function fabricate(source: string, fabricateValue: number): FabricateAbility {
  return {
    type: 'fabricate',
    source,
    fabricateValue,
    choseCounters: null,
    tokensCreated: [],
  };
}

/**
 * Choose to put counters on permanent
 * Rule 702.123a
 * @param ability - Fabricate ability
 * @returns Updated ability
 */
export function chooseCounters(ability: FabricateAbility): FabricateAbility {
  return {
    ...ability,
    choseCounters: true,
  };
}

/**
 * Choose to create Servo tokens
 * Rule 702.123a
 * @param ability - Fabricate ability
 * @param tokenIds - IDs of created Servo tokens
 * @returns Updated ability
 */
export function chooseTokens(ability: FabricateAbility, tokenIds: readonly string[]): FabricateAbility {
  return {
    ...ability,
    choseCounters: false,
    tokensCreated: tokenIds,
  };
}

/**
 * Check if counters were chosen
 * @param ability - Fabricate ability
 * @returns True if counters were chosen
 */
export function choseCountersOption(ability: FabricateAbility): boolean {
  return ability.choseCounters === true;
}

/**
 * Get created Servo tokens
 * @param ability - Fabricate ability
 * @returns IDs of created tokens
 */
export function getFabricateTokens(ability: FabricateAbility): readonly string[] {
  return ability.tokensCreated;
}

/**
 * Multiple instances of fabricate trigger separately
 * Rule 702.123b
 * @param abilities - Array of fabricate abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantFabricate(abilities: readonly FabricateAbility[]): boolean {
  return false; // Each instance triggers separately
}
