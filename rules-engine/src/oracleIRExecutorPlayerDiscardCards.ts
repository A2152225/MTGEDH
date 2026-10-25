// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: discardCardsForPlayer and discardSpecificCardsForPlayer.
// Public entries: discardCardsForPlayer, discardSpecificCardsForPlayer.

import type { GameState, PlayerID } from '../../shared/src';
import {
  commitCardZoneChanges,
  type PlayerZoneChangeBridgeContext,
} from './oracleIRExecutorCardZoneTransitionCommit';
import {
  getCurrentTurnNumber,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerZoneAccess';
import { applyDiscardToBattlefieldReplacements } from './discardToBattlefieldReplacement';

/** Loxodon Smiter-style replacement: opponent-caused discards of matching cards go to the battlefield. */
function withDiscardToBattlefield<R extends { state: GameState; discardedCards: any[]; log: string[] }>(
  result: R,
  playerId: PlayerID,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): R {
  const source = (bridgeOptions?.ctx as any)?.controllerId;
  if (!result?.discardedCards?.length || !source) return result;
  const applied = applyDiscardToBattlefieldReplacements(result.state, playerId, result.discardedCards, String(source));
  if (!applied.redirected.length) return result;
  return { ...result, state: applied.state, log: [...result.log, `${applied.redirected.length} discarded card(s) put onto the battlefield instead`] };
}

function discardProvenanceFields(
  state: GameState,
  playerId: PlayerID,
): { discardedByPlayerId: string; discardedOnTurn: number } {
  return {
    discardedByPlayerId: String(playerId || '').trim(),
    discardedOnTurn: getCurrentTurnNumber(state),
  };
}

function withDiscardProvenance(state: GameState, playerId: PlayerID, card: any): any {
  return {
    ...card,
    ownerId: playerId,
    owner: playerId,
    ...discardProvenanceFields(state, playerId),
  };
}

/** Zone-change commit places the hand copy and drops extraFields; restamp GY + zones. */
function applyDiscardProvenanceToGraveyardCards(
  state: GameState,
  playerId: PlayerID,
  discardedCards: readonly any[],
): void {
  const ids = new Set(
    discardedCards.map((card) => String(card?.id || '').trim()).filter(Boolean),
  );
  if (ids.size === 0) return;
  const fields = discardProvenanceFields(state, playerId);

  const stampInPlace = (cards: any[] | undefined): void => {
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      if (!card || typeof card !== 'object') continue;
      const id = String(card.id || '').trim();
      if (!id || !ids.has(id)) continue;
      card.ownerId = playerId;
      card.owner = playerId;
      card.discardedByPlayerId = fields.discardedByPlayerId;
      card.discardedOnTurn = fields.discardedOnTurn;
    }
  };

  const player = state.players.find((entry) => entry.id === playerId) as any;
  stampInPlace(player?.graveyard);
  const zoneGraveyard = (state as any).zones?.[playerId]?.graveyard;
  if (zoneGraveyard !== player?.graveyard) {
    stampInPlace(zoneGraveyard);
  }
}

export function discardCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): ReturnType<typeof discardCardsForPlayerRaw> {
  return withDiscardToBattlefield(discardCardsForPlayerRaw(state, playerId, count, bridgeOptions), playerId, bridgeOptions);
}

function discardCardsForPlayerRaw(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): { state: GameState; log: string[]; applied: boolean; needsChoice: boolean; discardedCount: number; discardedCards: any[]; ledgerRecordedViaBridge?: boolean; halted?: boolean } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false, needsChoice: false, discardedCount: 0, discardedCards: [] };

  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, applied: true, needsChoice: false, discardedCount: 0, discardedCards: [] };

  if (hand.length > n) {
    return { state, log, applied: false, needsChoice: true, discardedCount: 0, discardedCards: [] };
  }

  const discarded = hand.splice(0, hand.length);
  const stampedDiscarded = stampCardsPutIntoGraveyardThisTurn(state, discarded).map((card: any) => (
    withDiscardProvenance(state, playerId, card)
  ));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: stampedDiscarded,
      sourceZone: 'hand',
      intendedDestination: 'graveyard',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'discard'),
      cause: 'oracle_ir:discard',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        applied: true,
        needsChoice: false,
        discardedCount: 0,
        discardedCards: [],
        halted: true,
      };
    }
    const actualCount = Math.max(commitResult.movedCards.length, stampedDiscarded.length);
    // Prefer stampedDiscarded for replay identity — bridge movedCards can lose owner/id stamps.
    const discardedCardsForReplay = stampedDiscarded.map((card: any, index: number) => {
      const moved = commitResult.movedCards[index];
      return withDiscardProvenance(commitResult.state, playerId, {
        ...(moved && typeof moved === 'object' ? moved : {}),
        ...card,
        id: String(card?.id || moved?.id || '').trim() || card?.id,
      });
    });
    applyDiscardProvenanceToGraveyardCards(commitResult.state, playerId, discardedCardsForReplay);
    log.push(`${playerId} discards ${actualCount} card(s)`);
    return {
      state: commitResult.state,
      log,
      applied: true,
      needsChoice: false,
      discardedCount: actualCount,
      discardedCards: discardedCardsForReplay,
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  graveyard.push(...stampedDiscarded);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, hand, graveyard } : p));
  const nextState = { ...state, players: updatedPlayers as any };
  applyDiscardProvenanceToGraveyardCards(nextState, playerId, stampedDiscarded);
  log.push(`${playerId} discards ${discarded.length} card(s)`);
  return {
    state: nextState,
    log,
    applied: true,
    needsChoice: false,
    discardedCount: discarded.length,
    discardedCards: stampedDiscarded,
  };
}

