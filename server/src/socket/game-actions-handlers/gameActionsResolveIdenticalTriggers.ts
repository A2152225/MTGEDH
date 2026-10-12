/**
 * Socket handler for "Resolve all identical (xN)": the priority holder consents to
 * pass priority for every instance in the run of identical triggers on top of the
 * stack. Other players are still asked through the normal auto-pass rules; the run
 * stops when one of them could respond, a prompt opens, or a new trigger lands on top.
 *
 * Public entry symbols: handleResolveIdenticalTriggersRequest.
 */
import type { Server, Socket } from "socket.io";
import { debugError } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import {
  IDENTICAL_TRIGGER_BULK_MIN_RUN,
  countIdenticalTopTriggerRun,
  emitIdenticalTriggerRunChat,
  isIdenticalTriggerBulkActive,
  runIdenticalTriggerRunAsync,
} from "../identicalTriggerBulkResolve.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

export async function handleResolveIdenticalTriggersRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; count?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== "string") return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;
    if (!ensureInGameRoom(gameId)) return;
    if ((socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (isIdenticalTriggerBulkActive(gameId)) {
      socket.emit("error", { code: "BULK_RESOLVE_ACTIVE", message: "Identical triggers are already resolving" });
      return;
    }

    const state: any = game.state;
    if (!state || String(state.priority || "") !== String(playerId)) {
      socket.emit("error", { code: "NOT_PRIORITY", message: "You don't have priority" });
      return;
    }

    const run = countIdenticalTopTriggerRun(state);
    if (!run.key || run.count < IDENTICAL_TRIGGER_BULK_MIN_RUN) {
      socket.emit("error", {
        code: "NO_IDENTICAL_TRIGGERS",
        message: "The top of the stack is not a run of identical triggers without choices",
      });
      return;
    }

    const requested = Number(payload?.count);
    const maxCount = Number.isFinite(requested) && requested >= 1
      ? Math.min(run.count, Math.floor(requested))
      : run.count;

    // Chunked + yielding: progress events flush and other sockets stay responsive.
    const { resolved } = await runIdenticalTriggerRunAsync(io, game, gameId, {
      key: run.key,
      consentingPlayerId: String(playerId),
      maxCount,
      sourceName: run.sourceName,
    });
    emitIdenticalTriggerRunChat(io, gameId, run.sourceName, resolved);
    if (resolved < maxCount) {
      socket.emit("chat", {
        id: `m_${Date.now()}_bulk_stop`,
        gameId,
        from: "system",
        message: `Resolved ${resolved} of ${maxCount} ${run.sourceName} triggers; stopped because a player can respond, a choice is pending, or a new trigger went on the stack.`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `resolveIdenticalTriggers error for game ${gameId}:`, err);
    socket.emit("error", { code: "RESOLVE_IDENTICAL_ERROR", message: err?.message ?? String(err) });
  }
}
