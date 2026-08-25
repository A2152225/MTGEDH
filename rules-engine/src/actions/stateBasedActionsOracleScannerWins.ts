// Origin parent: rules-engine/src/actions/stateBasedActionsHandler.ts
// Cluster: wrap GameState as GameContext and query the server oracle-pattern
//   win scanner (immediate state-trigger wins and upkeep intervening-if wins).
// Public entry symbols: findOracleScannerImmediateWin, findOracleScannerUpkeepWin,
//   stampOracleScannerWinOnState, applyOracleScannerWinToState.
// Felidar-style upkeep wins are already applied as an immediate SBA (not a
//   stack trigger). Darksteel-style `immediate` state-trigger wins match that
//   existing pattern: SBA sets winner/gameOver instead of putting a CR 603.8
//   state trigger on the stack.

import type { GameState } from '../../../shared/src';
import type { GameContext } from '../../../server/src/state/context.js';
import {
  checkImmediateWinConditions,
  checkUpkeepWinConditions,
} from '../../../server/src/state/modules/game-state-effects-handlers/gameStateEffectsWinLose.js';
import { opponentsHaveCantWinEffect } from '../winEffectCards';

export type OracleScannerWinHit = {
  winner: string;
  reason: string;
};

function asGameContext(state: GameState): GameContext {
  return { state } as GameContext;
}

function reasonForCondition(condition: { cardName?: string; description?: string }): string {
  const description = String(condition.description || '').trim();
  if (description) return description;
  const name = String(condition.cardName || '').trim();
  return name ? `${name}: you win the game` : 'You win the game';
}

function playerIsOut(player: { hasLost?: boolean; eliminated?: boolean; conceded?: boolean } | undefined): boolean {
  return Boolean(player?.hasLost || player?.eliminated || player?.conceded);
}

function cantWinBlocks(state: GameState, playerId: string): boolean {
  const blocked = opponentsHaveCantWinEffect(
    playerId as any,
    (state.battlefield || []) as any,
    state.players as any,
    ((state as { winLossEffects?: unknown }).winLossEffects || []) as any,
  );
  return Boolean(blocked.hasCantWin);
}

/**
 * First satisfied Darksteel-style `immediate` oracle win among active players.
 */
export function findOracleScannerImmediateWin(state: GameState): OracleScannerWinHit | null {
  const ctx = asGameContext(state);
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId || playerIsOut(player)) continue;
    const condition = checkImmediateWinConditions(ctx, playerId);
    if (!condition) continue;
    if (cantWinBlocks(state, playerId)) continue;
    return { winner: playerId, reason: reasonForCondition(condition) };
  }
  return null;
}

/**
 * First satisfied Felidar-style upkeep oracle win for the given player.
 */
export function findOracleScannerUpkeepWin(state: GameState, playerId: string): OracleScannerWinHit | null {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const player = (state.players || []).find((entry) => String(entry?.id || '') === id);
  if (playerIsOut(player)) return null;
  const condition = checkUpkeepWinConditions(asGameContext(state), id);
  if (!condition) return null;
  if (cantWinBlocks(state, id)) return null;
  return { winner: id, reason: reasonForCondition(condition) };
}

export function stampOracleScannerWinOnState(state: GameState, hit: OracleScannerWinHit): void {
  const next = state as GameState & {
    winner?: string;
    gameOver?: boolean;
    winReason?: string;
    status?: string;
  };
  next.winner = hit.winner;
  next.gameOver = true;
  next.winReason = hit.reason;
  next.status = 'finished';
}

export function applyOracleScannerWinToState(state: GameState, hit: OracleScannerWinHit): GameState {
  return {
    ...state,
    winner: hit.winner,
    gameOver: true,
    status: 'finished' as any,
    winReason: hit.reason as any,
  } as GameState;
}
