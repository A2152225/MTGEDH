/**
 * Madness keyword ability implementation
 * Rule 702.35
 * 
 * Madness is a keyword that represents two abilities.
 */

/**
 * Madness ability
 * Rule 702.35a
 * 
 * Madness is a keyword that allows you to cast a card when you discard it
 * by paying its madness cost instead of its mana cost.
 */
export interface MadnessAbility {
  readonly type: 'madness';
  readonly cost: string;
  readonly source: string;
  readonly inMadnessExile: boolean;
}

/**
 * Creates a madness ability
 * Rule 702.35a
 * 
 * @param source - The card with madness
 * @param cost - The madness cost
 * @returns Madness ability
 */
export function madness(source: string, cost: string): MadnessAbility {
  return {
    type: 'madness',
    cost,
    source,
    inMadnessExile: false,
  };
}

/**
 * Exiles card when discarded (madness trigger)
 * Rule 702.35a
 * 
 * @param ability - The madness ability
 * @returns Updated ability in madness exile state
 */
export function exileWithMadness(ability: MadnessAbility): MadnessAbility {
  return {
    ...ability,
    inMadnessExile: true,
  };
}

/**
 * Casts spell from madness exile
 * Rule 702.35b
 * 
 * @param ability - The madness ability
 * @returns Updated ability no longer in exile
 */
export function castWithMadness(ability: MadnessAbility): MadnessAbility {
  return {
    ...ability,
    inMadnessExile: false,
  };
}

/**
 * Moves card to graveyard if madness not used
 * Rule 702.35c
 * 
 * @param ability - The madness ability
 * @returns True if card should go to graveyard
 */
export function shouldMoveToGraveyardFromMadness(ability: MadnessAbility): boolean {
  return ability.inMadnessExile;
}

/**
 * Checks if multiple madness abilities are redundant
 * Rule 702.35d - Multiple instances of madness are redundant
 * 
 * @param abilities - Array of madness abilities
 * @returns True if more than one madness
 */
export function hasRedundantMadness(abilities: readonly MadnessAbility[]): boolean {
  return abilities.length > 1;
}
