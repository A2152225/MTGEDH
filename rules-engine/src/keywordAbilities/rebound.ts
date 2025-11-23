/**
 * Rebound keyword ability (Rule 702.88)
 * @module keywordAbilities/rebound
 */

/**
 * Rebound ability (Rule 702.88)
 * Static ability that exiles spell and casts it next turn
 */
export interface ReboundAbility {
  readonly type: 'rebound';
  readonly source: string;
  readonly wasCastFromHand: boolean;
  readonly exiled: boolean;
}

/**
 * Create a rebound ability
 * Rule 702.88a: "Rebound" means "If this spell was cast from your hand, instead
 * of putting it into your graveyard as it resolves, exile it and, at the beginning
 * of your next upkeep, you may cast this card from exile without paying its mana cost."
 */
export function rebound(source: string, wasCastFromHand: boolean): ReboundAbility {
  return {
    type: 'rebound',
    source,
    wasCastFromHand,
    exiled: false
  };
}

/**
 * Exile spell for rebound
 */
export function exileForRebound(ability: ReboundAbility): ReboundAbility {
  if (!ability.wasCastFromHand) {
    return ability;
  }
  return {
    ...ability,
    exiled: true
  };
}

/**
 * Check if rebound triggers
 */
export function shouldReboundTrigger(ability: ReboundAbility): boolean {
  return ability.wasCastFromHand && ability.exiled;
}

/**
 * Check if two rebound abilities are redundant
 * Rule 702.88c: Multiple instances are redundant
 */
export function areReboundAbilitiesRedundant(a: ReboundAbility, b: ReboundAbility): boolean {
  return true;
}
