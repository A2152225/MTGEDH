/**
 * Eternalize keyword ability (Rule 702.129)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.129. Eternalize
 * 702.129a Eternalize is an activated ability that functions while the card with eternalize is 
 * in a graveyard. "Eternalize [cost]" means "[Cost], Exile this card from your graveyard: Create 
 * a token that's a copy of this card, except it's black, it's 4/4, it has no mana cost, and it's 
 * a Zombie in addition to its other types. Activate only as a sorcery."
 */

export interface EternalizeAbility {
  readonly type: 'eternalize';
  readonly source: string;
  readonly eternalizeCost: string;
  readonly hasBeenEternalized: boolean;
  readonly tokenId?: string;
}

/**
 * Create an eternalize ability
 * Rule 702.129a
 * @param source - The card with eternalize
 * @param eternalizeCost - Cost to activate eternalize
 * @returns Eternalize ability object
 */
export function eternalize(source: string, eternalizeCost: string): EternalizeAbility {
  return {
    type: 'eternalize',
    source,
    eternalizeCost,
    hasBeenEternalized: false,
  };
}

/**
 * Activate eternalize from graveyard
 * Rule 702.129a - Create black 4/4 Zombie token copy
 * @param ability - Eternalize ability
 * @param tokenId - ID of created token
 * @returns Updated ability
 */
export function activateEternalize(ability: EternalizeAbility, tokenId: string): EternalizeAbility {
  return {
    ...ability,
    hasBeenEternalized: true,
    tokenId,
  };
}

/**
 * Check if token was eternalized
 * @param ability - Eternalize ability
 * @returns True if token was created by eternalize
 */
export function isEternalized(ability: EternalizeAbility): boolean {
  return ability.hasBeenEternalized;
}

/**
 * Get eternalized token
 * @param ability - Eternalize ability
 * @returns Token ID or undefined
 */
export function getEternalizeToken(ability: EternalizeAbility): string | undefined {
  return ability.tokenId;
}

/**
 * Multiple instances of eternalize are not redundant
 * @param abilities - Array of eternalize abilities
 * @returns False
 */
export function hasRedundantEternalize(abilities: readonly EternalizeAbility[]): boolean {
  return false;
}
