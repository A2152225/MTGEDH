// server/src/state/modules/staticEffectSpec-handlers/batch69LongTailStatics.ts
// B69 static long-tail:
//   Ichorplate Golem — creatures you control with oil counters get +N/+N
//   Planar Nexus — self is every nonbasic land type
//   Varchild — Survivors your opponents control can't block / can't attack you
//   (Kavu Runner / Camel / Windwright / Blood Baron ride conditionalSelfGrants + opponent-state conditions)
// Public: pushBatch69LongTailStaticSpecs.

import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

/** CR 205.3i nonbasic land types (basics excluded). */
const NONBASIC_LAND_TYPES = [
  'Cave',
  'Desert',
  'Gate',
  'Lair',
  'Locus',
  'Mine',
  'Planet',
  'Power-Plant',
  'Sphere',
  'Tower',
  'Town',
  "Urza's",
] as const;

function pushOilCounterAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*(other\s+)?creatures you control with oil counters on them get\s+(\+\d+\s*\/\s*\+\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  if (!buff) return;
  const isOther = Boolean(m[1]);
  specs.push(buildSpec(
    source,
    `${isOther ? 'other-' : ''}oil-counter-anthem`,
    { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control', qualifier: { counter: 'oil' } } as any,
    { power: buff.power, toughness: buff.toughness },
  ));
}

function pushEveryNonbasicLandTypeSelf(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:^|[.\n;])\s*(?:this land|~) is every nonbasic land type\b/.test(text)) return;
  const id = 'every-nonbasic-land-type';
  if (specs.some((s) => s.id.endsWith(id))) return;
  specs.push({
    ...buildSpec(
      source,
      id,
      { kind: 'self' },
      { typeAdditions: [...NONBASIC_LAND_TYPES] },
    ),
    layer: 4,
  });
}

/**
 * Varchild, Betrayer of Kjeldor:
 * "Survivors your opponents control can't block, and they can't attack you or planeswalkers you control."
 */
function pushOpponentTypeCantBlockOrAttackYou(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    const m = line.match(
      /^([a-z][a-z'-]*)s? your opponents control can't block,? and they can't attack you(?: or planeswalkers? you control)?$/,
    );
    if (!m) continue;
    const creatureType = parseLordCreatureType(m[1]);
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    const scope = { kind: 'opponent_creatures_of_type' as const, creatureType };
    const idBase = `opp-type-cant-block-attack-you:${creatureType.toLowerCase()}:${index}`;
    if (!specs.some((s) => s.id.endsWith(`${idBase}:block`))) {
      specs.push(buildSpec(source, `${idBase}:block`, scope, { abilities: ["can't block"] }));
    }
    if (!specs.some((s) => s.id.endsWith(`${idBase}:attack-you`))) {
      specs.push(buildSpec(source, `${idBase}:attack-you`, scope, { attackYouProhibited: true }));
    }
  }
}

export function pushBatch69LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushOilCounterAnthem(specs, source, oracle);
  pushEveryNonbasicLandTypeSelf(specs, source, oracle);
  pushOpponentTypeCantBlockOrAttackYou(specs, source, oracle);
}
