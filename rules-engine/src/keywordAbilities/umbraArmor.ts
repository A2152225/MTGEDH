/**
 * Umbra Armor keyword ability (Rule 702.89)
 * @module keywordAbilities/umbraArmor
 */

/**
 * Umbra Armor ability (Rule 702.89)
 * Static ability that protects enchanted permanent
 */
export interface UmbraArmorAbility {
  readonly type: 'umbraArmor';
  readonly source: string;
}

/**
 * Create an umbra armor ability
 * Rule 702.89a: "Umbra armor" means "If enchanted permanent would be destroyed,
 * instead remove all damage marked on it and destroy this Aura."
 */
export function umbraArmor(source: string): UmbraArmorAbility {
  return {
    type: 'umbraArmor',
    source
  };
}

/**
 * Apply umbra armor replacement effect
 * Returns true if Aura should be destroyed instead
 */
export function applyUmbraArmor(ability: UmbraArmorAbility): boolean {
  return true;
}

/**
 * Check if two umbra armor abilities are redundant
 * Multiple instances are redundant
 */
export function areUmbraArmorAbilitiesRedundant(a: UmbraArmorAbility, b: UmbraArmorAbility): boolean {
  return true;
}
