// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfCounterThreshold.ts
// R23 census tail: self grants gated on N or more counters on the source.
//   "As long as this creature has four or more +1/+1 counters on it, it has flying and vigilance." (Voice of the Blessed)
//   "As long as this creature has five or more counters on it, it has flying and is an Angel in addition to its other types." (Hero of Bretagard)
//   "This creature has trample as long as it has ten or more +1/+1 counters on it." (Primordial Hydra)
//   "This creature gets +3/+0 as long as it has three or more oil counters on it." (Armored Scrapgorger)
// B72: "or fewer" + Otherwise (Evolved Spinoderm).
// Condition: source_counter_at_least / source_counter_at_most (counterType 'any' = total of all kinds).
// Public entry symbols: pushSelfCounterThresholdSpecs.

import type { StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { splitOtherwiseClause, parseOtherwiseGrant } from './staticEffectSpecOtherwiseClause.js';

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const SELF = '(this [a-z]+|~|[^,.]+?)';
const COUNT_MORE = '(\\w+) or more (?:([a-z0-9+\\/-]+) )?counters on (?:it|him|her)';
const COUNT_FEWER = '(\\w+) or fewer (?:([a-z0-9+\\/-]+) )?counters on (?:it|him|her)';
const LEAD_MORE = new RegExp('^as long as ' + SELF + ' has ' + COUNT_MORE + ', (?:it|he|she) (.+)$');
const TRAIL_MORE = new RegExp('^' + SELF + ' ((?:has|gets) .+?) as long as (?:it|he|she) has ' + COUNT_MORE + '$');
const LEAD_FEWER = new RegExp('^as long as ' + SELF + ' has ' + COUNT_FEWER + ', (?:it|he|she) (.+)$');
const TRAIL_FEWER = new RegExp('^' + SELF + ' ((?:has|gets) .+?) as long as (?:it|he|she) has ' + COUNT_FEWER + '$');

function parseTail(tail: string): StaticEffectGrant | null {
  let rest = tail.trim();
  const grant: StaticEffectGrant = {};
  // R24: "it's an artifact creature" / "it's a Phyrexian creature in addition to its other types".
  const becomes = /^is an? ((?:[a-z]+ )*?)creature(?: in addition to its other types)?$/.exec(rest);
  if (becomes) {
    const words = becomes[1].trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
    (grant as any).typeAdditions = [...words, 'Creature'];
    return grant;
  }
  const pt = /^gets ([+-]\d+)\/([+-]\d+)(?: and (.+))?$/.exec(rest);
  if (pt) { (grant as any).power = Number(pt[1]); (grant as any).toughness = Number(pt[2]); rest = pt[3] ? pt[3].trim() : ''; }
  const typed = /^(.*?)(?:(?:^| and )is an? ([a-z]+) in addition to its other types)$/.exec(rest);
  if (typed) { (grant as any).typeAdditions = [typed[2][0].toUpperCase() + typed[2].slice(1)]; rest = typed[1].trim(); }
  if (rest) {
    const has = /^has (.+)$/.exec(rest);
    if (!has) return null;
    const abilities = parseAbilitiesFromTail(has[1]);
    if (!abilities.length) return null;
    (grant as any).abilities = abilities;
  }
  return Object.keys(grant).length ? grant : null;
}

export function pushSelfCounterThresholdSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const name = String((source as any).sourceName || '').toLowerCase();
  const short = name.split(',')[0].trim();
  const lines = String(oracle || '').replace(/[\u2019]/g, "'").split(/\n+/).map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((raw, index) => {
    const [main, otherwiseRest] = splitOtherwiseClause(raw.toLowerCase());
    const line = main.replace(/^[a-z ]+ \u2014 /, '').replace(/\.$/, '').replace(/\b(it|he|she)'s /g, '$1 is ');
    let subject = '', n = '', kind = '', tail = '';
    let atMost = false;
    const leadMore = LEAD_MORE.exec(line);
    const trailMore = leadMore ? null : TRAIL_MORE.exec(line);
    const leadFewer = (!leadMore && !trailMore) ? LEAD_FEWER.exec(line) : null;
    const trailFewer = (!leadMore && !trailMore && !leadFewer) ? TRAIL_FEWER.exec(line) : null;
    if (leadMore) { [, subject, n, kind, tail] = leadMore; }
    else if (trailMore) { [, subject, tail, n, kind] = trailMore; }
    else if (leadFewer) { [, subject, n, kind, tail] = leadFewer; atMost = true; }
    else if (trailFewer) { [, subject, tail, n, kind] = trailFewer; atMost = true; }
    else return;
    if (!/^this [a-z]+$/.test(subject) && subject !== '~' && subject !== name && subject !== short) return;
    const amount = NUM[n] ?? Number(n);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const grant = parseTail(tail);
    if (!grant) return;
    const counterType = kind || 'any';
    const condKind = atMost ? 'source_counter_at_most' : 'source_counter_at_least';
    if (specs.some((s) => String(s.sourcePermanentId) === String(source.sourcePermanentId) && (s.condition as any)?.kind === condKind
      && Number((s.condition as any)?.amount) === amount && String((s.condition as any)?.counterType) === counterType)) return;
    const condition = { kind: condKind, counterType, amount } as any;
    specs.push(buildSpec(source, 'self-counter-threshold:' + index, { kind: 'self' }, grant, condition));
    if (otherwiseRest) {
      const otherwiseGrant = parseOtherwiseGrant(otherwiseRest, 'it|he|she|this [a-z]+|~');
      if (otherwiseGrant) {
        specs.push({
          ...buildSpec(source, 'self-counter-threshold-otherwise:' + index, { kind: 'self' }, otherwiseGrant, condition),
          conditionNegated: true,
        });
      }
    }
  });
}
