// server/src/state/modules/staticEffectSpec-handlers/batch90LongTailStatics.ts
// B90 static long-tail:
//   Gornog — attacking TYPEs you control get ±X/±N, where X is the number of
//     TYPEs your opponents control
//   Hancock — each other creature you control that's a TYPE or TYPE gets ±X/±X,
//     where X is the number of counters on ~
// Public: pushBatch90LongTailStaticSpecs.
// Umbris / Greven / Tangleweave are countedPT + new count bases, not this file.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';

function capType(raw: string): string {
  const parsed = parseLordCreatureType(raw) || String(raw || '').trim();
  if (!parsed) return '';
  return parsed.charAt(0).toUpperCase() + parsed.slice(1);
}

function pushAttackingTypeWhereX(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /attacking ([a-z][a-z'-]*)s you control get ([+-])x\/([+-])(x|0),? where x is the number of ([a-z][a-z'-]*)s your opponents control/,
  );
  if (!m) return;
  const targetType = capType(m[1] || '');
  const countType = capType(m[5] || '');
  if (!targetType || !isCreatureTypeWord(targetType) || !countType || !isCreatureTypeWord(countType)) return;
  const grant = {
    power: m[2] === '-' ? -1 : 1,
    toughness: m[4] === '0' ? 0 : (m[3] === '-' ? -1 : 1),
    countBasis: 'controller_permanents_of_type' as const,
    countCardType: countType.toLowerCase(),
    countWho: 'opponents' as const,
  };
  specs.push(buildSpec(
    source,
    `attacking-type-where-x:${targetType.toLowerCase()}`,
    { kind: 'creatures_you_control', creatureType: targetType },
    grant,
    { kind: 'target_is_attacking' } as StaticEffectCondition,
  ));
}

function pushOtherTypedCreaturesWhereXCounters(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each other creatures? you control that(?:'s| is| are) (?:a |an )?([a-z][a-z'-]*(?: or [a-z][a-z'-]*)*) gets? ([+-])x\/([+-])x,? where x is the number of counters? on (?:~|this creature|it)/,
  );
  if (!m) return;
  const types = String(m[1] || '')
    .split(/\s+or\s+/)
    .map((w) => capType(w))
    .filter((t) => t && isCreatureTypeWord(t));
  if (types.length === 0) return;
  const grant = {
    power: m[2] === '-' ? -1 : 1,
    toughness: m[3] === '-' ? -1 : 1,
    countBasis: 'source_counters' as const,
    countCounterType: '',
  };
  specs.push(buildSpec(
    source,
    `other-typed-where-x-counters:${types.map((t) => t.toLowerCase()).join('+')}`,
    { kind: 'other_creatures_you_control' },
    grant,
    { kind: 'target_has_any_creature_type', creatureType: types.join('|') } as StaticEffectCondition,
  ));
}

function rewriteSourceName(oracle: string, perm: BattlefieldPermanent): string {
  const name = String((perm as any)?.card?.name || '').toLowerCase();
  const shortName = name.split(',')[0].trim();
  let text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (name) text = text.split(name).join('~');
  if (shortName && shortName !== name) text = text.split(shortName).join('~');
  return text;
}

export function pushBatch90LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = rewriteSourceName(oracle, perm);
  pushAttackingTypeWhereX(specs, source, text);
  pushOtherTypedCreaturesWhereXCounters(specs, source, text);
}
