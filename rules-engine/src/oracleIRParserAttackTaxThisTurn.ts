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
const PAY_MANA = `unless\\s+their\\s+controller\\s+pays\\s+(${MANA})`;
const PAY_LIFE = 'unless\\s+their\\s+controller\\s+pays\\s+(\\d+)\\s+life';
const EACH = '(?:\\s+for\\s+each\\s+(?:attacking\\s+creature\\s+they\\s+control|of\\s+those\\s+creatures|creature\\s+they\\s+control\\s+that(?:\'|’)s\\s+attacking\\s+you))?';
const ATTACK_YOU = 'can(?:not|\'t|’t)\\s+attack\\s+you(?:\\s+or\\s+planeswalkers\\s+you\\s+control)?';
const ATTACK_GLOBAL = 'can(?:not|\'t|’t)\\s+attack';

function buildAttackYouPatterns(pay: string): { untilNext: RegExp; thisTurnLeading: RegExp; thisTurnTrailing: RegExp } {
  return {
    untilNext: new RegExp(`^until\\s+your\\s+next\\s+turn,?\\s+creatures\\s+${ATTACK_YOU}\\s+${pay}${EACH}\\.?$`, 'i'),
    thisTurnLeading: new RegExp(`^this\\s+turn,?\\s+creatures\\s+${ATTACK_YOU}\\s+${pay}${EACH}\\.?$`, 'i'),
    thisTurnTrailing: new RegExp(`^creatures\\s+${ATTACK_YOU}\\s+${pay}${EACH}\\s+this\\s+turn\\.?$`, 'i'),
  };
}

const MANA_YOU = buildAttackYouPatterns(PAY_MANA);
const LIFE_YOU = buildAttackYouPatterns(PAY_LIFE);

const THIS_TURN_GLOBAL_LEADING = new RegExp(
  `^this\\s+turn,?\\s+creatures\\s+${ATTACK_GLOBAL}\\s+${PAY_MANA}${EACH}\\.?$`,
  'i',
);

const THIS_TURN_GLOBAL_TRAILING = new RegExp(
  `^creatures\\s+${ATTACK_GLOBAL}\\s+${PAY_MANA}${EACH}\\s+this\\s+turn\\.?$`,
  'i',
);

function stripActivatedCostPrefix(clause: string): string {
  const trimmed = String(clause || '').trim();
  const loyalty = trimmed.match(/^\[(?:[+\-]?\d+|x)\]:\s*(.+)$/i);
  if (loyalty) return String(loyalty[1] || '').trim();
  const match = trimmed.match(ACTIVATED_COST_PREFIX);
  return match ? String(match[1] || '').trim() : trimmed;
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

  const untilNextLife = body.match(LIFE_YOU.untilNext);
  const thisTurnLife = untilNextLife
    ? null
    : (body.match(LIFE_YOU.thisTurnLeading) || body.match(LIFE_YOU.thisTurnTrailing));
  const untilNextYou = untilNextLife || thisTurnLife
    ? null
    : body.match(MANA_YOU.untilNext);
  const thisTurnYou = untilNextYou || untilNextLife || thisTurnLife
    ? null
    : (body.match(MANA_YOU.thisTurnLeading) || body.match(MANA_YOU.thisTurnTrailing));
  const thisTurnGlobal = untilNextYou || thisTurnYou || untilNextLife || thisTurnLife
    ? null
    : (body.match(THIS_TURN_GLOBAL_LEADING) || body.match(THIS_TURN_GLOBAL_TRAILING));
  const match = untilNextLife || thisTurnLife || untilNextYou || thisTurnYou || thisTurnGlobal;
  if (!match) return null;

  const isLife = Boolean(untilNextLife || thisTurnLife);
  const amountToken = String(match[1] || '').trim();
  if (!amountToken) return null;

  const attackYou = Boolean(untilNextYou || thisTurnYou || untilNextLife || thisTurnLife);
  const payText = isLife ? `${amountToken} life` : amountToken;
  const effectText = attackYou
    ? `can't attack you unless their controller pays ${payText}`
    : `can't attack unless their controller pays ${payText}`;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(attackYou ? 'you' : 'creatures'),
    effectText: [effectText],
    duration: (untilNextYou || untilNextLife) ? 'until_next_turn' : 'this_turn',
    raw: rawClause,
  });
}
