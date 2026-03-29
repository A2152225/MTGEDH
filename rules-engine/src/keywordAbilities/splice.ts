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

export interface SplicedSpellResult {
  readonly spellId: string;
  readonly spliceSources: readonly string[];
  readonly combinedRulesText: string;
  readonly additionalCost: string;
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

export function canSpliceOnto(
  ability: SpliceAbility,
  spellSubtypes: readonly string[]
): boolean {
  return spellSubtypes.includes(ability.spliceOnto);
}

export function getSpliceAdditionalCost(
  abilities: readonly SpliceAbility[]
): string {
  const paidCosts = abilities
    .filter(ability => ability.wasSpliced)
    .map(ability => ability.cost);

  return paidCosts.length > 0 ? paidCosts.join(' + ') : '0';
}

export function createSplicedSpell(
  spellId: string,
  baseRulesText: string,
  splicePayloads: readonly { ability: SpliceAbility; rulesText: string }[]
): SplicedSpellResult {
  const activePayloads = splicePayloads.filter(payload => payload.ability.wasSpliced);
  const combinedText = [
    baseRulesText,
    ...activePayloads.map(payload => payload.rulesText),
  ].join('\n');

  return {
    spellId,
    spliceSources: activePayloads.map(payload => payload.ability.source),
    combinedRulesText: combinedText,
    additionalCost: getSpliceAdditionalCost(activePayloads.map(payload => payload.ability)),
  };
}
