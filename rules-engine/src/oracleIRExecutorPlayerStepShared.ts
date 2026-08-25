// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: withDiscardLedgerFlags, shuffleArray, getNormalizedChosenIds,
// buildPlayerZoneBridgeOptions, resolveStepAmountForPlayer, filterChosenHandCardIds.
// Public entries: withDiscardLedgerFlags, shuffleArray, getNormalizedChosenIds,
// buildPlayerZoneBridgeOptions, resolveStepAmountForPlayer, filterChosenHandCardIds.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleClauseCondition, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { PlayerZoneChangeBridgeContext } from './oracleIRExecutorCardZoneTransitionCommit';
import {
  resolveOracleQuantity,
  resolveOracleQuantityForPlayer,
  type ResolveOracleQuantityOptions,
} from './oracleIRExecutorResolveQuantity';
import { omitBridgedStepCarryOver } from './oracleIRStepLedgerRuntime';
import {
  buildDiscardEffectReplayMutationsFromCards,
  type OracleIRReplayMutation,
} from './oracleIRReplayMutations';

export function withDiscardLedgerFlags<T extends Record<string, unknown>>(
  result: T,
  ledgerRecordedViaBridge?: boolean,
  options?: { discardDestination?: 'graveyard' | 'exile' },
): T & { skipLedgerFlush?: boolean } {
  let next: T = result;
  // Server-bridge discards flush the ledger themselves and omit lastDiscardedCards.
  // Promote those cards into replayMutations first so Windfall-style wheels survive event-log replay.
  if (ledgerRecordedViaBridge) {
    const cards = Array.isArray((result as any).lastDiscardedCards)
      ? ((result as any).lastDiscardedCards as any[])
      : [];
    if (cards.length > 0) {
      const existing = Array.isArray((result as any).replayMutations)
        ? ([...(result as any).replayMutations] as OracleIRReplayMutation[])
        : [];
      const hasDiscardMutations = existing.some((mutation) => mutation?.kind === 'discardEffect');
      if (!hasDiscardMutations) {
        const destination = options?.discardDestination
          || ((result as any).discardDestination === 'exile' ? 'exile' : 'graveyard');
        const promoted = buildDiscardEffectReplayMutationsFromCards(cards, destination);
        // Only attach when non-empty. An empty replayMutations array would block
        // collectReplayMutationsFromAppliedStep's discard fallback after omit strips cards.
        if (promoted.length > 0) {
          next = {
            ...result,
            replayMutations: [...existing, ...promoted],
          } as T;
        }
      }
    }
  }
  return omitBridgedStepCarryOver(next, { ledgerRecordedViaBridge });
}

export function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[idx]];
  }
  return shuffled;
}

export function getNormalizedChosenIds(ctx: OracleIRExecutionContext): readonly string[] {
  return (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
}

export function buildPlayerZoneBridgeOptions(
  ctx: OracleIRExecutionContext,
  stepKind: 'discard' | 'mill',
): PlayerZoneChangeBridgeContext | undefined {
  if (!ctx.serverBridge) return undefined;
  if (ctx.currentStepIndex == null) return undefined;
  return {
    ctx,
    stepIndex: ctx.currentStepIndex,
    stepKind,
  };
}

export function resolveStepAmountForPlayer(
  state: GameState,
  controllerId: PlayerID,
  amount: OracleQuantity,
  ctx: OracleIRExecutionContext,
  targetPlayerId: PlayerID | undefined,
  options?: ResolveOracleQuantityOptions & { whereX?: OracleClauseCondition },
): number | null {
  const resolved = targetPlayerId
    ? resolveOracleQuantityForPlayer(state, controllerId, amount, ctx, targetPlayerId, options)
    : resolveOracleQuantity(state, controllerId, amount, ctx, options);
  return resolved;
}

export function filterChosenHandCardIds(
  state: GameState,
  playerId: PlayerID,
  chosenIds: readonly string[],
): readonly string[] {
  const player = state.players.find((candidate) => candidate.id === playerId) as any;
  const handIds = new Set(
    (Array.isArray(player?.hand) ? player.hand : [])
      .map((card: any) => String(card?.id || card?.card?.id || '').trim())
      .filter(Boolean),
  );
  return chosenIds.filter((id) => handIds.has(id));
}
