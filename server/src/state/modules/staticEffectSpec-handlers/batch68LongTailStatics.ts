// server/src/state/modules/staticEffectSpec-handlers/batch68LongTailStatics.ts
// B68 static long-tail:
//   Sardian Cliffstomper — as long as it's your turn and you control N+ Mountains, +X/+0 (X = Mountains)
//   Earnest Fellowship — each creature has protection from its colors
//   Sludge Monster — non-Horror creatures with slime counters: lose all abilities + base P/T
// Public: pushBatch68LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
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

function pushSardianStyleMountainPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /as long as it(?:'s| is) your turn and you control (\d+|[a-z]+) or more mountains?,?\s*(?:this creature|~) gets \+x\/([+-]?\d+),?\s*where x is the number of mountains? you control/,
  );
  if (!m) return;
  const min = readCount(m[1] || '');
  const toughness = Number(m[2] || 0);
  if (min == null || min <= 0 || !Number.isFinite(toughness)) return;
  const spec = buildSpec(
    source,
    'your-turn-mountains-where-x-pump',
    { kind: 'self' },
    {
      power: 1,
      toughness,
      countBasis: 'controller_lands_of_subtype',
      countCardType: 'mountain',
    } as any,
  );
  spec.conditions = [
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
    { kind: 'source_controller_controls_matching', cardType: 'mountain', count: min } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushProtectionFromOwnColors(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Earnest Fellowship (both printings): "protection from its colors" / "protection from each of its colors"
  if (!/each creature has protection from (?:each of )?its colors\.?/.test(text)) return;
  specs.push(buildSpec(
    source,
    'protection-from-own-colors',
    { kind: 'all_creatures' },
    { protectionFromOwnColors: true } as any,
  ));
}

function pushSlimeCounterHorrorBasePt(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /non-?horror creatures with slime counters on them lose all abilities and have base power and toughness (\d+)\s*\/\s*(\d+)/,
  );
  if (!m) return;
  const setPower = Number(m[1]);
  const setToughness = Number(m[2]);
  if (!Number.isFinite(setPower) || !Number.isFinite(setToughness)) return;
  const spec = buildSpec(
    source,
    'non-horror-slime-base-pt',
    { kind: 'all_creatures' },
    { setPower, setToughness },
  );
  spec.conditions = [
    { kind: 'target_lacks_creature_type', creatureType: 'horror' } as StaticEffectCondition,
    { kind: 'target_has_counter', counterType: 'slime' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

export function pushBatch68LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushSardianStyleMountainPump(specs, source, oracle);
  pushProtectionFromOwnColors(specs, source, oracle);
  pushSlimeCounterHorrorBasePt(specs, source, oracle);
}
