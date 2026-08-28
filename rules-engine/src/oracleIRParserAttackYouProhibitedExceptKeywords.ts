/**
 * Origin parent: oracleIRParserSimpleActionTokenLife.ts
 * Cluster: this-duration “you can't be attacked except by creatures with …”
 *   (Island Sanctuary skip-draw “if you do” lock). Idle replacement wrappers
 *   stay unparsed; StaticEffectSpec must not treat the full Island Sanctuary
 *   first sentence as a continuous lock.
 * Public: tryParseAttackYouProhibitedExceptKeywordsClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts or oracleIRParserSimpleActionClauses.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const REPLACEMENT_WRAPPER = /\bif you would\b|\bif you do\b/i;

const LEADING_UNTIL_NEXT_TURN = new RegExp(
  "^until your next turn,?\\s+you can(?:not|'t|’t)\\s+be attacked except by creatures with (.+)$",
  'i',
);

const TRAILING_UNTIL_NEXT_TURN = new RegExp(
  "^you can(?:not|'t|’t)\\s+be attacked except by creatures with (.+?)\\s+until your next turn$",
  'i',
);

function parseExceptKeywordList(raw: string): string[] {
  return String(raw || '')
    .replace(/\.+$/, '')
    .split(/\s*(?:,\s*(?:and\/or|and|or)\s+|and\/or|\s+or\s+|\s+and\s+|,\s+)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-z][a-z\s]*$/.test(part));
}

export function tryParseAttackYouProhibitedExceptKeywordsClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): Extract<OracleEffectStep, { kind: 'grant_static_ability' }> | null {
  const { rawClause, withMeta } = args;
  const clause = normalizeOracleText(String(args.clause || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
  if (!clause || REPLACEMENT_WRAPPER.test(clause)) return null;

  const leading = clause.match(LEADING_UNTIL_NEXT_TURN);
  const trailing = leading ? null : clause.match(TRAILING_UNTIL_NEXT_TURN);
  const match = leading || trailing;
  if (!match) return null;

  const keywords = parseExceptKeywordList(String(match[1] || ''));
  if (keywords.length === 0) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector('you'),
    effectText: [`can't be attacked except by creatures with ${keywords.join(' and/or ')}`],
    duration: 'until_next_turn',
    raw: rawClause,
  });
}
