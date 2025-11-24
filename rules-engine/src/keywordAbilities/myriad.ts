/**
 * Myriad keyword ability (Rule 702.116)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.116. Myriad
 * 702.116a Myriad is a triggered ability that may also create a delayed triggered ability. 
 * "Myriad" means "Whenever this creature attacks, for each opponent other than defending player, 
 * you may create a token that's a copy of this creature that's tapped and attacking that player 
 * or a planeswalker they control. If one or more tokens are created this way, exile the tokens 
 * at end of combat."
 * 702.116b If a creature has multiple instances of myriad, each triggers separately.
 */

export interface MyriadAbility {
  readonly type: 'myriad';
  readonly source: string;
  readonly tokensCreated: readonly string[];
  readonly hasTriggered: boolean;
}

/**
 * Create a myriad ability
 * Rule 702.116a
 * @param source - The creature with myriad
 * @returns Myriad ability object
 */
export function myriad(source: string): MyriadAbility {
  return {
    type: 'myriad',
    source,
    tokensCreated: [],
    hasTriggered: false,
  };
}

/**
 * Trigger myriad when creature attacks
 * Rule 702.116a - Create token copies for each other opponent
 * @param ability - Myriad ability
 * @param tokenIds - IDs of created token copies
 * @returns Updated ability with tokens recorded
 */
export function triggerMyriad(ability: MyriadAbility, tokenIds: readonly string[]): MyriadAbility {
  return {
    ...ability,
    tokensCreated: [...ability.tokensCreated, ...tokenIds],
    hasTriggered: true,
  };
}

/**
 * Exile myriad tokens at end of combat
 * Rule 702.116a
 * @param ability - Myriad ability
 * @returns IDs of tokens to exile
 */
export function getMyriadTokensToExile(ability: MyriadAbility): readonly string[] {
  return ability.tokensCreated;
}

/**
 * Clear myriad tokens after exiling
 * @param ability - Myriad ability
 * @returns Ability with tokens cleared
 */
export function clearMyriadTokens(ability: MyriadAbility): MyriadAbility {
  return {
    ...ability,
    tokensCreated: [],
    hasTriggered: false,
  };
}

/**
 * Multiple instances of myriad trigger separately
 * Rule 702.116b
 * @param abilities - Array of myriad abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantMyriad(abilities: readonly MyriadAbility[]): boolean {
  return false; // Each instance triggers separately
}
