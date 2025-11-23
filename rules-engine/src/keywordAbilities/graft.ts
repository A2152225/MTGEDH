/**
 * Graft keyword ability (Rule 702.58)
 * 
 * @module keywordAbilities/graft
 */

/**
 * Represents a graft ability on a permanent.
 * Rule 702.58: Graft represents both a static ability and a triggered ability. 
 * "Graft N" means "This permanent enters the battlefield with N +1/+1 counters on it" 
 * and "Whenever another creature enters the battlefield, if this permanent has a +1/+1 
 * counter on it, you may move a +1/+1 counter from this permanent onto that creature."
 */
export interface GraftAbility {
  readonly type: 'graft';
  readonly count: number;
  readonly source: string;
  readonly countersRemaining: number;
}

/**
 * Creates a graft ability.
 * 
 * @param source - The source permanent with graft
 * @param count - Number of +1/+1 counters (graft N)
 * @returns A graft ability
 * 
 * @example
 * ```typescript
 * const ability = graft('Cytoplast Root-Kin', 4);
 * ```
 */
export function graft(source: string, count: number): GraftAbility {
  return {
    type: 'graft',
    count,
    source,
    countersRemaining: count
  };
}

/**
 * Moves a +1/+1 counter from graft source to target.
 * 
 * @param ability - The graft ability
 * @returns Updated ability with one less counter
 */
export function moveGraftCounter(ability: GraftAbility): GraftAbility {
  if (ability.countersRemaining <= 0) {
    return ability;
  }
  
  return {
    ...ability,
    countersRemaining: ability.countersRemaining - 1
  };
}

/**
 * Checks if graft can move a counter.
 * 
 * @param ability - The graft ability
 * @returns True if has counters remaining
 */
export function canGraft(ability: GraftAbility): boolean {
  return ability.countersRemaining > 0;
}
