/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts /
 * oracleIRParserPostprocessStructuredTriggerResidualChain.ts
 * Cluster: "that spell / this spell gains <keywords>" (Judith, Carnage Connoisseur
 * and the same template on other instant/sorcery watchers). No until-EOT duration
 * means the keywords last while the object is a spell.
 * Public: parseSpellGainsKeywordGrantSteps, tryParseSpellGainsKeywordGrantClause
 */

import type { OracleEffectStep } from './oracleIR';
import { buildTemporaryGrantStepFields } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';
import { parseObjectSelector } from './oracleIRParserUtils';

const SPELL_GAINS_KEYWORDS_RE =
  /^(that spell|this spell)\s+gains?\s+(.+?)(?:\s+until end of turn)?\.?$/i;

export function parseSpellGainsKeywordGrantSteps(
  raw: string,
  sequence: { sequence?: 'then' } = {},
): readonly OracleEffectStep[] | null {
  const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(SPELL_GAINS_KEYWORDS_RE);
  if (!match) return null;

  const target = String(match[1] || '').trim().toLowerCase();
  const grantFields = buildTemporaryGrantStepFields(String(match[2] || ''));
  if (!Array.isArray(grantFields.abilities) || grantFields.abilities.length === 0) return null;

  const untilEot = /\buntil end of turn\b/i.test(normalized);
  return [{
    kind: untilEot ? 'grant_temporary_ability' : 'grant_static_ability',
    target: parseObjectSelector(target),
    duration: untilEot ? 'end_of_turn' : 'static',
    ...grantFields,
    raw: String(raw || '').trim() || normalized,
    ...sequence,
  } as OracleEffectStep];
}

export function tryParseSpellGainsKeywordGrantClause(
  args: SimpleActionClauseParseArgs,
): OracleEffectStep | null {
  const parsed = parseSpellGainsKeywordGrantSteps(args.clause);
  if (!parsed || parsed.length === 0) return null;
  return args.withMeta(parsed[0]);
}
