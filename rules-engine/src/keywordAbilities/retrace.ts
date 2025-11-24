/**
 * Retrace keyword ability (Rule 702.81)
 * @module keywordAbilities/retrace
 */

/**
 * Retrace ability (Rule 702.81)
 * Static ability allowing casting from graveyard
 */
export interface RetraceAbility {
  readonly type: 'retrace';
  readonly source: string;
  readonly discardedLand?: string;
}

/**
 * Create a retrace ability
 * Rule 702.81a: "Retrace" means "You may cast this card from your graveyard
 * by discarding a land card as an additional cost to cast it."
 */
export function retrace(source: string): RetraceAbility {
  return {
    type: 'retrace',
    source
  };
}

/**
 * Cast spell with retrace by discarding a land
 */
export function castWithRetrace(ability: RetraceAbility, landCard: string): RetraceAbility {
  return {
    ...ability,
    discardedLand: landCard
  };
}

/**
 * Check if retrace can be used
 * Card must be in graveyard
 */
export function canUseRetrace(ability: RetraceAbility, zone: string): boolean {
  return zone === 'graveyard';
}

/**
 * Check if two retrace abilities are redundant
 * Multiple instances are redundant
 */
export function areRetraceAbilitiesRedundant(a: RetraceAbility, b: RetraceAbility): boolean {
  return true;
}
