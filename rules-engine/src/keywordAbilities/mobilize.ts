/**
 * Mobilize keyword ability (Rule 702.181)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.181. Mobilize
 * 702.181a Mobilize is a triggered ability. "Mobilize N" means "Whenever this creature attacks, 
 * create N 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice 
 * them at the beginning of the next end step."
 */

export interface MobilizeAbility {
  readonly type: 'mobilize';
  readonly source: string;
  readonly mobilizeValue: number; // Number of tokens to create
  readonly tokenIds: readonly string[];
}

/**
 * Create a mobilize ability
 * Rule 702.181a
 * @param source - The creature with mobilize
 * @param mobilizeValue - Number of Warrior tokens to create
 * @returns Mobilize ability object
 */
export function mobilize(source: string, mobilizeValue: number): MobilizeAbility {
  return {
    type: 'mobilize',
    source,
    mobilizeValue,
    tokenIds: [],
  };
}

/**
 * Trigger mobilize when attacking
 * Rule 702.181a - Create tokens that enter tapped and attacking
 * @param ability - Mobilize ability
 * @param tokenIds - IDs of created Warrior tokens
 * @returns Updated ability
 */
export function triggerMobilize(ability: MobilizeAbility, tokenIds: readonly string[]): MobilizeAbility {
  return {
    ...ability,
    tokenIds,
  };
}

/**
 * Get mobilize tokens
 * @param ability - Mobilize ability
 * @returns IDs of Warrior tokens
 */
export function getMobilizeTokens(ability: MobilizeAbility): readonly string[] {
  return ability.tokenIds;
}

/**
 * Get mobilize value
 * @param ability - Mobilize ability
 * @returns Number of tokens to create
 */
export function getMobilizeValue(ability: MobilizeAbility): number {
  return ability.mobilizeValue;
}

/**
 * Multiple instances of mobilize are not redundant
 * @param abilities - Array of mobilize abilities
 * @returns False
 */
export function hasRedundantMobilize(abilities: readonly MobilizeAbility[]): boolean {
  return false;
}
