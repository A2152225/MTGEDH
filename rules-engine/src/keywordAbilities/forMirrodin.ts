/**
 * For Mirrodin! keyword ability (Rule 702.163)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.163. For Mirrodin!
 * 702.163a For Mirrodin! is a triggered ability. "For Mirrodin!" means "When this Equipment 
 * enters, create a 2/2 red Rebel creature token, then attach this Equipment to it."
 */

export interface ForMirrodinAbility {
  readonly type: 'for-mirrodin';
  readonly source: string;
  readonly hasTriggered: boolean;
  readonly tokenId?: string;
}

/**
 * Create a For Mirrodin! ability
 * Rule 702.163a
 * @param source - The Equipment with For Mirrodin!
 * @returns For Mirrodin! ability object
 */
export function forMirrodin(source: string): ForMirrodinAbility {
  return {
    type: 'for-mirrodin',
    source,
    hasTriggered: false,
  };
}

/**
 * Trigger For Mirrodin! when Equipment enters
 * Rule 702.163a - Create 2/2 Rebel token, attach to it
 * @param ability - For Mirrodin! ability
 * @param tokenId - ID of created Rebel token
 * @returns Updated ability
 */
export function triggerForMirrodin(ability: ForMirrodinAbility, tokenId: string): ForMirrodinAbility {
  return {
    ...ability,
    hasTriggered: true,
    tokenId,
  };
}

/**
 * Get created Rebel token
 * @param ability - For Mirrodin! ability
 * @returns Token ID or undefined
 */
export function getForMirrodinToken(ability: ForMirrodinAbility): string | undefined {
  return ability.tokenId;
}

/**
 * Multiple instances of For Mirrodin! are not redundant
 * @param abilities - Array of For Mirrodin! abilities
 * @returns False
 */
export function hasRedundantForMirrodin(abilities: readonly ForMirrodinAbility[]): boolean {
  return false;
}
