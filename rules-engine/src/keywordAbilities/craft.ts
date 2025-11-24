/**
 * Craft keyword ability (Rule 702.167)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.167. Craft
 * 702.167a Craft represents an activated ability. It is written as "Craft with [materials] [cost]," 
 * where [materials] is a description of one or more objects. It means "[Cost], Exile this permanent, 
 * Exile [materials] from among permanents you control and/or cards in your graveyard: Return this 
 * card to the battlefield transformed under its owner's control. Activate only as a sorcery."
 * 702.167b If an object in the [materials] of a craft ability is described using only a card type 
 * or subtype without the word "card," it refers to either a permanent on the battlefield that is 
 * that type or subtype or a card in a graveyard that is that type or subtype.
 * 702.167c An ability of a permanent may refer to the exiled cards used to craft it. This refers 
 * to cards in exile that were exiled to pay the activation cost of the craft ability that put this 
 * permanent onto the battlefield.
 */

export interface CraftAbility {
  readonly type: 'craft';
  readonly source: string;
  readonly craftCost: string;
  readonly materials: string; // Description of materials needed
  readonly hasCrafted: boolean;
  readonly exiledCards: readonly string[];
}

/**
 * Create a craft ability
 * Rule 702.167a
 * @param source - The permanent with craft
 * @param craftCost - Cost to activate craft
 * @param materials - Description of materials to exile
 * @returns Craft ability object
 */
export function craft(source: string, craftCost: string, materials: string): CraftAbility {
  return {
    type: 'craft',
    source,
    craftCost,
    materials,
    hasCrafted: false,
    exiledCards: [],
  };
}

/**
 * Activate craft ability
 * Rule 702.167a - Exile this, exile materials, return transformed
 * @param ability - Craft ability
 * @param exiledCards - IDs of exiled cards (materials)
 * @returns Updated ability
 */
export function activateCraft(ability: CraftAbility, exiledCards: readonly string[]): CraftAbility {
  return {
    ...ability,
    hasCrafted: true,
    exiledCards,
  };
}

/**
 * Get exiled cards used to craft
 * Rule 702.167c
 * @param ability - Craft ability
 * @returns IDs of exiled cards
 */
export function getCraftedMaterials(ability: CraftAbility): readonly string[] {
  return ability.exiledCards;
}

/**
 * Check if has crafted
 * @param ability - Craft ability
 * @returns True if crafted
 */
export function hasCrafted(ability: CraftAbility): boolean {
  return ability.hasCrafted;
}

/**
 * Get craft cost
 * @param ability - Craft ability
 * @returns Craft cost string
 */
export function getCraftCost(ability: CraftAbility): string {
  return ability.craftCost;
}

/**
 * Multiple instances of craft are not redundant
 * @param abilities - Array of craft abilities
 * @returns False
 */
export function hasRedundantCraft(abilities: readonly CraftAbility[]): boolean {
  return false;
}
