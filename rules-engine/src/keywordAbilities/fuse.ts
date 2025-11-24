/**
 * Fuse keyword ability implementation (Rule 702.102)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.102a Fuse is a static ability found on some split cards (see rule 709, "Split Cards")
 * that applies while the spell with fuse is on the stack. "Fuse" means "You may cast both halves
 * of this card from your hand." The resulting spell is a fused split spell (see rule 709.4).
 * 
 * 702.102b A player may cast a split card with fuse from their hand and choose to cast both halves
 * if that card is in their hand and they can pay all costs for both halves. This is an exception
 * to rule 601.3b.
 */

/**
 * Fuse ability interface
 */
export interface FuseAbility {
  readonly type: 'fuse';
  readonly source: string;
  readonly leftHalfCost: string;
  readonly rightHalfCost: string;
  readonly isFused: boolean;
}

/**
 * Creates a fuse ability
 * @param source - Source split card with fuse
 * @param leftCost - Cost of left half
 * @param rightCost - Cost of right half
 * @returns Fuse ability
 */
export function fuse(
  source: string,
  leftCost: string,
  rightCost: string
): FuseAbility {
  return {
    type: 'fuse',
    source,
    leftHalfCost: leftCost,
    rightHalfCost: rightCost,
    isFused: false,
  };
}

/**
 * Casts both halves using fuse
 * @param ability - Fuse ability
 * @returns Updated fuse ability with fused status
 */
export function castFused(ability: FuseAbility): FuseAbility {
  return {
    ...ability,
    isFused: true,
  };
}

/**
 * Gets total cost when fusing
 * @param ability - Fuse ability
 * @returns Combined cost string (for display)
 */
export function getFusedCost(ability: FuseAbility): string {
  return `${ability.leftHalfCost} + ${ability.rightHalfCost}`;
}

/**
 * Checks if spell was fused
 * @param ability - Fuse ability
 * @returns True if both halves were cast
 */
export function isFused(ability: FuseAbility): boolean {
  return ability.isFused;
}
