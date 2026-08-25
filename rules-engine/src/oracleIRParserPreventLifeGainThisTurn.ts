/**
 * Origin parent: oracleIRParserSimpleActionTokenLife.ts
 * Cluster: this-turn / until-EOT “can't gain life” spell/ability clauses
 *   (Skullcrack / Atarka's Command / Roiling Vortex / leading “Until end of turn,”).
 *   Continuous “Players can't gain life” stays ReplacementEffectSpec.
 * Public: tryParsePreventLifeGainThisTurnClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts or oracleIRParserSimpleActionClauses.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const SUBJECT =
  '(you|target player|target opponent|players|each player|your opponents|each opponent|each of your opponents|opponents)';

const THIS_TURN = new RegExp(
  `^${SUBJECT}\\s+can(?:not|'t|’t)\\s+gain\\s+life\\s+this\\s+turn\\.?$`,
  'i',
);

const UNTIL_EOT_TRAILING = new RegExp(
  `^${SUBJECT}\\s+can(?:not|'t|’t)\\s+gain\\s+life\\s+until\\s+end\\s+of\\s+turn\\.?$`,
  'i',
);

const UNTIL_EOT_LEADING = new RegExp(
  `^until\\s+end\\s+of\\s+turn,?\\s+${SUBJECT}\\s+can(?:not|'t|’t)\\s+gain\\s+life\\.?$`,
  'i',
);

const ACTIVATED_COST_PREFIX =
  /^(?:(?:\{[^}]+\}|\{T\})\s*,\s*)*(?:\{[^}]+\}|\{T\})\s*:\s*(.+)$/i;

function stripActivatedCostPrefix(clause: string): string {
  const match = String(clause || '').trim().match(ACTIVATED_COST_PREFIX);
  return match ? String(match[1] || '').trim() : String(clause || '').trim();
}

function selectorTextForSubject(subject: string): string {
  const normalized = String(subject || '').trim().toLowerCase();
  if (normalized === 'players' || normalized === 'each player') return 'each player';
  if (
    normalized === 'your opponents'
    || normalized === 'each opponent'
    || normalized === 'each of your opponents'
    || normalized === 'opponents'
  ) {
    return 'your opponents';
  }
  return normalized;
}

export function tryParsePreventLifeGainThisTurnClause(args: {
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

  const thisTurn = body.match(THIS_TURN);
  const untilEotTrailing = thisTurn ? null : body.match(UNTIL_EOT_TRAILING);
  const untilEotLeading = thisTurn || untilEotTrailing ? null : body.match(UNTIL_EOT_LEADING);
  const match = thisTurn || untilEotTrailing || untilEotLeading;
  if (!match) return null;

  const subject = String(match[1] || '').trim();
  if (!subject) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(selectorTextForSubject(subject)),
    effectText: ["can't gain life"],
    duration: thisTurn ? 'this_turn' : 'end_of_turn',
    raw: rawClause,
  });
}
