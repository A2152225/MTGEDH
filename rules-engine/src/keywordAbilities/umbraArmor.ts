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
 * Result of applying Umbra Armor's replacement effect.
 */
export interface UmbraArmorResolution {
  readonly preventedDestruction: boolean;
  readonly enchantedPermanentId: string;
  readonly auraDestroyed: boolean;
  readonly damageRemoved: number;
  readonly auraSource: string;
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
 * Checks whether Umbra Armor can replace a destruction event.
 */
export function canApplyUmbraArmor(
  enchantedPermanentWouldBeDestroyed: boolean,
  isAttachedToPermanent: boolean = true,
  auraStillOnBattlefield: boolean = true
): boolean {
  return enchantedPermanentWouldBeDestroyed && isAttachedToPermanent && auraStillOnBattlefield;
}

/**
 * Apply umbra armor replacement effect
 * Returns true if Aura should be destroyed instead
 */
export function applyUmbraArmor(ability: UmbraArmorAbility): boolean {
  return ability.type === 'umbraArmor';
}

/**
 * Resolves Umbra Armor's destruction replacement effect.
 */
export function resolveUmbraArmor(
  ability: UmbraArmorAbility,
  enchantedPermanentId: string,
  markedDamage: number = 0
): UmbraArmorResolution {
  return {
    preventedDestruction: true,
    enchantedPermanentId,
    auraDestroyed: true,
    damageRemoved: Math.max(0, markedDamage),
    auraSource: ability.source,
  };
}

/**
 * Check if two umbra armor abilities are redundant
 * Multiple instances are redundant
 */
export function areUmbraArmorAbilitiesRedundant(a: UmbraArmorAbility, b: UmbraArmorAbility): boolean {
  return true;
}
