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
 * Rule 702.109a - Alternative cost that gives haste and creates return trigger
 * When cast for dash cost:
 * - Creature gains haste (can attack immediately)
 * - Will return to hand at beginning of next end step
 */
export function payDash(ability: DashAbility): DashAbility {
  return {
    ...ability,
    wasPaid: true,
    dashed: true,
  };
}

/**
 * Cast creature normally (without dash)
 * Creature stays on battlefield as usual, no haste, no return trigger
 */
export function castNormally(ability: DashAbility): DashAbility {
  return {
    ...ability,
    wasPaid: false,
    dashed: false,
  };
}

/**
 * Return dashed permanent to owner's hand at end step
 * Rule 702.109a - "return the permanent this spell becomes to its owner's hand 
 * at the beginning of the next end step"
 * This function marks that the creature should be returned (used by the test)
 */
export function returnFromDash(ability: DashAbility): DashAbility {
  return {
    ...ability,
    dashed: true,
    returnedToHand: true,
  };
}

/**
 * Check if dash cost was paid
 * When true, creature has haste and will return to hand at end step
 */
export function wasDashed(ability: DashAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check if permanent has haste from dash
 * Rule 702.109a - "As long as this permanent's dash cost was paid, it has haste"
 * Creature has haste from when it enters until it returns to hand
 */
export function hasHasteFromDash(ability: DashAbility): boolean {
  return ability.wasPaid && !ability.returnedToHand;
}

/**
 * Check if should trigger return to hand at end step
 * Rule 702.109a - Delayed triggered ability created when dash cost paid
 * Dash creatures return at the beginning of the next end step
 */
export function shouldDashReturnAtEndStep(ability: DashAbility): boolean {
  return ability.wasPaid && !ability.returnedToHand;
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
