/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster: as-enters replacement "enters under the control of an opponent of your choice"
 *   (Xantcha, Sleeper Agent and same-template permanents).
 * Public: tryParseEntersUnderOpponentControlClause
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

const ENTERS_UNDER_OPPONENT_CONTROL =
  /^(this (?:creature|permanent|artifact|enchantment)|it) enters(?: the battlefield)? under the control of an opponent of your choice$/i;
const ENTERS_UNDER_OPPONENT_CONTROL_FRAGMENT =
  /^under the control of an opponent of your choice$/i;

export function tryParseEntersUnderOpponentControlClause(
  args: SimpleActionClauseParseArgs,
): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const isFullClause = ENTERS_UNDER_OPPONENT_CONTROL.test(clause);
  if (!isFullClause && !ENTERS_UNDER_OPPONENT_CONTROL_FRAGMENT.test(clause)) return null;
  // Replacement parsing splits "This permanent enters under the control…" into the
  // effect fragment after "enters". Keep "enters" in `raw` so as-enters choice
  // derivation still recognizes the one-shot control change.
  const raw = (isFullClause || /enters(?: the battlefield)? under the control of an opponent/i.test(rawClause))
    ? rawClause
    : `this permanent enters ${clause}`;
  return withMeta({
    kind: 'gain_control',
    what: parseObjectSelector('this permanent'),
    newController: parsePlayerSelector('an opponent of your choice'),
    duration: 'indefinite',
    raw,
  });
}
