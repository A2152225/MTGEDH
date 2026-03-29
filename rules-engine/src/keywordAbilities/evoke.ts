/**
 * Evoke keyword ability (Rule 702.74)
 * @module keywordAbilities/evoke
 */

/**
 * Evoke ability (Rule 702.74)
 * Represents two abilities: a static ability allowing casting by paying evoke cost,
 * and a triggered ability that sacrifices the permanent on entry if evoke was paid.
 */
export interface EvokeAbility {
  readonly type: 'evoke';
  readonly source: string;
  readonly cost: string;
  readonly wasPaid: boolean;
}

/**
 * Create an evoke ability
 * Rule 702.74a: "Evoke [cost]" means "You may cast this card by paying [cost]
 * rather than paying its mana cost" and "When this permanent enters, if its
 * evoke cost was paid, its controller sacrifices it."
 */
export function evoke(source: string, cost: string): EvokeAbility {
  return {
    type: 'evoke',
    source,
    cost,
    wasPaid: false
  };
}

/**
 * Mark evoke cost as paid
 */
export function payEvoke(ability: EvokeAbility): EvokeAbility {
  return {
    ...ability,
    wasPaid: true
  };
}

/**
 * Check if evoke cost was paid
 */
export function wasEvoked(ability: EvokeAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check whether a spell can be cast for its evoke cost.
 * Evoke is an alternative cost used while casting from hand.
 *
 * @param ability - The evoke ability
 * @param zone - The card's current zone
 * @returns True if the card can be cast for its evoke cost
 */
export function canCastWithEvoke(ability: EvokeAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Get the evoke sacrifice trigger
 * Triggers when permanent enters if evoke cost was paid
 */
export function getEvokeSacrificeTrigger(ability: EvokeAbility): boolean {
  return ability.wasPaid;
}

/**
 * Creates the cast result for a spell cast via evoke.
 *
 * @param ability - The evoke ability
 * @param zone - The card's current zone
 * @returns Cast summary, or null if evoke cannot be used
 */
export function createEvokeCastResult(
  ability: EvokeAbility,
  zone: string
): {
  source: string;
  fromZone: 'hand';
  alternativeCostPaid: string;
  usedEvoke: true;
} | null {
  if (!canCastWithEvoke(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    alternativeCostPaid: ability.cost,
    usedEvoke: true,
  };
}

/**
 * Creates the ETB sacrifice result for an evoked permanent.
 *
 * @param ability - The evoke ability
 * @returns Sacrifice summary, or null if the evoke cost was not paid
 */
export function createEvokeSacrificeResult(
  ability: EvokeAbility
): {
  source: string;
  shouldSacrifice: true;
} | null {
  if (!getEvokeSacrificeTrigger(ability)) {
    return null;
  }

  return {
    source: ability.source,
    shouldSacrifice: true,
  };
}

/**
 * Check if two evoke abilities are redundant
 * Multiple instances with different costs are not redundant
 */
export function areEvokeAbilitiesRedundant(a: EvokeAbility, b: EvokeAbility): boolean {
  return a.cost === b.cost;
}
