/**
 * Aftermath keyword ability (Rule 702.127)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.127. Aftermath
 * 702.127a Aftermath is an ability found on some split cards (see rule 709, "Split Cards"). 
 * It represents three static abilities. "Aftermath" means "You may cast this half of this split 
 * card from your graveyard," "This half of this split card can't be cast from any zone other 
 * than a graveyard," and "If this spell was cast from a graveyard, exile it instead of putting 
 * it anywhere else any time it would leave the stack."
 */

export interface AftermathAbility {
  readonly type: 'aftermath';
  readonly source: string;
  readonly wasCastFromGraveyard: boolean;
}

/**
 * Create an aftermath ability
 * Rule 702.127a
 * @param source - The split card half with aftermath
 * @returns Aftermath ability object
 */
export function aftermath(source: string): AftermathAbility {
  return {
    type: 'aftermath',
    source,
    wasCastFromGraveyard: false,
  };
}

/**
 * Check if aftermath half can be cast from graveyard
 * Rule 702.127a - Can only be cast from graveyard
 * @param zone - Zone the card is in
 * @returns True if can be cast
 */
export function canCastAftermath(zone: 'graveyard' | 'hand' | 'library' | 'battlefield' | 'exile'): boolean {
  return zone === 'graveyard';
}

/**
 * Cast aftermath spell from graveyard
 * Rule 702.127a
 * @param ability - Aftermath ability
 * @returns Updated ability
 */
export function castFromGraveyard(ability: AftermathAbility): AftermathAbility {
  return {
    ...ability,
    wasCastFromGraveyard: true,
  };
}

/**
 * Check if spell should be exiled
 * Rule 702.127a - Exile if cast from graveyard
 * @param ability - Aftermath ability
 * @returns True if should be exiled
 */
export function shouldExileAftermath(ability: AftermathAbility): boolean {
  return ability.wasCastFromGraveyard;
}

/**
 * Multiple instances of aftermath are redundant
 * @param abilities - Array of aftermath abilities
 * @returns True if more than one instance
 */
export function hasRedundantAftermath(abilities: readonly AftermathAbility[]): boolean {
  return abilities.length > 1;
}
