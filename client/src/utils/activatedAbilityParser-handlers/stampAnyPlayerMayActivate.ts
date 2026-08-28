/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 * Cluster: stamp "Any player may activate this ability" on parsed abilities.
 * Public: stampAnyPlayerMayActivate
 */

import { abilityAllowsAnyPlayerActivation } from '../../../../shared/src/anyPlayerActivatedAbility';
import type { ParsedActivatedAbility } from './activatedAbilityParserTypes';

export function stampAnyPlayerMayActivate(
  abilities: ParsedActivatedAbility[],
  oracleText?: string | null,
): ParsedActivatedAbility[] {
  const oracle = String(oracleText || '');
  return abilities.map((ability) => {
    if (ability.anyPlayerMayActivate) return ability;
    const scoped = `${ability.cost || ''}: ${ability.effect || ''} ${ability.description || ''}`;
    if (!abilityAllowsAnyPlayerActivation({
      scopedAbilityText: scoped,
      cardOracleText: oracle,
    })) {
      return ability;
    }
    return { ...ability, anyPlayerMayActivate: true };
  });
}
