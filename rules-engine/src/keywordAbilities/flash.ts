/**
 * Flash - Rule 702.8
 * 
 * You may play this card any time you could cast an instant.
 */

/**
 * Represents the flash keyword ability
 * Rule 702.8
 */
export interface FlashAbility {
  readonly type: 'flash';
  readonly source: string; // ID of the object with flash
}

/**
 * Create a flash ability
 * Rule 702.8a - Flash is a static ability that functions in any zone from which you could play the card
 * 
 * @param source - ID of the object with flash
 * @returns Flash ability
 */
export function flash(source: string): FlashAbility {
  return {
    type: 'flash',
    source,
  };
}

/**
 * Check if a spell can be cast at instant speed due to flash
 * Rule 702.8a - "Flash" means "You may play this card any time you could cast an instant"
 * 
 * @param hasFlash - Whether the card has flash
 * @param canCastInstant - Whether the player can currently cast an instant
 * @returns true if the spell can be cast
 */
export function canCastWithFlash(hasFlash: boolean, canCastInstant: boolean): boolean {
  return hasFlash && canCastInstant;
}

/**
 * Check if multiple flash abilities are redundant
 * Rule 702.8b - Multiple instances of flash on the same object are redundant
 * 
 * @param abilities - Array of flash abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantFlash(abilities: readonly FlashAbility[]): boolean {
  return abilities.length > 1;
}
