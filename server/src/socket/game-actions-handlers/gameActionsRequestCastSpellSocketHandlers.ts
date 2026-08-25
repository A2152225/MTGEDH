/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handler for requestCastSpell.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 * requestCastSpell also takes requestCastSpellForSocket because that function
 * still lives in the parent.
 *
 * Public entry symbols: handleRequestCastSpellRequest.
 */
import type { Server, Socket } from "socket.io";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { debug, debugError } from "../../utils/debug.js";
import { emitResolutionStepPrompt } from "../resolution.js";
import { clearHumanAutoPassPauseOnAction, ensureGame } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { findPendingSpellCastStep } from "./gameActionsSpellCastLock.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

// =====================================================================
// REQUEST CAST SPELL - First step of MTG-compliant spell casting
// MTG Rule 601.2: Choose targets (601.2c) before paying costs (601.2h)
// This handler checks if targets are needed and requests them first,
// then triggers payment after targets are selected.
// =====================================================================
export async function handleRequestCastSpellRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  requestCastSpellForSocket: (io: Server, socket: Socket, payload?: { gameId?: unknown; cardId?: unknown; faceIndex?: unknown; fromZone?: unknown }) => Promise<void>,
  payload?: { gameId?: unknown; cardId?: unknown; faceIndex?: unknown; fromZone?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const cardId = payload?.cardId;
  const faceIndex = payload?.faceIndex;
  const fromZone = payload?.fromZone;

  if (!gameId || typeof gameId !== 'string') return;
  if (!cardId || typeof cardId !== 'string') return;
  if (!(faceIndex === undefined || typeof faceIndex === 'number')) return;
  if (!(fromZone === undefined || fromZone === 'hand' || fromZone === 'exile' || fromZone === 'graveyard' || fromZone === 'library' || fromZone === 'command')) return;

  const castFaceIndex = faceIndex as number | undefined;
  const castFromZone = fromZone as SpellCastSourceZone | undefined;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) {
      return;
    }

    if (!ensureInGameRoom(gameId)) return;

    const existingCastStep = findPendingSpellCastStep(gameId, String(playerId), String(cardId));
    if (existingCastStep) {
      debug(2, `[requestCastSpell] Existing cast flow already pending for card ${cardId}; re-emitting step ${existingCastStep.id}`);
      emitResolutionStepPrompt(socket, gameId, existingCastStep);
      return;
    }

    const pendingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    if (pendingSteps.length > 0) {
      const nextPendingStep = pendingSteps[0] as any;
      debug(2, `[requestCastSpell] Pending resolution step ${nextPendingStep.id} blocks starting a new cast for ${cardId}`);
      emitResolutionStepPrompt(socket, gameId, nextPendingStep);
      socket.emit('error', {
        code: 'PENDING_DECISION',
        message: 'Finish the current pending choice before starting another cast.',
      });
      return;
    }

    await requestCastSpellForSocket(io, socket, {
      gameId,
      cardId,
      faceIndex: castFaceIndex,
      fromZone: castFromZone,
    });

    clearHumanAutoPassPauseOnAction(game as any, playerId, 'requestCastSpell');

    // STEP_ADDED already emits resolutionStepPrompt via the per-socket queue handler.
    // Avoid a second emit of the same step � it re-opens CastSpellModal during loop replay
    // after the first prompt was already auto-answered.
    return;
  } catch (err: any) {
    debugError(1, `[requestCastSpell] Error:`, err);
    socket.emit("error", {
      code: "REQUEST_CAST_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

