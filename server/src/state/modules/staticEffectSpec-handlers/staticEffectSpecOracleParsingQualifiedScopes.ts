// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedScopes.ts
// Census families with a qualified recipient group (whole static lines):
//   "All Sliver creatures get +1/+0." (Muscle Sliver)                -> all_creatures_of_type
//   "Creature tokens get -1/-1." (Illness in the Ranks)               -> token qualifier
//   ("[non]token creatures / creature tokens YOU CONTROL" are already handled by the existing
//   controller-token paths -- Always Watching, Caretaker's Talent -- so they are not matched here.)
//   "Creatures [you control] with flying get -1/-0." (Gravitational Shift) -> keyword qualifier
//   "Each creature you control with a +1/+1 counter on it has trample." (Zegana) -> counter qualifier
//   "Creatures you control with +1/+1 counters on them get/have ..."
// Public entry symbols: pushQualifiedScopeSpecs.

import type { StaticEffectGrant, StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const PT = '([+-]\\d+)\\/([+-]\\d+)';
const TAIL = `(?:get ${PT}(?: and (?:have|has) ([^."]+))?|(?:have|has) ([^."]+))`;

function grantFrom(m: RegExpMatchArray, at: number): StaticEffectGrant | null {
  const grant: StaticEffectGrant = {};
  if (m[at] !== undefined) {
    grant.power = parseInt(m[at], 10);
    grant.toughness = parseInt(m[at + 1], 10);
  }
  const abilityText = m[at + 2] ?? m[at + 3];
  if (abilityText) {
    const abilities = parseAbilitiesFromTail(abilityText);
    if (abilities.length === 0) return null;
    grant.abilities = abilities;
  }
  return grant.power !== undefined || grant.abilities ? grant : null;
}

type Rule = { re: RegExp; scope: (m: RegExpMatchArray) => StaticEffectScope; at: number };
const RULES: Rule[] = [
  { re: new RegExp(`^all ([a-z]+) creatures ${TAIL}$`), at: 2,
    scope: (m) => ({ kind: 'all_creatures_of_type', creatureType: m[1] }) },
  { re: new RegExp(`^creature tokens ${TAIL}$`), at: 1,
    scope: () => ({ kind: 'all_creatures', qualifier: { token: true } }) },
  { re: new RegExp(`^(?:all )?creatures( you control)? with ([a-z ]+?) ${TAIL}$`), at: 3,
    scope: (m) => ({ kind: m[1] ? 'creatures_you_control' : 'all_creatures', qualifier: { keyword: m[2] } }) },
  { re: new RegExp(`^(?:each creature you control with an? \\+1\\/\\+1 counter on it|creatures you control with \\+1\\/\\+1 counters on them) ${TAIL}$`), at: 1,
    scope: () => ({ kind: 'creatures_you_control', qualifier: { counter: '+1/+1' } }) },
];

export function pushQualifiedScopeSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  lines.forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    if (!line || /until end of turn|for each|as long as|^(?:when|whenever|at|if)\b|:/.test(line)) return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const scope = rule.scope(m);
      if (scope.qualifier?.keyword && /\bcounter|\bpower\b|\btoughness\b|\bmana value\b/.test(scope.qualifier.keyword)) return;
      const grant = grantFrom(m, rule.at);
      const id = `qualified-scope:${index}`;
      if (!grant || specs.some((s) => String(s.id).endsWith(id))) return;
      // Keyword qualifiers ride the layer-6 keyword resolver (target_has_keyword), which sees keywords
      // granted by other statics and skips keyword-conditioned specs, so there is no dependency loop.
      const keyword = scope.qualifier?.keyword;
      if (keyword) {
        const { keyword: _kw, ...rest } = scope.qualifier!;
        const plain = { ...scope, qualifier: Object.keys(rest).length ? rest : undefined };
        if (!plain.qualifier) delete plain.qualifier;
        specs.push(buildSpec(source, id, plain, grant, { kind: 'target_has_keyword', keyword }));
      } else specs.push(buildSpec(source, id, scope, grant));
      return;
    }
  });
}
