/**
 * Ninjutsu keyword ability implementation (Rule 702.49)
 * @see MagicCompRules 702.49
 */

export interface NinjutsuAbility {
  readonly type: 'ninjutsu';
  readonly cost: string;
  readonly source: string;
  readonly returnedCreature?: string;
}

export function ninjutsu(source: string, cost: string): NinjutsuAbility {
  return { type: 'ninjutsu', cost, source };
}

export function activateNinjutsu(ability: NinjutsuAbility, returnedCreature: string): NinjutsuAbility {
  return { ...ability, returnedCreature };
}

export function canActivateNinjutsu(hasUnblockedAttacker: boolean, inCombat: boolean): boolean {
  return hasUnblockedAttacker && inCombat;
}

/**
 * Checks whether ninjutsu can be activated from the given zone.
 *
 * @param ability - The ninjutsu ability
 * @param zone - The card's current zone
 * @param hasUnblockedAttacker - Whether the player controls an unblocked attacker
 * @param inCombat - Whether the game is currently in combat
 * @returns True if ninjutsu can be activated now
 */
export function canActivateNinjutsuFromZone(
  ability: NinjutsuAbility,
  zone: string,
  hasUnblockedAttacker: boolean,
  inCombat: boolean
): boolean {
  return zone === 'hand' && canActivateNinjutsu(hasUnblockedAttacker, inCombat);
}

/**
 * Creates the activation result for ninjutsu.
 *
 * @param ability - The ninjutsu ability
 * @param zone - The card's current zone
 * @param hasUnblockedAttacker - Whether the player controls an unblocked attacker
 * @param inCombat - Whether the game is currently in combat
 * @param returnedCreature - The attacker returned to hand for ninjutsu
 * @returns Activation summary, or null if ninjutsu cannot be activated now
 */
export function createNinjutsuActivationResult(
  ability: NinjutsuAbility,
  zone: string,
  hasUnblockedAttacker: boolean,
  inCombat: boolean,
  returnedCreature: string | undefined
): {
  source: string;
  fromZone: 'hand';
  returnedCreature: string;
  activationCostPaid: string;
} | null {
  if (!returnedCreature || !canActivateNinjutsuFromZone(ability, zone, hasUnblockedAttacker, inCombat)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    returnedCreature,
    activationCostPaid: ability.cost,
  };
}
