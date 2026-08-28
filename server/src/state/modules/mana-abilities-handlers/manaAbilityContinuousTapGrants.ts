// Origin parent: server/src/state/modules/mana-abilities-handlers/manaAbilitiesForPermanent.ts
// Cluster: map continuous tap_for_* grants (Cryptolith / Riftstone Portal) onto ManaAbility rows.
// Public: manaAbilitiesFromContinuousTapGrants.

import type { ManaAbility } from './manaAbilityLandTypeModifiers.js';

const TAP_GRANT_TO_COLOR: Record<string, string> = {
  tap_for_white: 'W',
  tap_for_blue: 'U',
  tap_for_black: 'B',
  tap_for_red: 'R',
  tap_for_green: 'G',
  tap_for_colorless: 'C',
};

export function manaAbilitiesFromContinuousTapGrants(
  grantedAbilities: readonly string[],
  sourceKey: string,
): ManaAbility[] {
  const normalized = grantedAbilities
    .map((ability) => String(ability || '').trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return [];

  const hasAnyColor = normalized.some((ability) => (
    ability === 'tap_for_any_color'
    || /\{t\}(?:,[^:]*)?:\s*add\s+(?:one\s+)?mana of any(?: one)?(?: of this creature's)? color/.test(ability)
  ));
  if (hasAnyColor) {
    const hasPayLife = normalized.some((ability) => /pay 1 life/.test(ability));
    return [{
      id: `continuous_any_${sourceKey || 'grant'}`,
      cost: hasPayLife ? '{T}, Pay 1 life' : '{T}',
      produces: ['W', 'U', 'B', 'R', 'G'],
      isGranted: true,
    }];
  }

  const produces: string[] = [];
  for (const ability of normalized) {
    const color = TAP_GRANT_TO_COLOR[ability];
    if (color && !produces.includes(color)) produces.push(color);
  }
  if (produces.length === 0) return [];

  return [{
    id: produces.length === 1
      ? `continuous_${produces[0].toLowerCase()}_${sourceKey || 'grant'}`
      : `continuous_choice_${sourceKey || 'grant'}`,
    cost: '{T}',
    produces,
    producesAllAtOnce: false,
    isGranted: true,
  }];
}
