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
  const gyLandsHaveMatch = oracle.match(
    /as long as (?:this card|this creature) is in your graveyard,?\s*lands you control have ([^.]+)/i,
  );
  const landsHaveMatch = gyLandsHaveMatch
    || oracle.match(/lands you control have ((?:"[^"]+"(?:,? (?:and )?)?)+|[^.]+)/i);
  if (landsHaveMatch) {
    const tail = landsHaveMatch[1] || '';
    const quoted = [...tail.matchAll(/"([^"]+)"/g)].map((q) => q[1].trim()).filter(Boolean);
    const tokens = parseAbilitiesFromTail(tail.replace(/"/g, '')).filter((ability) => ability.startsWith('tap_for_'));
    // Quoted grants the tap_for_* tokens cannot express keep their text: {C}{C} amounts, "N mana of any
    // one color", spend restrictions (Resonating Lute), and non-mana abilities (Bootleggers' Stash).
    const keepQuoted = quoted.length > 0 && (tokens.length === 0
      || quoted.some((q) => /\{[wubrgc]\}\{[wubrgc]\}|mana of any one color|spend this mana/i.test(q)));
    const abilities = keepQuoted ? quoted : tokens;
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        gyLandsHaveMatch ? 'gy-lands-mana-ability-grant' : 'lands-mana-ability-grant',
        { kind: 'lands_you_control' },
        { abilities },
        gyLandsHaveMatch ? { kind: 'source_in_graveyard' } : undefined,
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
