// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (lines 449-588 before extraction)
// Cluster moved: the shared move_zone applied-result builder, its replay-mutation bridge and the
// module-level "step currently being applied" slot that bridge reads, plus the exile-source
// annotation helper and the local shuffle/mana-value snapshot utilities they use.
// Public entry symbols: shuffleCardArray, enrichMovedCardSnapshot, setActiveMoveZoneStep,
// buildAppliedResult, annotateExiledCardsWithSource.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  buildMoveZoneReplayMutations,
  mergeReplayMutations,
  type EffectProgramCardZone,
  type OracleIRReplayMutation,
} from './oracleIRReplayMutations';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';
import type { StepApplyResult } from './oracleIRExecutorMoveZoneStepTypes';

export function shuffleCardArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function enrichMovedCardSnapshot(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const manaValue = getCardManaValue(card);
  if (manaValue === null) return card;
  return {
    ...card,
    cmc: card.cmc ?? manaValue,
    manaValue: card.manaValue ?? card.mana_value ?? manaValue,
  };
}

let activeMoveZoneStep: Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;

export function setActiveMoveZoneStep(step: Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined): void {
  activeMoveZoneStep = step;
}

export function buildAppliedResult(
  result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
    readonly movedBattlefieldPermanentIds?: readonly string[];
    readonly lastMovedBattlefieldPermanentIds?: readonly string[];
    readonly lastMovedCards?: readonly any[];
    readonly lastReferenceAmount?: number;
    readonly lastMovedCountByPlayer?: Readonly<Record<string, number>>;
    readonly fromZone?: EffectProgramCardZone;
    readonly toZone?: EffectProgramCardZone;
    readonly replayMutations?: readonly OracleIRReplayMutation[];
  },
  ctx?: OracleIRExecutionContext,
): StepApplyResult {
  const movedCards = Array.isArray(result.lastMovedCards)
    ? result.lastMovedCards
    : Array.isArray(result.movedCards)
      ? result.movedCards
      : undefined;
  const enrichedMovedCards = Array.isArray(movedCards)
    ? movedCards.map((card) => enrichMovedCardSnapshot(card))
    : undefined;
  let replayMutations = Array.isArray(result.replayMutations) ? [...result.replayMutations] : [];
  if (ctx && activeMoveZoneStep && Array.isArray(enrichedMovedCards) && enrichedMovedCards.length > 0) {
    replayMutations = mergeReplayMutations(
      replayMutations,
      buildMoveZoneReplayMutations({
        step: activeMoveZoneStep,
        fromZone: result.fromZone,
        toZone: result.toZone,
        movedCards: enrichedMovedCards,
        movedPermanentIds: result.movedPermanentIds,
        state: result.state,
        ctx,
      }),
    );
  }
  return bridgedZoneStepResult(ctx, {
    applied: true,
    state: result.state,
    log: result.log,
    ...(Array.isArray(enrichedMovedCards) ? { lastMovedCards: [...enrichedMovedCards] } : {}),
    ...(Array.isArray(
      result.movedPermanentIds ??
        result.movedBattlefieldPermanentIds ??
        result.lastMovedBattlefieldPermanentIds
    )
      ? {
          lastMovedBattlefieldPermanentIds: [
            ...(result.movedPermanentIds ??
              result.movedBattlefieldPermanentIds ??
              result.lastMovedBattlefieldPermanentIds ??
              []),
          ],
        }
      : {}),
    ...(typeof result.lastReferenceAmount === 'number' && Number.isFinite(result.lastReferenceAmount)
      ? { lastReferenceAmount: Math.max(0, Number(result.lastReferenceAmount) || 0) }
      : {}),
    ...(result.lastMovedCountByPlayer ? { lastMovedCountByPlayer: { ...result.lastMovedCountByPlayer } } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  });
}

export function annotateExiledCardsWithSource(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): { state: GameState; movedCards?: readonly any[] } {
  const sourceId = String(params.ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(params.ctx.sourceName || '').trim();
  const movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceRef || movedCards.length === 0) {
    return { state: params.state, ...(params.movedCards ? { movedCards } : {}) };
  }

  const movedIds = new Set(
    movedCards
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
  );
  if (movedIds.size === 0) {
    return { state: params.state, movedCards };
  }

  let stateChanged = false;
  const updatedPlayers = (params.state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let exileChanged = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !movedIds.has(cardId)) return card;
      exileChanged = true;
      return {
        ...card,
        exiledBy: sourceRef,
        ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
      };
    });
    if (!exileChanged) return player;
    stateChanged = true;
    return { ...player, exile: nextExile };
  });

  const nextMovedCards = movedCards.map((card: any) => ({
    ...card,
    exiledBy: sourceRef,
    ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
  }));

  return {
    state: stateChanged ? ({ ...params.state, players: updatedPlayers as any } as GameState) : params.state,
    movedCards: nextMovedCards,
  };
}
