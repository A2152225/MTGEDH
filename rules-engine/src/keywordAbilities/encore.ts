/**
 * Encore keyword ability (Rule 702.141)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.141. Encore
 * 702.141a Encore is an activated ability that functions while the card with encore is in a 
 * graveyard. "Encore [cost]" means "[Cost], Exile this card from your graveyard: For each 
 * opponent, create a token that's a copy of this card that attacks that opponent this turn if 
 * able. The tokens gain haste. Sacrifice them at the beginning of the next end step. Activate 
 * only as a sorcery."
 */

export interface EncoreAbility {
  readonly type: 'encore';
  readonly source: string;
  readonly encoreCost: string;
  readonly hasBeenEncored: boolean;
  readonly tokenIds: readonly string[];
}

/**
 * Create an encore ability
 * Rule 702.141a
 * @param source - The card with encore
 * @param encoreCost - Cost to activate encore
 * @returns Encore ability object
 */
export function encore(source: string, encoreCost: string): EncoreAbility {
  return {
    type: 'encore',
    source,
    encoreCost,
    hasBeenEncored: false,
    tokenIds: [],
  };
}

/**
 * Activate encore from graveyard
 * Rule 702.141a - Create token copies that attack each opponent
 * @param ability - Encore ability
 * @param tokenIds - IDs of created tokens (one per opponent)
 * @returns Updated ability
 */
export function activateEncore(ability: EncoreAbility, tokenIds: readonly string[]): EncoreAbility {
  return {
    ...ability,
    hasBeenEncored: true,
    tokenIds,
  };
}

/**
 * Check if encore has been activated
 * @param ability - Encore ability
 * @returns True if encore was activated
 */
export function hasBeenEncored(ability: EncoreAbility): boolean {
  return ability.hasBeenEncored;
}

/**
 * Get encore tokens
 * Rule 702.141a - Tokens must attack, have haste, and are sacrificed at end step
 * @param ability - Encore ability
 * @returns IDs of encore tokens
 */
export function getEncoreTokens(ability: EncoreAbility): readonly string[] {
  return ability.tokenIds;
}

/**
 * Get encore cost
 * @param ability - Encore ability
 * @returns Encore cost string
 */
export function getEncoreCost(ability: EncoreAbility): string {
  return ability.encoreCost;
}

/**
 * Multiple instances of encore are not redundant
 * @param abilities - Array of encore abilities
 * @returns False
 */
export function hasRedundantEncore(abilities: readonly EncoreAbility[]): boolean {
  return false;
}
