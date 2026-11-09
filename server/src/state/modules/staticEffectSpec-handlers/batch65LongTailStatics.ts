// server/src/state/modules/staticEffectSpec-handlers/batch65LongTailStatics.ts
// B65 static long-tail:
//   Eternal Wanderer — no more than N creatures can attack ~
//   Mesa Lynx — during turns other than yours, ~ gets ±N/±N
//   Skeleton Crew — each other creature you control that's a A or B gets ±N/±N
// Public: pushBatch65LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseCardCountWord,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readCount(raw: string): number | null {
  const s = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  if (NUMBER_WORDS[s] != null) return NUMBER_WORDS[s];
  try {
    const n = parseCardCountWord(s);
    return n && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pushMaxAttackersAgainstSource(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const name = String(source.sourceName || '').toLowerCase();
  let normalized = text;
  if (name) normalized = normalized.split(name).join('~');
  const short = name.split(',')[0].trim();
  if (short && short !== name && short.length >= 3) normalized = normalized.split(short).join('~');
  const m = normalized.match(
    /no more than ([a-z]+|\d+) creatures? can attack (?:~|this (?:planeswalker|creature|permanent))(?: each combat)?/,
  );
  if (!m) return;
  const max = readCount(m[1] || '');
  if (max == null || max <= 0) return;
  specs.push(buildSpec(
    source,
    'max-attackers-against-source',
    { kind: 'self' },
    { maxAttackersAgainstSource: max } as any,
  ));
}

function pushDuringTurnsOtherThanYoursSelfPt(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const name = String(source.sourceName || '').toLowerCase();
  let normalized = text;
  if (name) normalized = normalized.split(name).join('~');
  const m = normalized.match(
    /during turns other than yours,? (?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'self-pt-not-your-turn',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'not_during_source_controller_turn' } as StaticEffectCondition,
  ));
}

function pushOtherSubtypeOrAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  // Require "other" so Brenard-style Food/Golem anthems stay on batch62 only.
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /each other creature you control that(?:'s| is) an? (.+?) gets ([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const typesRaw = String(m[1] || '');
  const parts = typesRaw
    .replace(/\ban?\b/g, ' ')
    .split(/\bor\b/)
    .map((p) => p.trim().replace(/s$/, ''))
    .filter(Boolean);
  if (parts.length < 1) return;
  const buff = parseBuffSegment(m[2] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'other-subtype-or-anthem',
    { kind: 'other_creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_has_any_subtype', subtypes: parts } as StaticEffectCondition,
  ));
}

export function pushBatch65LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushMaxAttackersAgainstSource(specs, source, oracle);
  pushDuringTurnsOtherThanYoursSelfPt(specs, source, oracle);
  pushOtherSubtypeOrAnthem(specs, source, oracle);
}
