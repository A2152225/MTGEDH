/**
 * Splice keyword ability implementation (Rule 702.47)
 * @see MagicCompRules 702.47
 */

export interface SpliceAbility {
  readonly type: 'splice';
  readonly spliceOnto: string;
  readonly cost: string;
  readonly source: string;
  readonly wasSpliced: boolean;
}

export function splice(source: string, spliceOnto: string, cost: string): SpliceAbility {
  return { type: 'splice', spliceOnto, cost, source, wasSpliced: false };
}

export function paySplice(ability: SpliceAbility): SpliceAbility {
  return { ...ability, wasSpliced: true };
}

export function wasSpliced(ability: SpliceAbility): boolean {
  return ability.wasSpliced;
}
