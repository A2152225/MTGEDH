/**
 * Sneak keyword ability (Rule 702.190)
 *
 * 702.190a Sneak is an alternative cost that can be paid during your declare
 * blockers step by returning an unblocked attacking creature you control.
 * 702.190b A permanent spell cast this way enters tapped and attacking the same
 * player/planeswalker/battle as the returned creature.
 */

export interface SneakAbility {
  readonly type: 'sneak';
  readonly source: string;
  readonly sneakCost: string;
  readonly returnedCreatureId?: string;
  readonly wasSneakPaid: boolean;
  readonly entersTappedAndAttacking: boolean;
}

export interface SneakSummary {
  readonly source: string;
  readonly sneakCost: string;
  readonly canActivateSneak: boolean;
  readonly wasSneakPaid: boolean;
  readonly returnedCreatureId?: string;
  readonly entersTappedAndAttacking: boolean;
}

/**
 * Create a sneak ability from card text.
 */
export function sneak(source: string, sneakCost: string): SneakAbility {
  return {
    type: 'sneak',
    source,
    sneakCost,
    wasSneakPaid: false,
    entersTappedAndAttacking: false,
  };
}

/**
 * Pay sneak and record the unblocked attacker returned to hand.
 */
export function paySneak(
  ability: SneakAbility,
  returnedCreatureId: string,
): SneakAbility {
  return {
    ...ability,
    returnedCreatureId,
    wasSneakPaid: true,
    entersTappedAndAttacking: true,
  };
}

/**
 * Sneak can be activated only in your declare blockers step with an unblocked attacker.
 */
export function canActivateSneak(
  hasUnblockedAttacker: boolean,
  isDeclareBlockersStep: boolean,
): boolean {
  return hasUnblockedAttacker && isDeclareBlockersStep;
}

/**
 * Check if the spell was cast via sneak.
 */
export function wasSneakCast(ability: SneakAbility): boolean {
  return ability.wasSneakPaid;
}

/**
 * Multiple sneak abilities with the same cost are redundant.
 */
export function hasRedundantSneak(abilities: readonly SneakAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }

  const costs = new Set(abilities.map((a) => a.sneakCost));
  return costs.size < abilities.length;
}

export function createSneakSummary(
  ability: SneakAbility,
  hasUnblockedAttacker: boolean,
  isDeclareBlockersStep: boolean,
): SneakSummary {
  return {
    source: ability.source,
    sneakCost: ability.sneakCost,
    canActivateSneak: canActivateSneak(hasUnblockedAttacker, isDeclareBlockersStep),
    wasSneakPaid: ability.wasSneakPaid,
    returnedCreatureId: ability.returnedCreatureId,
    entersTappedAndAttacking: ability.entersTappedAndAttacking,
  };
}
