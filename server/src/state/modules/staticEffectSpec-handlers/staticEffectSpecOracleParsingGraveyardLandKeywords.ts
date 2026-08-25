// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingGraveyardLandKeywords.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: graveyard + basic-land-type keyword grants (Anger / Wonder / Brawn / Filth / Valor).
// Public entry symbols: oracleHasGraveyardLandKeywordGrant, pushGraveyardLandKeywordGrantSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;

const GY_LAND_KEYWORD_GRANT_RE =
  /as long as (?:this card|this creature|[^.]+?) is in your graveyard and you control an? (plains|island|swamp|mountain|forest), creatures you control have ([^.]+)/i;

export function oracleHasGraveyardLandKeywordGrant(oracle: string): boolean {
  return GY_LAND_KEYWORD_GRANT_RE.test(String(oracle || ''));
}

/**
 * "As long as this card is in your graveyard and you control a Mountain,
 * creatures you control have haste."
 */
export function pushGraveyardLandKeywordGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const match = oracle.match(GY_LAND_KEYWORD_GRANT_RE);
  if (!match) return;

  const landType = String(match[1] || '').trim().toLowerCase();
  if (!BASIC_LAND_TYPES.includes(landType as (typeof BASIC_LAND_TYPES)[number])) return;

  const abilities = parseAbilitiesFromTail(match[2] || '');
  if (abilities.length === 0) return;

  specs.push(buildSpec(
    source,
    `gy-${landType}-keyword-grant`,
    { kind: 'creatures_you_control' },
    { abilities },
    { kind: 'source_in_graveyard_and_control_land_type', landType },
  ));
}
