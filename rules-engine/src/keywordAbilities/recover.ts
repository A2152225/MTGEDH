/**
 * Recover keyword ability (Rule 702.59)
 * 
 * @module keywordAbilities/recover
 */

/**
 * Represents a recover ability on a card.
 * Rule 702.59: Recover is a triggered ability that functions only while the card with 
 * recover is in a player's graveyard. "Recover [cost]" means "When a creature is put 
 * into your graveyard from the battlefield, you may pay [cost]. If you do, return this 
 * card from your graveyard to your hand. Otherwise, exile this card."
 */
export interface RecoverAbility {
  readonly type: 'recover';
  readonly cost: string;
  readonly source: string;
}

/**
 * Creates a recover ability.
 * 
 * @param source - The source card with recover
 * @param cost - The recover cost
 * @returns A recover ability
 * 
 * @example
 * ```typescript
 * const ability = recover('Krovikan Rot', '{1}{B}{B}');
 * ```
 */
export function recover(source: string, cost: string): RecoverAbility {
  return {
    type: 'recover',
    cost,
    source
  };
}
