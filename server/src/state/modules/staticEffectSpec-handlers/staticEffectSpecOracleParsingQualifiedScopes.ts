// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedScopes.ts
// Census families with a qualified recipient group (whole static lines):
//   "All Sliver creatures get +1/+0." (Muscle Sliver)                -> all_creatures_of_type
//   "Creature tokens get -1/-1." (Illness in the Ranks)               -> token qualifier
//   ("[non]token creatures / creature tokens YOU CONTROL" are already handled by the existing
//   controller-token paths -- Always Watching, Caretaker's Talent -- so they are not matched here.)
//   "Creatures [you control] with flying get -1/-0." (Gravitational Shift) -> keyword qualifier
//   "Each creature you control with a +1/+1 counter on it has trample." (Zegana) -> counter qualifier
//   "Creatures you control with +1/+1 counters on them get/have ..."
//   "Creatures without flying get -2/-0." (Gravitational Shift)          -> negated keyword condition
//   "Bird creatures get +1/+1." (Soraya)                              -> all_creatures_of_type
//   "Zombie tokens you control have flying." / "Attacking tokens you control have flying." / "Armies you control have trample."
// Public entry symbols: pushQualifiedScopeSpecs.

import type { StaticEffectGrant, StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
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

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const isType = (w: string | undefined) => !!w && w !== 'creature' && isCreatureTypeWord(cap(w));
const singular = (w: string) => w.replace(/ies$/, 'y').replace(/(?:ches|shes|xes)$/, (s) => s.slice(0, -2)).replace(/s$/, '');

type Rule = { re: RegExp; scope: (m: RegExpMatchArray) => StaticEffectScope | null; at: number };
const RULES: Rule[] = [
  { re: new RegExp(`^all ([a-z]+) creatures ${TAIL}$`), at: 2,
    scope: (m) => ({ kind: 'all_creatures_of_type', creatureType: m[1] }) },
  { re: new RegExp(`^creature tokens ${TAIL}$`), at: 1,
    scope: () => ({ kind: 'all_creatures', qualifier: { token: true } }) },
  { re: new RegExp(`^([a-z]+) creatures ${TAIL}$`), at: 2,
    scope: (m) => (isType(m[1]) ? { kind: 'all_creatures_of_type', creatureType: m[1] } : null) },
  { re: new RegExp(`^(?:(attacking|blocking) )?(?:([a-z]+) )?(?:creature )?tokens you control ${TAIL}$`), at: 3,
    scope: (m) => {
      if (!m[1] && !m[2]) return null;
      if (m[2] && !isType(m[2])) return null;
      return { kind: 'creatures_you_control', ...(m[2] ? { creatureType: m[2] } : {}),
        qualifier: { token: true, ...(m[1] === 'attacking' ? { attacking: true } : m[1] === 'blocking' ? { blocking: true } : {}) } };
    } },
  { re: new RegExp(`^(?:(attacking|blocking) )?([a-z]+) you control ${TAIL}$`), at: 3,
    scope: (m) => {
      const noun = singular(m[2]);
      if (noun === m[2] || !isType(noun)) return null;
      return { kind: 'creatures_you_control', creatureType: noun,
        ...(m[1] ? { qualifier: m[1] === 'attacking' ? { attacking: true } : { blocking: true } } : {}) };
    } },
  // R32: "(Other) creatures you control with counters on them have ..." (M'Benga, McCoy, Dominion Supervisor).
  { re: new RegExp(`^(other )?creatures you control with counters on them ${TAIL}$`), at: 2,
    scope: (m) => ({ kind: m[1] ? 'other_creatures_you_control' : 'creatures_you_control', qualifier: { anyCounter: true } }) },
  { re: new RegExp(`^(?:all )?creatures( you control)? with(?:out)? ([a-z ]+?) ${TAIL}$`), at: 3,
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
    // B80: strip ability words ("The Will of the Hive Mind — …") before matching.
    const line = raw
      .replace(/\([^)]*\)/g, '')
      .replace(/^[a-z0-9' -]+\s*(?:\u2014|--|-)\s+/i, '')
      .trim()
      .replace(/\.$/, '');
    if (!line || /until end of turn|for each|as long as|^(?:when|whenever|at|if)\b|:/.test(line)) return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const scope = rule.scope(m);
      if (!scope) continue;
      // Typed groups another lord reader already covered from this source are left alone.
      if (scope.creatureType && specs.some((s) => s.sourcePermanentId === source.sourcePermanentId
        && String(s.scope?.creatureType || '').toLowerCase() === scope.creatureType!.toLowerCase())) return;
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
        const spec = buildSpec(source, id, plain, grant, { kind: 'target_has_keyword', keyword });
        if (new RegExp(`\\bwithout ${keyword}\\b`).test(line)) (spec as any).conditionNegated = true;
        specs.push(spec);
      } else specs.push(buildSpec(source, id, scope, grant));
      return;
    }
  });
}
