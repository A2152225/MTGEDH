/**
 * Disguise keyword ability (Rule 702.168)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.168. Disguise
 * 702.168a Disguise is a static ability that functions in any zone from which you could play the 
 * card it's on, and the disguise effect works any time the card is face down. "Disguise [cost]" 
 * means "You may cast this card as a 2/2 face-down creature with ward {2}, no name, no subtypes, 
 * and no mana cost by paying {3} rather than paying its mana cost."
 * 702.168b To cast a card using its disguise ability, turn the card face down and announce that 
 * you are using a disguise ability. It becomes a 2/2 face-down creature card with ward {2}, no 
 * name, no subtypes, and no mana cost. Pay {3} rather than pay its mana cost.
 * 702.168c You can't normally cast a card face down. A disguise ability allows you to do so.
 * 702.168d Any time you have priority, you may turn a face-down permanent you control with a 
 * disguise ability face up. This is a special action; it doesn't use the stack. To do this, show 
 * all players what the permanent's disguise cost would be if it were face up, pay that cost, then 
 * turn the permanent face up.
 * 702.168e If a permanent's disguise cost includes X, other abilities of that permanent may also 
 * refer to X. The value of X in those abilities is equal to the value of X chosen as the disguise 
 * special action was taken.
 */

export interface DisguiseAbility {
  readonly type: 'disguise';
  readonly source: string;
  readonly disguiseCost: string;
  readonly isFaceDown: boolean;
  readonly xValue?: number; // For disguise costs with X
}

/**
 * Create a disguise ability
 * Rule 702.168a
 * @param source - The card with disguise
 * @param disguiseCost - Cost to turn face up
 * @returns Disguise ability object
 */
export function disguise(source: string, disguiseCost: string): DisguiseAbility {
  return {
    type: 'disguise',
    source,
    disguiseCost,
    isFaceDown: false,
  };
}

/**
 * Cast card face down using disguise
 * Rule 702.168a - Pay {3}, becomes 2/2 face-down creature with ward {2}
 * @param ability - Disguise ability
 * @returns Updated ability
 */
export function castFaceDown(ability: DisguiseAbility): DisguiseAbility {
  return {
    ...ability,
    isFaceDown: true,
  };
}

/**
 * Turn disguised permanent face up
 * Rule 702.168d - Special action, pay disguise cost
 * @param ability - Disguise ability
 * @param xValue - Value of X if cost includes X
 * @returns Updated ability
 */
export function turnFaceUp(ability: DisguiseAbility, xValue?: number): DisguiseAbility {
  return {
    ...ability,
    isFaceDown: false,
    xValue,
  };
}

/**
 * Check if permanent is face down
 * @param ability - Disguise ability
 * @returns True if face down
 */
export function isFaceDown(ability: DisguiseAbility): boolean {
  return ability.isFaceDown;
}

/**
 * Get disguise cost
 * @param ability - Disguise ability
 * @returns Disguise cost string
 */
export function getDisguiseCost(ability: DisguiseAbility): string {
  return ability.disguiseCost;
}

/**
 * Get X value from disguise
 * Rule 702.168e
 * @param ability - Disguise ability
 * @returns X value or undefined
 */
export function getDisguiseX(ability: DisguiseAbility): number | undefined {
  return ability.xValue;
}

/**
 * Multiple instances of disguise are not redundant
 * @param abilities - Array of disguise abilities
 * @returns False
 */
export function hasRedundantDisguise(abilities: readonly DisguiseAbility[]): boolean {
  return false;
}
