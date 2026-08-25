/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: isAICardStillInCastSourceZone, requestAISharedCast,
 * requestAISharedLandPlay.
 *
 * Public entry symbols: requestAISharedCast, requestAISharedLandPlay.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { handlePlayLandRequest, requestCastSpellForSocket } from "../game-actions.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import { ensureGame } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import {
  captureAICastControlFlowSnapshot,
  waitForAISharedCastToSettle,
} from "./aiActionCandidateHandlers.js";
import type { AICastRequestSourceZone, AISupportedCardSourceZone } from "./aiActionCandidateTypes.js";
import { isCardAlreadyOnBattlefield, rememberAIFailedSpellCast } from "./aiLandAuraCommander.js";

function getAISourceCards(game: any, playerId: PlayerID, sourceZone: AISupportedCardSourceZone): any[] {
  return getAIHandlerDeps().getAISourceCards(game, playerId, sourceZone);
}

function isAICardStillInCastSourceZone(
  game: any,
  playerId: PlayerID,
  sourceZone: AICastRequestSourceZone,
  cardId: string,
  cardName?: string,
): boolean {
  if (sourceZone === 'command') {
    const commandZone = game?.state?.commandZone?.[playerId];
    const inCommandZone = Array.isArray(commandZone?.inCommandZone)
      ? commandZone.inCommandZone
      : (Array.isArray(commandZone?.commanderIds) ? commandZone.commanderIds : []);
    return inCommandZone.some((entry: any) => {
      const normalized = String(entry || '').trim();
      return normalized === cardId || (cardName && normalized === String(cardName).trim());
    });
  }

  return getAISourceCards(game, playerId, sourceZone).some((entry: any) => String(entry?.id || '') === cardId);
}

export async function requestAISharedCast(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  request: {
    cardId: string;
    cardName?: string;
    sourceZone: AICastRequestSourceZone;
    faceIndex?: number;
    timesKicked?: number;
  },
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  try {
    const cardId = String(request.cardId || '').trim();
    if (!cardId) {
      return false;
    }

    const stackLengthBefore = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const priorityBefore = game.state?.priority;
    const castSnapshotBefore = captureAICastControlFlowSnapshot(gameId, game, playerId);
    let rejectCode: string | undefined;
    const aiSocket = {
      data: { playerId },
      emit: (event: string, payload: any) => {
        if (event === 'error') {
          rejectCode = typeof payload?.code === 'string' ? payload.code : undefined;
          debugWarn(1, '[AI] requestCastSpellForSocket rejected cast:', {
            gameId,
            playerId,
            cardId,
            sourceZone: request.sourceZone,
            payload,
          });
        }
      },
    } as any;

    await requestCastSpellForSocket(io, aiSocket, {
      gameId,
      cardId,
      faceIndex: request.faceIndex,
      fromZone: request.sourceZone,
    }, {
      ...(Number.isFinite(request.timesKicked)
        ? { timesKicked: Math.max(0, Math.floor(Number(request.timesKicked))) }
        : {}),
    });

    await waitForAISharedCastToSettle(gameId, game, playerId, cardId, request.sourceZone, castSnapshotBefore);

    const stackLengthAfter = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const cardStillInSourceZone = isAICardStillInCastSourceZone(
      game,
      playerId,
      request.sourceZone,
      cardId,
      request.cardName,
    );
    const pendingSpellCasts = Object.values(((game.state as any)?.pendingSpellCasts || {})) as any[];
    const hasPendingCast = pendingSpellCasts.some((entry: any) => String(entry?.cardId || '') === cardId);
    const queue = ResolutionQueueManager.getQueue(gameId);
    const hasPendingStep = queue.steps.some((step: any) =>
      String(step?.sourceId || '') === cardId ||
      String(step?.cardId || '') === cardId ||
      String(step?.spellCardId || '') === cardId ||
      String(step?.spellCastContext?.cardId || '') === cardId
    );
    const aiHasPendingSteps = ResolutionQueueManager.playerHasPendingSteps(gameId, playerId);
    const priorityChanged = game.state?.priority !== priorityBefore;

    const progressed =
      stackLengthAfter > stackLengthBefore ||
      !cardStillInSourceZone ||
      hasPendingCast ||
      hasPendingStep ||
      aiHasPendingSteps ||
      priorityChanged;
    if (!progressed) {
      if (rejectCode === 'NO_VALID_TARGETS') {
        rememberAIFailedSpellCast(game, String(playerId), cardId);
      }
      debugWarn(1, '[AI] Shared cast request produced no state change:', {
        gameId,
        playerId,
        cardId,
        cardName: request.cardName,
        sourceZone: request.sourceZone,
        rejectCode,
        stackLengthBefore,
        stackLengthAfter,
        priorityBefore,
        priorityAfter: game.state?.priority,
        aiHasPendingSteps,
      });
    }

    return progressed;
  } catch (error) {
    debugError(1, '[AI] Error casting via shared request flow:', error);
    return false;
  }
}

export async function requestAISharedLandPlay(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  request: {
    cardId: string;
    sourceZone: AISupportedCardSourceZone;
    selectedFaceIndex?: number;
  },
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  const cardId = String(request.cardId || '').trim();
  if (!cardId) return false;

  try {
    const beforeOnBattlefield = isCardAlreadyOnBattlefield(game, playerId, cardId);
    const beforeSourceContains = getAISourceCards(game, playerId, request.sourceZone).some((card: any) => String(card?.id || '') === cardId);
    const beforeLandsPlayed = Number(game.state?.landsPlayedThisTurn?.[playerId] || 0);

    const aiSocket = {
      data: { playerId, gameId },
      rooms: {
        has: (room: string) => String(room || '') === String(gameId),
      },
      emit: (event: string, payload: any) => {
        if (event === 'error') {
          debugWarn(1, '[AI] handlePlayLandRequest rejected land play:', {
            gameId,
            playerId,
            cardId,
            sourceZone: request.sourceZone,
            payload,
          });
        }
      },
    } as any;

    handlePlayLandRequest(io, aiSocket, {
      gameId,
      cardId,
      selectedFace: request.selectedFaceIndex,
      fromZone: request.sourceZone,
    });

    await Promise.resolve();

    const afterOnBattlefield = isCardAlreadyOnBattlefield(game, playerId, cardId);
    const afterSourceContains = getAISourceCards(game, playerId, request.sourceZone).some((card: any) => String(card?.id || '') === cardId);
    const afterLandsPlayed = Number(game.state?.landsPlayedThisTurn?.[playerId] || 0);
    const didPlayLand =
      (!beforeOnBattlefield && afterOnBattlefield) ||
      (beforeSourceContains && !afterSourceContains) ||
      afterLandsPlayed > beforeLandsPlayed;

    if (!didPlayLand) {
      debugWarn(1, '[AI] Shared land request produced no state change:', {
        gameId,
        playerId,
        cardId,
        sourceZone: request.sourceZone,
        beforeOnBattlefield,
        afterOnBattlefield,
        beforeSourceContains,
        afterSourceContains,
        beforeLandsPlayed,
        afterLandsPlayed,
      });
    }

    return didPlayLand;
  } catch (error) {
    debugError(1, '[AI] Error playing land via shared request flow:', error);
    return false;
  }
}
