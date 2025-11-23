/**
 * Unearth keyword ability (Rule 702.84)
 * @module keywordAbilities/unearth
 */

/**
 * Unearth ability (Rule 702.84)
 * Activated ability that functions from graveyard
 */
export interface UnearthAbility {
  readonly type: 'unearth';
  readonly source: string;
  readonly cost: string;
  readonly wasUnearthed: boolean;
}

/**
 * Create an unearth ability
 * Rule 702.84a: "Unearth [cost]" means "[Cost]: Return this card from your
 * graveyard to the battlefield. It gains haste. Exile it at the beginning of
 * the next end step. If it would leave the battlefield, exile it instead of
 * putting it anywhere else. Activate only as a sorcery."
 */
export function unearth(source: string, cost: string): UnearthAbility {
  return {
    type: 'unearth',
    source,
    cost,
    wasUnearthed: false
  };
}

/**
 * Activate unearth ability
 */
export function activateUnearth(ability: UnearthAbility): UnearthAbility {
  return {
    ...ability,
    wasUnearthed: true
  };
}

/**
 * Check if unearth can be activated
 * Can only be activated from graveyard at sorcery speed
 */
export function canActivateUnearth(ability: UnearthAbility, zone: string): boolean {
  return zone === 'graveyard' && !ability.wasUnearthed;
}

/**
 * Check if permanent was unearthed
 */
export function wasUnearthed(ability: UnearthAbility): boolean {
  return ability.wasUnearthed;
}

/**
 * Check if two unearth abilities are redundant
 * Multiple instances with same cost are redundant
 */
export function areUnearthAbilitiesRedundant(a: UnearthAbility, b: UnearthAbility): boolean {
  return a.cost === b.cost;
}
