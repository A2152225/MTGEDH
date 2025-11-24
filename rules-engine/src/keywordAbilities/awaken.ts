/**
 * Awaken keyword ability (Rule 702.113)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.113. Awaken
 * 702.113a Awaken appears on some instants and sorceries. It represents two abilities: a 
 * static ability that functions while the spell with awaken is on the stack and a spell ability. 
 * "Awaken N—[cost]" means "You may pay [cost] rather than pay this spell's mana cost as you 
 * cast this spell" and "If this spell's awaken cost was paid, put N +1/+1 counters on target 
 * land you control. That land becomes a 0/0 Elemental creature with haste. It's still a land."
 * 702.113b The controller of a spell with awaken chooses the target of the awaken spell ability 
 * only if that player chose to pay the spell's awaken cost.
 */

export interface AwakenAbility {
  readonly type: 'awaken';
  readonly source: string;
  readonly awakenValue: number;
  readonly awakenCost: string;
  readonly wasAwakened: boolean;
  readonly targetLand?: string;
}

/**
 * Create an awaken ability
 * Rule 702.113a
 * @param source - The spell with awaken
 * @param awakenValue - Number of +1/+1 counters to put on land
 * @param awakenCost - Alternative cost to cast with awaken
 * @returns Awaken ability object
 */
export function awaken(source: string, awakenValue: number, awakenCost: string): AwakenAbility {
  return {
    type: 'awaken',
    source,
    awakenValue,
    awakenCost,
    wasAwakened: false,
  };
}

/**
 * Cast spell with awaken cost, targeting a land
 * Rule 702.113a - Land becomes 0/0 Elemental creature with haste
 * @param ability - Awaken ability
 * @param targetLand - ID of land to awaken
 * @returns Updated ability with wasAwakened set to true
 */
export function castWithAwaken(ability: AwakenAbility, targetLand: string): AwakenAbility {
  return {
    ...ability,
    wasAwakened: true,
    targetLand,
  };
}

/**
 * Check if spell was cast with awaken cost
 * @param ability - Awaken ability
 * @returns True if awaken cost was paid
 */
export function wasAwakened(ability: AwakenAbility): boolean {
  return ability.wasAwakened;
}

/**
 * Get the awakened land
 * @param ability - Awaken ability
 * @returns ID of awakened land or undefined
 */
export function getAwakenedLand(ability: AwakenAbility): string | undefined {
  return ability.targetLand;
}

/**
 * Get awaken value (number of counters)
 * @param ability - Awaken ability
 * @returns Awaken value
 */
export function getAwakenValue(ability: AwakenAbility): number {
  return ability.awakenValue;
}

/**
 * Multiple instances of awaken are not redundant
 * @param abilities - Array of awaken abilities
 * @returns False - each can target different lands
 */
export function hasRedundantAwaken(abilities: readonly AwakenAbility[]): boolean {
  return false;
}
