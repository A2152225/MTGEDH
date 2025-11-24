/**
 * Flashback keyword ability implementation
 * Rule 702.34
 * 
 * Flashback is a static ability that functions while the card with flashback is in a player's graveyard.
 */

/**
 * Flashback ability
 * Rule 702.34a
 * 
 * "Flashback [cost]" means "You may cast this card from your graveyard by paying [cost]
 * rather than paying its mana cost" and "If the flashback cost was paid, exile this card
 * instead of putting it anywhere else any time it would leave the stack."
 */
export interface FlashbackAbility {
  readonly type: 'flashback';
  readonly cost: string;
  readonly source: string;
  readonly wasCastWithFlashback: boolean;
}

/**
 * Creates a flashback ability
 * Rule 702.34a
 * 
 * @param source - The spell with flashback
 * @param cost - The flashback cost
 * @returns Flashback ability
 */
export function flashback(source: string, cost: string): FlashbackAbility {
  return {
    type: 'flashback',
    cost,
    source,
    wasCastWithFlashback: false,
  };
}

/**
 * Casts spell with flashback
 * Rule 702.34a
 * 
 * @param ability - The flashback ability
 * @returns Updated ability indicating it was cast with flashback
 */
export function castWithFlashback(ability: FlashbackAbility): FlashbackAbility {
  return {
    ...ability,
    wasCastWithFlashback: true,
  };
}

/**
 * Checks if spell should be exiled instead of going to graveyard
 * Rule 702.34a
 * 
 * @param ability - The flashback ability
 * @returns True if cast with flashback (should be exiled)
 */
export function shouldExileAfterFlashback(ability: FlashbackAbility): boolean {
  return ability.wasCastWithFlashback;
}

/**
 * Checks if multiple flashback abilities are redundant
 * Rule 702.34b - Multiple instances of flashback are redundant
 * 
 * @param abilities - Array of flashback abilities
 * @returns True if more than one flashback
 */
export function hasRedundantFlashback(abilities: readonly FlashbackAbility[]): boolean {
  return abilities.length > 1;
}
