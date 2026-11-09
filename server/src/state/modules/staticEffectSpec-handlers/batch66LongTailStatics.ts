// server/src/state/modules/staticEffectSpec-handlers/batch66LongTailStatics.ts
// B66 static long-tail:
//   Delney — creatures you control with power N or less can't be blocked by creatures with power M or greater
//   Rabblemaster — other TYPE creatures you control attack each combat if able
// Public: pushBatch66LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readAmount(raw: string): number | null {
  const s = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  return NUMBER_WORDS[s] ?? null;
}

function pushDelneyStyleBlockEvasion(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /creatures you control with power (\d+|[a-z]+) or less can(?:'t|not) be blocked by creatures with power (\d+|[a-z]+) or greater/,
  );
  if (!m) return;
  const atMost = readAmount(m[1] || '');
  const blockerAtLeast = readAmount(m[2] || '');
  if (atMost == null || blockerAtLeast == null) return;
  specs.push(buildSpec(
    source,
    'power-at-most-block-evasion',
    { kind: 'creatures_you_control' },
    { abilities: [`can't be blocked by creatures with power ${blockerAtLeast} or greater`] },
    { kind: 'target_power_at_most', power: atMost } as StaticEffectCondition,
  ));
}

function pushOtherTypeMustAttack(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /other ([a-z][a-z'-]*) creatures? you control attack(?:s)? each combat if able/,
  );
  if (!m) return;
  const creatureType = parseLordCreatureType(m[1] || '');
  if (!creatureType) return;
  specs.push(buildSpec(
    source,
    'other-type-must-attack',
    { kind: 'other_creatures_you_control' },
    { abilities: ['attacks each combat if able'] },
    { kind: 'target_has_creature_type', creatureType } as StaticEffectCondition,
  ));
}

export function pushBatch66LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushDelneyStyleBlockEvasion(specs, source, oracle);
  pushOtherTypeMustAttack(specs, source, oracle);
}
