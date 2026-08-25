/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: optional may-reveal-hand / if-you-do four-zone named-copy win
 *   (Hedron Alignment family). Generic — printed "named X" is this card's
 *   current name at execute time, not a hardcoded card name.
 * Public: tryParseMayRevealHandWinIfOwnNamed
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { normalizeOracleText } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const MAY_REVEAL_HAND_WIN_IF_OWN_NAMED =
  /(?:at\s+the\s+beginning\s+of\s+your\s+upkeep,\s*)?you\s+may\s+reveal\s+your\s+hand\.?\s+if\s+you\s+do,?\s+you\s+win\s+the\s+game\s+if\s+you\s+own\s+a\s+card\s+named\s+.+?\s+in\s+exile,\s+in\s+your\s+hand,\s+in\s+your\s+graveyard,\s+and\s+on\s+the\s+battlefield\.?/i;

function normalizeClause(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '.')
    .trim();
}

export function tryParseMayRevealHandWinIfOwnNamed(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeClause(clause);
  if (!normalized) return null;
  if (!MAY_REVEAL_HAND_WIN_IF_OWN_NAMED.test(normalized)) return null;

  return withMeta({
    kind: 'may_reveal_hand_then_win_if_own_named_in_zones',
    zones: ['exile', 'hand', 'graveyard', 'battlefield'],
    raw: rawClause,
  });
}
