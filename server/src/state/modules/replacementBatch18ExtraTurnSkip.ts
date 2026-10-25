// Batch 18: "If an opponent would begin an extra turn, that player skips that turn instead" (Stranglehold,
// Trouble in Pairs). Called from dropSkippedExtraTurns (Batch 16) when no all-player skip source exists, so
// turn.ts does not grow. Only extra turns whose player is an opponent of a skip source's controller are removed.
// Public entry symbols: opponentExtraTurnSkipSources, dropOpponentSkippedExtraTurns.

import { debug } from '../../utils/debug.js';

interface B18TurnPerm { controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } }
interface B18ExtraTurn { playerId?: string }
interface B18SkippedTurn { playerId: string; sourceName: string; timestamp: number }
export interface B18TurnState { battlefield?: B18TurnPerm[]; skippedExtraTurns?: B18SkippedTurn[] }

const OPP_SKIP_RE = /if an opponent would begin an extra turn, that player skips that turn instead/i;

export function opponentExtraTurnSkipSources(state: B18TurnState | undefined): Array<{ controller: string; sourceName: string }> {
  const bf = Array.isArray(state?.battlefield) ? state!.battlefield : [];
  return bf
    .filter((p) => p && p.phasedOut !== true && OPP_SKIP_RE.test(String(p.card?.oracle_text || '')))
    .map((p) => ({ controller: String(p.controller || ''), sourceName: String(p.card?.name || 'Unknown') }));
}

/** Removes pending extra turns taken by an opponent of a skip source's controller. Returns the count removed. */
export function dropOpponentSkippedExtraTurns(state: B18TurnState | undefined, extraTurns: B18ExtraTurn[]): number {
  if (!state || !Array.isArray(extraTurns) || extraTurns.length === 0) return 0;
  const sources = opponentExtraTurnSkipSources(state);
  if (!sources.length) return 0;
  let removed = 0;
  for (let i = extraTurns.length - 1; i >= 0; i--) {
    const pid = String(extraTurns[i]?.playerId || '');
    const src = sources.find((s) => s.controller && pid && s.controller !== pid);
    if (!src) continue;
    extraTurns.splice(i, 1);
    state.skippedExtraTurns = Array.isArray(state.skippedExtraTurns) ? state.skippedExtraTurns : [];
    state.skippedExtraTurns.push({ playerId: pid, sourceName: src.sourceName, timestamp: Date.now() });
    removed++;
  }
  if (removed) debug(2, `[extraTurnSkip] opponent skip: removed ${removed} extra turn(s)`);
  return removed;
}