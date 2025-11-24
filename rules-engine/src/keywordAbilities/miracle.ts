/**
 * Miracle keyword ability implementation
 * Rule 702.94 - "Miracle" means an alternative cost that lets you cast this card for its miracle cost if it's the first card you drew this turn
 */

/**
 * Miracle ability - Rule 702.94
 * Represents an alternative casting cost available when the spell is the first card drawn this turn
 */
export interface MiracleAbility {
  readonly type: 'miracle';
  readonly source: string;
  readonly miracleCost: string;
  readonly wasFirstCardDrawn: boolean;
  readonly canPayMiracle: boolean;
}

/**
 * Creates a miracle ability
 * @param source - The source card with miracle
 * @param miracleCost - The miracle cost to cast the spell
 * @returns Miracle ability
 */
export function miracle(source: string, miracleCost: string): MiracleAbility {
  return {
    type: 'miracle',
    source,
    miracleCost,
    wasFirstCardDrawn: false,
    canPayMiracle: false,
  };
}

/**
 * Marks a card as the first card drawn this turn, enabling miracle
 * @param ability - The miracle ability
 * @returns Updated miracle ability
 */
export function markAsFirstCardDrawn(ability: MiracleAbility): MiracleAbility {
  return {
    ...ability,
    wasFirstCardDrawn: true,
    canPayMiracle: true,
  };
}

/**
 * Pays the miracle cost to cast the spell
 * @param ability - The miracle ability
 * @returns Updated miracle ability
 */
export function payMiracleCost(ability: MiracleAbility): MiracleAbility {
  if (!ability.canPayMiracle) {
    throw new Error('Cannot pay miracle cost - card was not the first card drawn this turn');
  }
  return {
    ...ability,
    canPayMiracle: false,
  };
}

/**
 * Checks if miracle can be activated
 * @param ability - The miracle ability
 * @returns True if the ability can be used
 */
export function canUseMiracle(ability: MiracleAbility): boolean {
  return ability.canPayMiracle && ability.wasFirstCardDrawn;
}
