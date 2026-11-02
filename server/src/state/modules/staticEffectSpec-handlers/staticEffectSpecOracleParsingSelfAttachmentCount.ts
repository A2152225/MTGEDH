// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfAttachmentCount.ts
// R24 census tail: self statics gated on how many Auras / Equipment are attached to the source.
//   "As long as this creature is enchanted by exactly one Aura, it has base power and toughness 3/3." (Timber Paladin)
//   "As long as this creature is enchanted by three or more Auras, it has base power and toughness 10/10, vigilance, and trample."
//   "As long as ~ is equipped by two or more Equipment, it gets +2/+2." (generic form)
// Condition: source_attachment_count (cardType aura|equipment, amount, exact).
// Public entry symbols: pushSelfAttachmentCountSpecs.

import type { StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const LINE = /^as long as (this [a-z]+|~|[^,.]+?) is (enchanted|equipped) by (exactly )?(\w+)( or more)? (auras?|equipment), (?:it|he|she) (.+)$/;

function parseTail(tail: string): StaticEffectGrant | null {
  let rest = tail.trim();
  const grant: StaticEffectGrant = {};
  const base = /^has base power and toughness (\d+)\/(\d+)(?:,? (?:and )?(.+))?$/.exec(rest);
  if (base) { grant.setPower = Number(base[1]); grant.setToughness = Number(base[2]); rest = base[3] ? 'has ' + base[3].trim() : ''; }
  const pt = !base && /^gets ([+-]\d+)\/([+-]\d+)(?: and (.+))?$/.exec(rest);
  if (pt) { grant.power = Number(pt[1]); grant.toughness = Number(pt[2]); rest = pt[3] ? pt[3].trim() : ''; }
  if (rest) {
    const has = /^has (.+)$/.exec(rest);
    if (!has) return null;
    const abilities = parseAbilitiesFromTail(has[1]);
    if (!abilities.length) return null;
    grant.abilities = abilities;
  }
  return Object.keys(grant).length ? grant : null;
}

export function pushSelfAttachmentCountSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const name = String((source as any).sourceName || '').toLowerCase();
  const short = name.split(',')[0].trim();
  const lines = String(oracle || '').replace(/[\u2019]/g, "'").split(/\n+/).map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((raw, index) => {
    const m = LINE.exec(raw.toLowerCase().replace(/\.$/, ''));
    if (!m) return;
    const [, subject, verb, exactly, n, orMore, kind, tail] = m;
    if (!/^this [a-z]+$/.test(subject) && subject !== '~' && subject !== name && subject !== short) return;
    if ((verb === 'enchanted') !== kind.startsWith('aura')) return;
    if (!!exactly === !!orMore) return;
    const amount = NUM[n] ?? Number(n);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const grant = parseTail(tail);
    if (!grant) return;
    const cardType = kind.startsWith('aura') ? 'aura' : 'equipment';
    specs.push(buildSpec(source, 'self-attachment-count:' + index, { kind: 'self' }, grant, { kind: 'source_attachment_count', cardType, amount, exact: !!exactly } as any));
  });
}
