/**
 * Origin parent: oracleIRParserEffectClauseToStep.ts
 * Cluster: this-turn / until-next-turn “creatures can't attack unless their
 *   controller pays {N}/{X}” activated or delayed clauses (War Tax global;
 *   Forbidding Spirit attack-you until your next turn).
 *   Continuous pillowfort “can't attack you unless … pays {N}” stays
 *   StaticEffectSpec. Idle War Tax must not tax.
 * Public: tryParseAttackTaxThisTurnClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts or oracleIRParserSimpleActionClauses.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const ACTIVATED_COST_PREFIX =
  /^(?:(?:\{[^}]+\}|\{T\})\s*,?\s*)+:\s*(.+)$/i;

const MANA = '\\{(?:X|\\d+)\\}';
const PAY = `unless\\s+their\\s+controller\\s+pays\\s+(${MANA})`;
const EACH = '(?:\\s+for\\s+each\\s+(?:attacking\\s+creature\\s+they\\s+control|of\\s+those\\s+creatures|creature\\s+they\\s+control\\s+that(?:\'|’)s\\s+attacking\\s+you))?';
const ATTACK_YOU = 'can(?:not|\'t|’t)\\s+attack\\s+you(?:\\s+or\\s+planeswalkers\\s+you\\s+control)?';
const ATTACK_GLOBAL = 'can(?:not|\'t|’t)\\s+attack';

const THIS_TURN_ATTACK_YOU_LEADING = new RegExp(
  `^this\\s+turn,?\\s+creatures\\s+${ATTACK_YOU}\\s+${PAY}${EACH}\\.?$`,
  'i',
);

const THIS_TURN_ATTACK_YOU_TRAILING = new RegExp(
  `^creatures\\s+${ATTACK_YOU}\\s+${PAY}${EACH}\\s+this\\s+turn\\.?$`,
  'i',
);

const UNTIL_NEXT_TURN_ATTACK_YOU = new RegExp(
  `^until\\s+your\\s+next\\s+turn,?\\s+creatures\\s+${ATTACK_YOU}\\s+${PAY}${EACH}\\.?$`,
  'i',
);

const THIS_TURN_GLOBAL_LEADING = new RegExp(
  `^this\\s+turn,?\\s+creatures\\s+${ATTACK_GLOBAL}\\s+${PAY}${EACH}\\.?$`,
  'i',
);

const THIS_TURN_GLOBAL_TRAILING = new RegExp(
  `^creatures\\s+${ATTACK_GLOBAL}\\s+${PAY}${EACH}\\s+this\\s+turn\\.?$`,
  'i',
);

function stripActivatedCostPrefix(clause: string): string {
  const match = String(clause || '').trim().match(ACTIVATED_COST_PREFIX);
  return match ? String(match[1] || '').trim() : String(clause || '').trim();
}

function manaFromMatch(match: RegExpMatchArray | null): string {
  return String(match?.[1] || '').trim();
}

export function tryParseAttackTaxThisTurnClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): Extract<OracleEffectStep, { kind: 'grant_static_ability' }> | null {
  const { rawClause, withMeta } = args;
  const clause = normalizeOracleText(String(args.clause || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
  if (!clause) return null;

  const body = stripActivatedCostPrefix(clause);

  const untilNextYou = body.match(UNTIL_NEXT_TURN_ATTACK_YOU);
  const thisTurnYou = untilNextYou
    ? null
    : (body.match(THIS_TURN_ATTACK_YOU_LEADING) || body.match(THIS_TURN_ATTACK_YOU_TRAILING));
  const thisTurnGlobal = untilNextYou || thisTurnYou
    ? null
    : (body.match(THIS_TURN_GLOBAL_LEADING) || body.match(THIS_TURN_GLOBAL_TRAILING));
  const match = untilNextYou || thisTurnYou || thisTurnGlobal;
  if (!match) return null;

  const mana = manaFromMatch(match);
  if (!mana) return null;

  const attackYou = Boolean(untilNextYou || thisTurnYou);
  const effectText = attackYou
    ? `can't attack you unless their controller pays ${mana}`
    : `can't attack unless their controller pays ${mana}`;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(attackYou ? 'you' : 'creatures'),
    effectText: [effectText],
    duration: untilNextYou ? 'until_next_turn' : 'this_turn',
    raw: rawClause,
  });
}
