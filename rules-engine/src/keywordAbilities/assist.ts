/**
 * Assist keyword ability (Rule 702.132)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.132. Assist
 * 702.132a Assist is a static ability that modifies the rules of paying for the spell with 
 * assist (see rules 601.2g-h). If the total cost to cast a spell with assist includes a generic 
 * mana component, before you activate mana abilities while casting it, you may choose another 
 * player. That player has a chance to activate mana abilities. Once that player chooses not to 
 * activate any more mana abilities, you have a chance to activate mana abilities. Before you 
 * begin to pay the total cost of the spell, the player you chose may pay for any amount of the 
 * generic mana in the spell's total cost.
 */

export interface AssistAbility {
  readonly type: 'assist';
  readonly source: string;
  readonly assistingPlayer?: string;
  readonly manaPaidByAssist: number;
}

/**
 * Create an assist ability
 * Rule 702.132a
 * @param source - The spell with assist
 * @returns Assist ability object
 */
export function assist(source: string): AssistAbility {
  return {
    type: 'assist',
    source,
    manaPaidByAssist: 0,
  };
}

/**
 * Choose a player to assist with casting
 * Rule 702.132a
 * @param ability - Assist ability
 * @param playerId - ID of assisting player
 * @returns Updated ability
 */
export function chooseAssistingPlayer(ability: AssistAbility, playerId: string): AssistAbility {
  return {
    ...ability,
    assistingPlayer: playerId,
  };
}

/**
 * Apply mana paid by assisting player
 * Rule 702.132a - Can pay any amount of generic mana
 * @param ability - Assist ability
 * @param manaPaid - Amount of generic mana paid
 * @returns Updated ability
 */
export function applyAssist(ability: AssistAbility, manaPaid: number): AssistAbility {
  return {
    ...ability,
    manaPaidByAssist: manaPaid,
  };
}

/**
 * Get mana paid via assist
 * @param ability - Assist ability
 * @returns Amount of mana paid by assist
 */
export function getAssistMana(ability: AssistAbility): number {
  return ability.manaPaidByAssist;
}

/**
 * Multiple instances of assist are not redundant
 * @param abilities - Array of assist abilities
 * @returns False
 */
export function hasRedundantAssist(abilities: readonly AssistAbility[]): boolean {
  return false;
}