export function discardSpecificCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  cardIds: readonly string[],
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): ReturnType<typeof discardSpecificCardsForPlayerRaw> {
  return withDiscardToBattlefield(discardSpecificCardsForPlayerRaw(state, playerId, cardIds, bridgeOptions) as any, playerId, bridgeOptions) as any;
}

function discardSpecificCardsForPlayerRaw(
  state: GameState,
  playerId: PlayerID,
  cardIds: readonly string[],
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): {
  state: GameState;
  log: string[];
  applied: boolean;
  discardedCount: number;
  discardedCards: any[];
  missingCardIds: readonly string[];
  ledgerRecordedViaBridge?: boolean;
  halted?: boolean;
} {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { state, log: [`Player not found: ${playerId}`], applied: false, discardedCount: 0, discardedCards: [], missingCardIds: [] };
  }

  const wantedIds = Array.from(new Set((Array.isArray(cardIds) ? cardIds : []).map(id => String(id || '').trim()).filter(Boolean)));
  if (wantedIds.length === 0) {
    return { state, log, applied: false, discardedCount: 0, discardedCards: [], missingCardIds: [] };
  }

  const wantedIdSet = new Set(wantedIds);
  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];
  const discarded = hand.filter((card: any) => wantedIdSet.has(String(card?.id || '').trim()));
  const missingCardIds = wantedIds.filter(id => !discarded.some((card: any) => String(card?.id || '').trim() === id));
  if (missingCardIds.length > 0) {
    return { state, log, applied: false, discardedCount: 0, discardedCards: [], missingCardIds };
  }

  const remainingHand = hand.filter((card: any) => !wantedIdSet.has(String(card?.id || '').trim()));
  const stampedDiscarded = stampCardsPutIntoGraveyardThisTurn(state, discarded).map((card: any) => (
    withDiscardProvenance(state, playerId, card)
  ));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: stampedDiscarded,
      sourceZone: 'hand',
      intendedDestination: 'graveyard',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'discard'),
      cause: 'oracle_ir:discard',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        applied: true,
        discardedCount: 0,
        discardedCards: [],
        missingCardIds: [],
        halted: true,
      };
    }
    const discardedCardsForReplay = stampedDiscarded.map((card: any, index: number) => {
      const moved = commitResult.movedCards[index];
      return withDiscardProvenance(commitResult.state, playerId, {
        ...(moved && typeof moved === 'object' ? moved : {}),
        ...card,
        id: String(card?.id || moved?.id || '').trim() || card?.id,
      });
    });
    applyDiscardProvenanceToGraveyardCards(commitResult.state, playerId, discardedCardsForReplay);
    log.push(`${playerId} discards ${Math.max(commitResult.movedCards.length, stampedDiscarded.length)} chosen card(s)`);
    return {
      state: commitResult.state,
      log,
      applied: true,
      discardedCount: Math.max(commitResult.movedCards.length, stampedDiscarded.length),
      discardedCards: discardedCardsForReplay,
      missingCardIds: [],
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  graveyard.push(...stampedDiscarded);
  const updatedPlayers = state.players.map((p) => (
    p.id === playerId ? { ...p, hand: remainingHand, graveyard } : p
  ));
  const nextState = { ...state, players: updatedPlayers as any };
  applyDiscardProvenanceToGraveyardCards(nextState, playerId, stampedDiscarded);
  log.push(`${playerId} discards ${discarded.length} chosen card(s)`);
  return {
    state: nextState,
    log,
    applied: true,
    discardedCount: stampedDiscarded.length,
    discardedCards: stampedDiscarded,
    missingCardIds: [],
  };
}

