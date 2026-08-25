// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingTapUntapAbilityGrants.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: tapped / untapped creature keyword grants (Saryth, the Viper's Fang).
// Public entry symbols: pushTapUntapAbilityGrantSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const TAP_UNTAP_ABILITY_GRANT_RE =
  /(other\s+)?(un)?tapped creatures you control have ([^.]+)/gi;

/**
 * "Other tapped creatures you control have deathtouch."
 * "Other untapped creatures you control have hexproof."
 * Also matches the same templates without "other".
 */
export function pushTapUntapAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const matches = String(oracle || '').matchAll(TAP_UNTAP_ABILITY_GRANT_RE);
  for (const match of matches) {
    const isOther = Boolean(match[1]);
    const isUntapped = Boolean(match[2]);
    const abilities = parseAbilitiesFromTail(match[3] || '');
    if (abilities.length === 0) continue;

    const tapState = isUntapped ? 'untapped' : 'tapped';
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${tapState}-creatures-ability-grant`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
      { abilities },
      { kind: isUntapped ? 'target_is_untapped' : 'target_is_tapped' },
    ));
  }
}
