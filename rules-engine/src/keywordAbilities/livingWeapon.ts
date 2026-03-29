/**
 * Living Weapon keyword ability (Rule 702.92)
 * @module keywordAbilities/livingWeapon
 */

/**
 * Living Weapon ability (Rule 702.92)
 * Triggered ability that creates a Germ token and attaches Equipment
 */
export interface LivingWeaponAbility {
  readonly type: 'livingWeapon';
  readonly source: string;
  readonly germToken?: string;
}

/**
 * Create a living weapon ability
 * Rule 702.92a: "Living weapon" means "When this Equipment enters, create a
 * 0/0 black Phyrexian Germ creature token, then attach this Equipment to it."
 */
export function livingWeapon(source: string): LivingWeaponAbility {
  return {
    type: 'livingWeapon',
    source
  };
}

/**
 * Trigger living weapon - creates token
 */
export function triggerLivingWeapon(ability: LivingWeaponAbility, tokenId: string): LivingWeaponAbility {
  return {
    ...ability,
    germToken: tokenId
  };
}

/**
 * Get the Germ token created
 */
export function getGermToken(ability: LivingWeaponAbility): string | undefined {
  return ability.germToken;
}

/**
 * Checks whether living weapon has already created its Germ token.
 *
 * @param ability - The living weapon ability
 * @returns True if a Germ token has been created
 */
export function hasLivingWeaponToken(ability: LivingWeaponAbility): boolean {
  return Boolean(ability.germToken);
}

/**
 * Creates the resolution summary for living weapon.
 *
 * @param ability - The living weapon ability after it has triggered
 * @returns Summary of token creation and attachment, or null if no token exists yet
 */
export function createLivingWeaponResolutionResult(
  ability: LivingWeaponAbility
): {
  source: string;
  germToken: string;
  attachToToken: true;
} | null {
  if (!ability.germToken) {
    return null;
  }

  return {
    source: ability.source,
    germToken: ability.germToken,
    attachToToken: true,
  };
}

/**
 * Check if two living weapon abilities are redundant
 * Multiple instances trigger separately
 */
export function areLivingWeaponAbilitiesRedundant(a: LivingWeaponAbility, b: LivingWeaponAbility): boolean {
  return false;
}
