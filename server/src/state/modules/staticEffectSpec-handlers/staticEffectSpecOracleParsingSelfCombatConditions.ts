// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfCombatConditions.ts
// Conditional self combat restrictions / evasion (census R34):
//   "This creature can't attack or block unless you control another Giant." (Blind-Spot Giant, Hazoret, Relic Golem)
//   "This creature can't block unless you control a Vampire." / "... can't attack unless ..."
//   "This creature can't be blocked as long as <condition>." / "... can't be blocked if <condition>."
// The condition goes through the shared self-condition parser; unknown conditions and cost-style
// "unless" clauses (pay / sacrifice / return / tap) yield no spec.
// Public entry symbols: pushSelfCombatConditionSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseStaticSelfCondition } from './staticEffectSpecOracleParsingConditionalSelfGrants.js';
import { defenderConditionedAttackAbility } from './staticEffectSpecOracleParsingR36MassCombat.js';

const COST_UNLESS = /\b(?:pays?|sacrifices?|returns?|tap an?|taps?|exiles?|discards?)\b/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selfSubjectPattern(sourceName: string): string {
  const name = String(sourceName || '').toLowerCase().trim();
  const short = name.split(',')[0].trim();
  const alts = ['this creature', 'this permanent', 'this vehicle', '~'];
  if (name) alts.push(escapeRe(name));
  if (short && short !== name) alts.push(escapeRe(short));
  return '(?:' + alts.join('|') + ')';
}

export function pushSelfCombatConditionSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const subject = selfSubjectPattern(source.sourceName);
  const lockRe = new RegExp('^' + subject + " can't (attack or block|attack|block) unless (.+)$");
  const evadeRe = new RegExp('^' + subject + " can't be blocked (?:as long as|if) (.+)$");
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  lines.forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '')
      .replace(/^[a-z0-9' ]+ (?:\u2014|\u2013|-) /, '');
    const lock = line.match(lockRe);
    if (lock) {
      if (COST_UNLESS.test(lock[2])) return;
      const condition = parseStaticSelfCondition(lock[2]);
      if (!condition) return;
      // R36: the defender is only known at declaration; combatR36DefenderConditionedAttack evaluates it.
      if (/defending player/.test(lock[2])) {
        if (lock[1] === 'block') return;
        specs.push(buildSpec(source, 'self-attack-unless-defender:' + index, { kind: 'self' }, { abilities: [defenderConditionedAttackAbility(lock[2])] }));
        return;
      }
      const abilities = lock[1] === 'attack' ? ["can't attack"] : lock[1] === 'block' ? ["can't block"] : ["can't attack", "can't block"];
      specs.push({ ...buildSpec(source, 'self-combat-lock-unless:' + index, { kind: 'self' }, { abilities }, condition), conditionNegated: true });
      return;
    }
    const evade = line.match(evadeRe);
    if (evade) {
      const condition = parseStaticSelfCondition(evade[1]);
      if (!condition) return;
      specs.push(buildSpec(source, 'self-unblockable-while:' + index, { kind: 'self' }, { abilities: ["can't be blocked"] }, condition));
    }
  });
}
