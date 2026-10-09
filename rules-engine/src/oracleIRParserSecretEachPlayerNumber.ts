/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: secret each-player number, highest-number damage, and
 *   discard-hand-then-draw for players who did not choose the lowest
 *   (Wheel of Misfortune family).
 * Public: tryParseSecretEachPlayerNumber
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { normalizeOracleText } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const WORD_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const LEAD =
  /^each player secretly chooses a number (\d+) or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way\.?\s*/i;

const HIGHEST_DAMAGE =
  /^.+?\s+deals damage equal to the highest number to each player who chose that number\.?\s*/i;

const LOWEST_WHEEL =
  /^each player who did(?:n't| not) choose the lowest number discards their hand, then draws ([a-z0-9]+) cards?\.?$/i;

function stripReminders(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDrawCount(raw: string): number | null {
  const token = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return value > 0 ? value : null;
  }
  const word = WORD_COUNTS[token];
  return word && word > 0 ? word : null;
}

export function tryParseSecretEachPlayerNumber(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = stripReminders(clause);
  if (!normalized) return null;

  const lead = normalized.match(LEAD);
  if (!lead) return null;
  const minNumber = Number(lead[1]);
  if (!Number.isFinite(minNumber) || minNumber < 0) return null;

  let rest = normalized.slice(lead[0].length);
  const damage = rest.match(HIGHEST_DAMAGE);
  if (!damage) return null;
  rest = rest.slice(damage[0].length).trim();

  const wheel = rest.match(LOWEST_WHEEL);
  if (!wheel) return null;
  const drawCount = parseDrawCount(wheel[1] || '');
  if (drawCount == null) return null;

  return withMeta({
    kind: 'secret_each_player_number',
    choosers: { kind: 'each_player' },
    secret: true,
    minNumber,
    drawCount,
    raw: rawClause,
  });
}
