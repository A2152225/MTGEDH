// server/src/state/modules/staticEffectSpec-handlers/batch63LoyaltyCdaStatics.ts
// B63: planeswalker loyalty-threshold CDAs
//   "As long as ~ has N or more loyalty counters on him, he's a 7/7 Dragon God creature with flying and indestructible."
// Public: pushLoyaltyThresholdCreatureCdaSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseLordAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const NUM: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
function num(w: string): number | undefined {
  if (/^\d+$/.test(w)) return Number(w);
  return NUM[w];
}

const LINE_RE =
  /as long as .+ has (\w+) or more loyalty counters on (?:him|her|it), (?:he(?:'s| is)|she(?:'s| is)|it(?:'s| is)) (?:an? )?(\d+)\/(\d+) ([a-z ]+?) creature with ([^.]+)/i;

export function pushLoyaltyThresholdCreatureCdaSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  let index = 0;
  for (const match of String(oracle || '').matchAll(new RegExp(LINE_RE.source, 'gi'))) {
    const amount = num(String(match[1] || '').toLowerCase());
    const power = Number(match[2]);
    const toughness = Number(match[3]);
    if (amount == null || !Number.isFinite(power) || !Number.isFinite(toughness)) continue;
    const types = String(match[4] || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    const abilities = parseLordAbilitiesFromTail(match[5] || '');
    const condition = {
      kind: 'source_counter_at_least',
      counterType: 'loyalty',
      amount,
    } as StaticEffectCondition;
    const idBase = `loyalty-cda:${index++}`;
    specs.push(buildSpec(source, `${idBase}:pt`, { kind: 'self' }, { setPower: power, setToughness: toughness }, condition));
    if (types.length) {
      specs.push({
        ...buildSpec(source, `${idBase}:type`, { kind: 'self' }, {
          typeAdditions: ['Creature', ...types],
        }, condition),
        layer: 4,
      });
    }
    if (abilities.length) {
      specs.push(buildSpec(source, `${idBase}:kw`, { kind: 'self' }, { abilities }, condition));
    }
  }
}
