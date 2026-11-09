// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingR36MassCombat.ts
// R36 mass combat restrictions / evasion and plural-type anthems (census):
//   "Red creatures can't attack unless defending player controls an Island." (Red Lock family)
//   "Blue creatures you control can't be blocked." (Deepchannel Mentor)
//   "Creatures your opponents control with -1/-1 counters on them can't block." (Spitting Dilophosaurus)
//   "Creatures without flying or islandwalk can't attack." (Stormtide Leviathan)
//   "Goblin creatures can't block unless ..." / "Zombies you control can't be blocked as long as ..."
//   "All Saprolings get +1/+1." / "Saprolings get +1/+1." (Thelonite Hermit)
// Defending-player attack conditions become the ability text "can't attack unless <cond>", enforced at
// declaration by combatR36DefenderConditionedAttack (the defender is unknown inside the static pass).
// Cost-style "unless" (pay / sacrifice ...) is left to tax handlers; "you" conditions only for "you control" groups.
// Public entry symbols: pushR36MassCombatSpecs, defenderConditionedAttackAbility.

import type { StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseStaticSelfCondition } from './staticEffectSpecOracleParsingConditionalSelfGrants.js';

const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const COST_UNLESS = /\b(?:pays?|sacrifices?|returns?|taps?|exiles?|discards?)\b/;
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const isType = (w: string | undefined) => !!w && w !== 'creature' && isCreatureTypeWord(cap(w));
const singular = (w: string) => w.replace(/ies$/, 'y').replace(/(?:ches|shes|xes)$/, (s) => s.slice(0, -2)).replace(/s$/, '');

export function defenderConditionedAttackAbility(condition: string): string {
  return "can't attack unless " + condition.trim();
}

type Subject = { scope: StaticEffectScope; extra?: any; ptOk: boolean };

function kindFor(ctrl: string | undefined): StaticEffectScope['kind'] {
  const c = String(ctrl || '').trim();
  return !c ? 'all_creatures' : c === 'you control' ? 'creatures_you_control' : 'opponent_creatures';
}

function typed(t: string, ctrl: string | undefined): StaticEffectScope {
  const c = String(ctrl || '').trim();
  if (!c) return { kind: 'all_creatures_of_type', creatureType: t };
  return { kind: c === 'you control' ? 'creatures_you_control' : 'opponent_creatures_of_type', creatureType: t };
}

const CTRL = '( you control| your opponents control)?';
const COLOR = '(?:white|blue|black|red|green)';

function parseSubject(s: string): Subject | null {
  let m = s.match(new RegExp('^(?:all )?(' + COLOR + '(?: (?:and|or) ' + COLOR + ')?) creatures' + CTRL + '$'));
  if (m) return { scope: { kind: kindFor(m[2]), qualifier: { colors: m[1].split(/ (?:and|or) /).map((w) => COLORS[w]) } }, ptOk: false };
  m = s.match(new RegExp('^(?:all )?([a-z]+) creatures' + CTRL + '$'));
  if (m && isType(m[1])) return { scope: typed(m[1], m[2]), ptOk: false };
  m = s.match(new RegExp('^(all )?([a-z]+)' + CTRL + '$'));
  if (m) {
    const noun = singular(m[2]);
    if (noun !== m[2] && isType(noun)) return { scope: typed(noun, m[3]), ptOk: !m[3] };
  }
  m = s.match(new RegExp('^creatures' + CTRL + ' with (-1\\/-1|\\+1\\/\\+1) counters on them$'));
  if (m) return { scope: { kind: kindFor(m[1]), qualifier: { counter: m[2] } }, ptOk: false };
  // Require "or" so Moat ("Creatures without flying can't attack") stays on MassCantAttack's
  // target_lacks_keyword path (keyword-resolver aware). Stormtide-style "without flying or
  // islandwalk" still lands here as target_lacks_keywords.
  m = s.match(new RegExp('^creatures' + CTRL + ' without ([a-z]+),? or ([a-z]+)$'));
  if (m) return { scope: { kind: kindFor(m[1]) }, extra: { kind: 'target_lacks_keywords', keywords: [m[2], m[3]].filter(Boolean) }, ptOk: false };
  return null;
}

const PRED = /^(.+?) (can't attack or block|can't attack|can't block|can't be blocked)(?: (unless|as long as|if) (.+))?$/;
const PT_RE = /^(.+?) gets? ([+-]\d+)\/([+-]\d+)$/;

export function pushR36MassCombatSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const own = (s: StaticEffectSpec) => s.sourcePermanentId === source.sourcePermanentId;
  const sameScope = (a: StaticEffectScope, b: StaticEffectScope) => JSON.stringify(a) === JSON.stringify(b);
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  lines.forEach((raw, index) => {
    let line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    if (!line || /^(?:when|whenever|at|if)\b|:/.test(line)) return;
    // B56: Detective of the Month — leading "As long as you have the city's blessing, ..."
    let leadingCondition: ReturnType<typeof parseStaticSelfCondition> = null;
    const leadAsLongAs = line.match(/^as long as ([^,]+),\s*(.+)$/);
    if (leadAsLongAs) {
      leadingCondition = parseStaticSelfCondition(leadAsLongAs[1]);
      if (leadingCondition) line = String(leadAsLongAs[2] || '').trim();
    }
    const pm = line.match(PRED);
    if (pm) {
      const subj = parseSubject(pm[1]);
      if (!subj) return;
      const { scope } = subj;
      const abilities = pm[2] === "can't attack or block" ? ["can't attack", "can't block"] : [pm[2]];
      if (specs.some((s) => own(s) && sameScope(s.scope as any, scope)
        && (s.grant?.abilities || []).some((a: string) => abilities.includes(a)))) return;
      const id = 'r36-mass-combat:' + index;
      if (!pm[3]) {
        if (leadingCondition) {
          specs.push(buildSpec(source, id, scope, { abilities }, leadingCondition));
        } else {
          specs.push(buildSpec(source, id, scope, { abilities }, subj.extra));
        }
        return;
      }
      if (subj.extra) return;
      const condText = pm[4];
      if (pm[3] === 'unless' && COST_UNLESS.test(condText)) return;
      if (/\byou\b|\byour\b/.test(condText) && scope.kind !== 'creatures_you_control') return;
      const condition = parseStaticSelfCondition(condText);
      if (!condition) return;
      if (pm[3] === 'unless' && /defending player/.test(condText)) {
        if (!abilities.includes("can't attack")) return;
        specs.push(buildSpec(source, id, scope, { abilities: [defenderConditionedAttackAbility(condText)] }));
        return;
      }
      specs.push({ ...buildSpec(source, id, scope, { abilities }, condition), ...(pm[3] === 'unless' ? { conditionNegated: true } : {}) });
      return;
    }
    const pt = line.match(PT_RE);
    if (!pt) return;
    const subj = parseSubject(pt[1]);
    if (!subj || !subj.ptOk) return;
    const type = String(subj.scope.creatureType || '').toLowerCase();
    if (specs.some((s) => own(s) && String(s.scope?.creatureType || '').toLowerCase() === type)) return;
    specs.push(buildSpec(source, 'r36-mass-pt:' + index, subj.scope, { power: parseInt(pt[2], 10), toughness: parseInt(pt[3], 10) }));
  });
}
