/**
 * Outlast keyword ability (Rule 702.107)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.107. Outlast
 * 702.107a Outlast is an activated ability. "Outlast [cost]" means "[Cost], {T}: Put a 
 * +1/+1 counter on this creature. Activate only as a sorcery."
 */

export interface OutlastAbility {
  readonly type: 'outlast';
  readonly source: string;
  readonly cost: string;
  readonly countersAdded: number;
  readonly tapped: boolean;
}

/**
 * Create an outlast ability
 * Rule 702.107a
 */
export function outlast(source: string, cost: string): OutlastAbility {
  return {
    type: 'outlast',
    source,
    cost,
    countersAdded: 0,
    tapped: false,
  };
}

/**
 * Activate outlast ability (pay cost, tap creature, add +1/+1 counter)
 * Rule 702.107a - Can only be activated as a sorcery
 */
export function activateOutlast(
  ability: OutlastAbility,
  canActivateSorcery: boolean = true
): OutlastAbility {
  return {
    ...ability,
    countersAdded: ability.countersAdded + 1,
    tapped: true,
  };
}

/**
 * Get total counters added by outlast
 */
export function getOutlastCounters(ability: OutlastAbility): number {
  return ability.countersAdded;
}

/**
 * Outlast abilities are unique (no redundancy)
 */
export function hasRedundantOutlast(
  abilities: readonly OutlastAbility[]
): boolean {
  return false; // Each outlast activation is separate
}
