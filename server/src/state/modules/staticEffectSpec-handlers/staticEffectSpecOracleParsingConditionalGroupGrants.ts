// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalGroupGrants.ts
// "As long as <player-state condition>, <group> gets/has ..." (R26 census tail):
//   "As long as you control exactly one creature, that creature gets +2/+0 and has deathtouch and lifelink." (Deadly Wanderings)
//   "Corrupted — As long as an opponent has three or more poison counters, creatures you control with toxic have lifelink." (Skrelv's Hive)
// Conditions come from parseOpponentStateCondition. Public entry symbols: pushConditionalGroupGrantSpecs.

import type { StaticEffectCondition, StaticEffectGrant, StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseOpponentStateCondition } from '../staticEffectSpecOpponentStateConditions.js';

const RE = /^as long as (.+?), (that creature|creatures you control(?: with ([a-z]+))?|other creatures you control) (?:gets ([+-]\d+)\/([+-]\d+)(?: and (?:has|have) ([a-z ,]+))?|(?:has|have) ([a-z ,]+))$/;

export function pushConditionalGroupGrantSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/).forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '').replace(/^[a-z' ]+ \u2014 /, '');
    const m = line.match(RE);
    if (!m) return;
    const condition = parseOpponentStateCondition(m[1]) as StaticEffectCondition | null;
    if (!condition) return;
    const grant: StaticEffectGrant = {};
    if (m[4] !== undefined) { grant.power = Number(m[4]); grant.toughness = Number(m[5]); }
    const tail = m[6] || m[7];
    if (tail) { const abilities = parseAbilitiesFromTail(tail); if (!abilities.length) return; grant.abilities = abilities; }
    // "that creature" names the single creature counted by the condition, i.e. every creature you control while it holds.
    const scope: StaticEffectScope = { kind: m[2].startsWith('other') ? 'other_creatures_you_control' : 'creatures_you_control', ...(m[3] ? { qualifier: { keyword: m[3] } } : {}) };
    specs.push(buildSpec(source, `conditional-group-grant:${index}`, scope, grant, condition));
  });
}
