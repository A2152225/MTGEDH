/**
 * Rule 701.11: Triple
 * 
 * Tripling a creature's power and/or toughness creates a continuous effect.
 * 
 * Reference: Rule 701.11
 */

export interface TripleAction {
  readonly type: 'triple';
  readonly targetType: 'power' | 'toughness' | 'power-toughness';
  readonly targetId: string;
}

/**
 * Rule 701.11a: Tripling creates a continuous effect
 * 
 * Tripling a creature's power and/or toughness creates a continuous effect.
 * This effect modifies that creature's power and/or toughness but doesn't set
 * those characteristics to a specific value.
 */
export function triplePowerToughness(
  creatureId: string,
  target: 'power' | 'toughness' | 'power-toughness'
): TripleAction {
  return {
    type: 'triple',
    targetType: target,
    targetId: creatureId,
  };
}

/**
 * Rule 701.11b: Calculating tripled power/toughness
 * 
 * To triple a creature's power, that creature gets +X/+0, where X is twice that
 * creature's power as the spell or ability that triples its power resolves.
 * Similarly for toughness.
 */
export function calculateTripledStat(currentValue: number): number {
  // Rule 701.11c: If value is negative, tripling means -X instead
  // where X is twice the difference between 0 and its value
  if (currentValue < 0) {
    return currentValue * 2; // Gets -2X/-0
  }
  return currentValue * 2; // Gets +2X/+0 (for total of 3X)
}
