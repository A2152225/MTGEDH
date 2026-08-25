// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingManaAbilityGrants.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: tap-for-mana ability grants (Cryptolith Rite / Elven Chorus / Chromatic Lantern).
// Public entry symbols: pushManaAbilityGrantSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';
import { oracleHasGraveyardLandKeywordGrant } from './staticEffectSpecOracleParsingGraveyardLandKeywords.js';

function grantHasManaAbility(abilities: readonly string[]): boolean {
  return abilities.some((ability) => ability.startsWith('tap_for_'));
}

/**
 * Lands / creatures granted "{T}: Add one mana of any color" or "{T}: Add {G}".
 * Creature grants also flow through the existing "creatures you control have" path
 * once parseAbilitiesFromTail recognizes tap-for-mana tails.
 */
export function pushManaAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const landsHaveMatch = oracle.match(/lands you control have ([^.]+)/i);
  if (landsHaveMatch) {
    const abilities = parseAbilitiesFromTail(landsHaveMatch[1] || '');
    if (grantHasManaAbility(abilities)) {
      specs.push(buildSpec(
        source,
        'lands-mana-ability-grant',
        { kind: 'lands_you_control' },
        { abilities: abilities.filter((ability) => ability.startsWith('tap_for_')) },
      ));
    }
  }

  // Already covered by pushAbilityGrantSpecs when the tail includes tap-for-mana text.
  // Keep an explicit fallback if the generic "have" path missed quoted mana text.
  const alreadyGrantedCreatures = specs.some((spec) => (
    spec.sourcePermanentId === source.sourcePermanentId
    && spec.scope.kind === 'creatures_you_control'
    && !spec.scope.creatureType
    && Array.isArray(spec.grant.abilities)
    && grantHasManaAbility(spec.grant.abilities)
  ));
  if (alreadyGrantedCreatures) return;

  const creaturesHaveMatch = oracle.match(
    /(?<![a-z] )(?<!legendary )(?:all )?creatures you control have ([^.]+)/i,
  );
  if (!creaturesHaveMatch) return;
  if (/other creatures you control have/i.test(oracle)) return;
  if (oracleHasGraveyardLandKeywordGrant(oracle)) return;

  const abilities = parseAbilitiesFromTail(creaturesHaveMatch[1] || '');
  if (!grantHasManaAbility(abilities)) return;

  specs.push(buildSpec(
    source,
    'creatures-mana-ability-grant',
    { kind: 'creatures_you_control' },
    { abilities: abilities.filter((ability) => ability.startsWith('tap_for_')) },
  ));
}
