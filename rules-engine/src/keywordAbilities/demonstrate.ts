/**
 * Demonstrate keyword ability (Rule 702.144)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.144. Demonstrate
 * 702.144a Demonstrate is a triggered ability. "Demonstrate" means "When you cast this spell, 
 * you may copy it and you may choose new targets for the copy. If you copy the spell, choose an 
 * opponent. That player copies the spell and may choose new targets for that copy."
 */

export interface DemonstrateAbility {
  readonly type: 'demonstrate';
  readonly source: string;
  readonly hasCopied: boolean;
  readonly chosenOpponent?: string;
  readonly yourCopyId?: string;
  readonly opponentCopyId?: string;
}

export interface DemonstrateSummary {
  readonly source: string;
  readonly hasCopied: boolean;
  readonly chosenOpponent?: string;
  readonly copyCount: number;
  readonly givesOpponentCopy: boolean;
}

/**
 * Create a demonstrate ability
 * Rule 702.144a
 * @param source - The spell with demonstrate
 * @returns Demonstrate ability object
 */
export function demonstrate(source: string): DemonstrateAbility {
  return {
    type: 'demonstrate',
    source,
    hasCopied: false,
  };
}

/**
 * Trigger demonstrate when spell is cast
 * Rule 702.144a - You may copy it, then opponent copies it
 * @param ability - Demonstrate ability
 * @param chosenOpponent - Opponent who gets a copy
 * @param yourCopyId - ID of your copy
 * @param opponentCopyId - ID of opponent's copy
 * @returns Updated ability
 */
export function triggerDemonstrate(
  ability: DemonstrateAbility,
  chosenOpponent: string,
  yourCopyId: string,
  opponentCopyId: string
): DemonstrateAbility {
  return {
    ...ability,
    hasCopied: true,
    chosenOpponent,
    yourCopyId,
    opponentCopyId,
  };
}

/**
 * Decline to copy with demonstrate
 * @param ability - Demonstrate ability
 * @returns Updated ability
 */
export function declineDemonstrate(ability: DemonstrateAbility): DemonstrateAbility {
  return {
    ...ability,
    hasCopied: false,
  };
}

/**
 * Check if spell was copied via demonstrate
 * @param ability - Demonstrate ability
 * @returns True if copied
 */
export function wasDemonstrated(ability: DemonstrateAbility): boolean {
  return ability.hasCopied;
}

/**
 * Get chosen opponent
 * @param ability - Demonstrate ability
 * @returns Opponent ID or undefined
 */
export function getDemonstrateOpponent(ability: DemonstrateAbility): string | undefined {
  return ability.chosenOpponent;
}

/**
 * Demonstrate can only create copies when an opponent is available to receive one.
 */
export function canDemonstrate(opponentIds: readonly string[]): boolean {
  return opponentIds.filter(Boolean).length > 0;
}

/**
 * Return both copy ids created by demonstrate.
 */
export function getDemonstrateCopyIds(ability: DemonstrateAbility): readonly string[] {
  return [ability.yourCopyId, ability.opponentCopyId].filter(Boolean) as string[];
}

/**
 * Multiple instances of demonstrate are not redundant
 * @param abilities - Array of demonstrate abilities
 * @returns False
 */
export function hasRedundantDemonstrate(abilities: readonly DemonstrateAbility[]): boolean {
  return false;
}

export function createDemonstrateSummary(ability: DemonstrateAbility): DemonstrateSummary {
  const copyIds = getDemonstrateCopyIds(ability);
  return {
    source: ability.source,
    hasCopied: ability.hasCopied,
    chosenOpponent: ability.chosenOpponent,
    copyCount: copyIds.length,
    givesOpponentCopy: Boolean(ability.opponentCopyId),
  };
}
