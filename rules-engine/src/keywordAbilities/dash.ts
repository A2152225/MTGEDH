/**
 * Dash keyword ability (Rule 702.109)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.109. Dash
 * 702.109a Dash represents three abilities: two static abilities that function while the 
 * card with dash is on the stack, one of which may create a delayed triggered ability, and 
 * a static ability that functions while the object with dash is on the battlefield. "Dash 
 * [cost]" means "You may cast this card by paying [cost] rather than its mana cost," "If 
 * this spell's dash cost was paid, return the permanent this spell becomes to its owner's 
 * hand at the beginning of the next end step," and "As long as this permanent's dash cost 
 * was paid, it has haste."
 * 702.109b Casting a spell for its dash cost follows the rules for paying alternative costs 
 * in rules 601.2b and 601.2f–h.
 */

export interface DashAbility {
  readonly type: 'dash';
  readonly source: string;
  readonly dashCost: string;
  readonly dashed: boolean;
  readonly wasPaid: boolean;
  readonly returnedToHand: boolean;
}

/**
 * Create a dash ability
 * Rule 702.109a
 */
export function dash(source: string, cost: string): DashAbility {
  return {
    type: 'dash',
    source,
    dashCost: cost,
    dashed: false,
    wasPaid: false,
    returnedToHand: false,
  };
}

/**
 * Cast using dash cost
 * Rule 702.109a - Alternative cost that gives haste and return trigger
 */
export function payDash(ability: DashAbility): DashAbility {
  return {
    ...ability,
    wasPaid: true,
    dashed: true,
  };
}

/**
 * Return dashed permanent to owner's hand
 * Rule 702.109a
 */
export function returnFromDash(ability: DashAbility): DashAbility {
  return {
    ...ability,
    dashed: true,
  };
}

/**
 * Check if dash cost was paid
 */
export function wasDashed(ability: DashAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check if permanent has haste from dash
 * Rule 702.109a - "As long as this permanent's dash cost was paid, it has haste"
 */
export function hasHasteFromDash(ability: DashAbility): boolean {
  return ability.wasPaid && !ability.returnedToHand;
}

/**
 * Return dashed permanent to hand at end step
 * Rule 702.109a
 */
export function returnDashedPermanent(ability: DashAbility): DashAbility {
  if (!ability.wasPaid || ability.returnedToHand) {
    return ability;
  }
  
  return {
    ...ability,
    returnedToHand: true,
  };
}

/**
 * Dash abilities with same cost are redundant
 */
export function hasRedundantDash(
  abilities: readonly DashAbility[]
): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.dashCost));
  return costs.size < abilities.length;
}
