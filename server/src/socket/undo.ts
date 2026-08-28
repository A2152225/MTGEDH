// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { getEvents, getEventCount } from "../db";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { scheduleAIGameFlow } from "./ai.js";
import {
  buildPlayerNameMap,
  calculateSmartUndoCounts,
  listUndoTurnPhaseTargets,
  performUndo,
  resolveUndoToTurnPhaseCount,
} from "./undo-handlers/index.js";
import type { PersistedEvent, UndoBoundaryPreview } from "./undo-handlers/index.js";

// Boundary detection / smart-undo planning live in ./undo-handlers/undoBoundaryPlanning.ts,
// and the turn/phase jump-target picker in ./undo-handlers/undoTurnPhaseTargets.ts.
// Re-exported here so the "./undo.js" import path keeps working.
export { countSemanticActions, listUndoTurnPhaseTargets } from "./undo-handlers/index.js";
export type { UndoTurnPhaseTarget } from "./undo-handlers/index.js";

/**
 * Undo request state
 */
interface UndoRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  description: string;
  undoScope?: 'step' | 'phase' | 'previousPhase' | 'turn';
  actionsToUndo: number;
  eventCountAtRequest: number;
  boundaryPreview?: UndoBoundaryPreview;
  createdAt: number;
  expiresAt: number;
  approvals: Record<string, boolean>; // playerId -> approved (true) or rejected (false)
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
}

// Store undo requests by gameId - with cleanup on request completion/expiration
const undoRequests = new Map<string, UndoRequest>();

export function clearUndoRequestsForGame(gameId: string): void {
  undoRequests.delete(gameId);
}

// Undo timeout in milliseconds (60 seconds)
const UNDO_TIMEOUT_MS = 60000;

/**
 * Generate unique undo request ID using crypto if available
 */
function generateUndoId(): string {
  // Use crypto.randomUUID() if available for better uniqueness
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `undo_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
    }
  } catch {
    // Fallback to Math.random()
  }
  return `undo_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Clean up old expired requests to prevent memory leaks
 */
function cleanupExpiredRequests(): void {
  const now = Date.now();
  for (const [gameId, request] of undoRequests.entries()) {
    if (request.status !== 'pending' || now > request.expiresAt + 60000) {
      // Remove requests that are not pending or have been expired for over a minute
      undoRequests.delete(gameId);
    }
  }
}

function cancelPendingUndoRequest(io: Server, gameId: string, reason: string): void {
  const request = undoRequests.get(gameId);
  if (!request || request.status !== 'pending') {
    return;
  }

  request.status = 'cancelled';
  undoRequests.delete(gameId);

  io.to(gameId).emit('undoCancelled', {
    gameId,
    undoId: request.id,
    reason,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `Undo request cancelled: ${reason}.`,
    ts: Date.now(),
  });
}

/**
 * Get all non-spectator player IDs from a game
 */
function getPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator)
    .map((p: any) => p.id);
}

/**
 * Get all AI player IDs from a game
 */
function getAIPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator && p.isAI)
    .map((p: any) => p.id);
}

/**
 * Get all human (non-AI) player IDs from a game
 */
function getHumanPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator && !p.isAI)
    .map((p: any) => p.id);
}

/**
 * Check if a player is an AI player
 */
function isAIPlayer(game: any, playerId: string): boolean {
  const players = game.state?.players || [];
  const player = players.find((p: any) => p && p.id === playerId);
  return player?.isAI === true;
}

/**
 * Check if all players have approved
 */
function checkAllApproved(request: UndoRequest, playerIds: string[]): boolean {
  return playerIds.every(id => request.approvals[id] === true);
}

/**
 * Check if any player has rejected
 */
function checkAnyRejected(request: UndoRequest): boolean {
  return Object.values(request.approvals).some(v => v === false);
}


function emitUndoCountsUpdate(io: Server, gameId: string, game: any): void {
  try {
    const eventCount = getEventCount(gameId);
    const events = getEvents(gameId);
    const { stepCount, phaseCount, previousPhaseCount, turnCount, semanticStepCount, semanticPhaseCount, previews } = calculateSmartUndoCounts(game, events);

    io.to(gameId).emit('undoCountUpdate', {
      gameId,
      eventCount,
    });

    io.to(gameId).emit('smartUndoCountsUpdate', {
      gameId,
      stepCount,
      phaseCount,
      previousPhaseCount,
      turnCount,
      semanticStepCount,
      semanticPhaseCount,
      previews,
      totalCount: events.length,
    });
  } catch (err) {
    debugWarn(1, `[undo] Failed to emit updated undo counts for game ${gameId}:`, err);
  }
}

export function resumePregameAIFlowAfterUndo(io: Server, gameId: string, game: any): void {
  try {
    const phase = String((game?.state as any)?.phase || '').toLowerCase();
    if (phase !== 'pre_game' && phase !== 'pre-game' && phase !== '') {
      return;
    }

    const players = Array.isArray(game?.state?.players) ? game.state.players : [];
    for (const player of players) {
      if (!player || player.isAI !== true || player.spectator || player.isSpectator) continue;
      scheduleAIGameFlow(io, gameId, String(player.id) as any, 0);
    }
  } catch (err) {
    debugWarn(1, `[undo] Failed to resume pre-game AI flow for game ${gameId}:`, err);
  }
}

export function registerUndoHandlers(io: Server, socket: Socket) {
  const getUndoRequesterContext = (gameId: string) => {
    const playerId = socket.data.playerId;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);

    const socketGameId = (socket.data as any)?.gameId;
    if (socketGameId && socketGameId !== gameId) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (!socket.rooms.has(gameId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    const game = ensureGame(gameId);
    if (!game || !playerId) return null;

    if (socketIsSpectator) {
      socket.emit("error", {
        code: "SPECTATOR_CANNOT_UNDO",
        message: "Spectators cannot request undos",
      });
      return null;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
    if (!seated) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (seated.isSpectator || seated.spectator) {
      socket.emit("error", {
        code: "SPECTATOR_CANNOT_UNDO",
        message: "Spectators cannot request undos",
      });
      return null;
    }

    const playerIds = getPlayerIds(game);
    if (!playerIds.includes(playerId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    return { game, playerId, playerIds };
  };

  const ensureInGameRoomForRead = (gameId: string): boolean => {
    const socketGameId = (socket.data as any)?.gameId;
    if (socketGameId && socketGameId !== gameId) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return false;
    }

    if (!socket.rooms.has(gameId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return false;
    }

    return true;
  };

  const normalizeActionsToUndo = (gameId: string, raw: unknown): number | null => {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return null;
    const actionsToUndo = Math.floor(num);
    if (actionsToUndo < 1) return null;

    try {
      const eventCount = getEventCount(gameId);
      if (eventCount > 0) {
        return Math.min(actionsToUndo, eventCount);
      }
    } catch {
      // ignore; undo may fail later if DB is unavailable
    }

    return actionsToUndo;
  };

  const handleRequestUndo = async (
    gameId: string,
    rawActionsToUndo: unknown,
    description?: string,
    undoScope?: 'step' | 'phase' | 'previousPhase' | 'turn',
    boundaryPreview?: UndoBoundaryPreview,
  ) => {
    // Clean up expired requests periodically
    cleanupExpiredRequests();

    const ctx = getUndoRequesterContext(gameId);
    if (!ctx) return;

    const actionsToUndo = normalizeActionsToUndo(gameId, rawActionsToUndo);
    if (!actionsToUndo) {
      socket.emit("error", {
        code: "INVALID_UNDO_COUNT",
        message: "Invalid undo count",
      });
      return;
    }

    const { game, playerId, playerIds } = ctx;
    const eventCountAtRequest = getEventCount(gameId);

    // Check if there's already a pending undo request
    const existingRequest = undoRequests.get(gameId);
    if (existingRequest && existingRequest.status === 'pending') {
      socket.emit("error", {
        code: "UNDO_PENDING",
        message: "There is already a pending undo request",
      });
      return;
    }

    const aiPlayerIds = getAIPlayerIds(game);

    // If single player, auto-approve and perform undo immediately
    if (playerIds.length === 1) {
      const undoResult = await performUndo(gameId, actionsToUndo, undefined, io);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}).`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        emitUndoCountsUpdate(io, gameId, game);
        broadcastGame(io, game, gameId, { forceStateReplace: true });
        resumePregameAIFlowAfterUndo(io, gameId, game);
      } else {
        socket.emit("error", {
          code: "UNDO_FAILED",
          message: undoResult.error || "Failed to perform undo",
        });
      }
      return;
    }

    // Build initial approvals: requester auto-approves, AI players auto-approve
    const initialApprovals: Record<string, boolean> = { [playerId]: true };
    for (const aiId of aiPlayerIds) {
      if (aiId !== playerId) initialApprovals[aiId] = true;
    }

    const request: UndoRequest = {
      id: generateUndoId(),
      requesterId: playerId,
      requesterName: getPlayerName(game, playerId),
      description: description || `Undo ${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}`,
      undoScope,
      actionsToUndo,
      eventCountAtRequest,
      boundaryPreview,
      createdAt: Date.now(),
      expiresAt: Date.now() + UNDO_TIMEOUT_MS,
      approvals: initialApprovals,
      status: 'pending',
    };
    const playerNames = buildPlayerNameMap(game);

    // If all approvals are already satisfied, perform immediately.
    if (checkAllApproved(request, playerIds)) {
      request.status = 'approved';
      const undoResult = await performUndo(gameId, actionsToUndo, undefined, io);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}). AI opponents auto-approved.`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        emitUndoCountsUpdate(io, gameId, game);
        broadcastGame(io, game, gameId, { forceStateReplace: true });
        resumePregameAIFlowAfterUndo(io, gameId, game);
      } else {
        socket.emit("error", {
          code: "UNDO_FAILED",
          message: undoResult.error || "Failed to perform undo",
        });
      }
      return;
    }

    undoRequests.set(gameId, request);

    io.to(gameId).emit("undoRequest", {
      gameId,
      undoId: request.id,
      requesterId: playerId,
      requesterName: request.requesterName,
      description: request.description,
      undoScope: request.undoScope,
      actionsToUndo,
      boundaryPreview: request.boundaryPreview,
      expiresAt: request.expiresAt,
      approvals: request.approvals,
      playerIds,
      playerNames,
    });

    const aiApprovalMessage = aiPlayerIds.length > 0
      ? ` AI opponents auto-approved. Waiting for human players.`
      : ` All players must approve.`;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${request.requesterName} requested an undo.${aiApprovalMessage}`,
      ts: Date.now(),
    });

    setTimeout(() => {
      const currentRequest = undoRequests.get(gameId);
      if (currentRequest && currentRequest.id === request.id && currentRequest.status === 'pending') {
        currentRequest.status = 'expired';

        io.to(gameId).emit("undoCancelled", {
          gameId,
          undoId: request.id,
          reason: "Request timed out",
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Undo request expired (not all players responded in time).`,
          ts: Date.now(),
        });
      }
    }, UNDO_TIMEOUT_MS);
  };

  // Request an undo
  socket.on("requestUndo", async (payload?: { gameId?: unknown; actionsToUndo?: unknown }) => {
    const gameId = payload?.gameId;
    const actionsToUndo = payload?.actionsToUndo ?? 1;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      await handleRequestUndo(gameId, actionsToUndo);

    } catch (err: any) {
      debugError(1, `requestUndo error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "UNDO_REQUEST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Respond to an undo request
  socket.on("respondUndo", async (payload?: { gameId?: unknown; undoId?: unknown; approved?: unknown }) => {
    const gameId = payload?.gameId;
    const undoId = payload?.undoId;
    const approved = payload?.approved;

    try {
      if (!gameId || typeof gameId !== 'string' || typeof undoId !== 'string' || typeof approved !== 'boolean') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid undo response payload.' });
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if (socketGameId && socketGameId !== gameId) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      if (!socket.rooms.has(gameId)) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if player is not a spectator
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (socketIsSpectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_RESPOND",
          message: "Spectators cannot respond to undo requests",
        });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      if (!seated) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      if (seated.isSpectator || seated.spectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_RESPOND",
          message: "Spectators cannot respond to undo requests",
        });
        return;
      }

      const playerIds = getPlayerIds(game);
      if (!playerIds.includes(playerId)) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      const request = undoRequests.get(gameId);
      if (!request || request.id !== undoId) {
        socket.emit("error", {
          code: "INVALID_UNDO_REQUEST",
          message: "Invalid or expired undo request",
        });
        return;
      }

      if (request.status !== 'pending') {
        socket.emit("error", {
          code: "UNDO_NOT_PENDING",
          message: "Undo request is no longer pending",
        });
        return;
      }

      // Record the response
      request.approvals[playerId] = approved;
      const playerName = getPlayerName(game, playerId);

      // Check if rejected
      if (!approved) {
        request.status = 'rejected';

        io.to(gameId).emit("undoCancelled", {
          gameId,
          undoId: request.id,
          reason: `${playerName} declined the undo request`,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Undo request declined by ${playerName}.`,
          ts: Date.now(),
        });

        return;
      }

      // Notify of approval
      io.to(gameId).emit("undoUpdate", {
        gameId,
        undoId: request.id,
        approvals: request.approvals,
        playerIds,
      });

      // Check if all approved
      if (checkAllApproved(request, playerIds)) {
        request.status = 'approved';

        // Actually perform the undo by replaying events
        const undoResult = await performUndo(gameId, request.actionsToUndo, request.eventCountAtRequest, io);

        if (undoResult.success) {
          io.to(gameId).emit("undoConfirmed", {
            gameId,
            undoId: request.id,
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Undo approved by all players! ${request.description} undone.`,
            ts: Date.now(),
          });

          emitUndoCountsUpdate(io, gameId, game);
          broadcastGame(io, game, gameId, { forceStateReplace: true });
          resumePregameAIFlowAfterUndo(io, gameId, game);
        } else {
          io.to(gameId).emit("undoCancelled", {
            gameId,
            undoId: request.id,
            reason: undoResult.error || "Failed to perform undo",
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Undo failed: ${undoResult.error || "Unknown error"}`,
            ts: Date.now(),
          });
        }
      } else {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${playerName} approved the undo request.`,
          ts: Date.now(),
        });
      }
    } catch (err: any) {
      debugError(1, `respondUndo error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "UNDO_RESPONSE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  socket.on('disconnect', () => {
    const gameId = typeof (socket.data as any)?.gameId === 'string' ? String((socket.data as any).gameId) : '';
    const playerId = typeof (socket.data as any)?.playerId === 'string' ? String((socket.data as any).playerId) : '';
    if (!gameId || !playerId) {
      return;
    }

    const request = undoRequests.get(gameId);
    if (!request || request.status !== 'pending') {
      return;
    }

    cancelPendingUndoRequest(io, gameId, `${playerId} disconnected while the undo request was pending`);
  });

  // Cancel an undo request (by the requester)
  socket.on("cancelUndo", (payload?: { gameId?: unknown; undoId?: unknown }) => {
    const gameId = payload?.gameId;
    const undoId = payload?.undoId;
    try {
      if (!gameId || typeof gameId !== 'string' || typeof undoId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid cancel undo payload.' });
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if (socketGameId && socketGameId !== gameId) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      if (!socket.rooms.has(gameId)) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (socketIsSpectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_CANCEL",
          message: "Spectators cannot cancel undo requests",
        });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      if (!seated) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      if (seated.isSpectator || seated.spectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_CANCEL",
          message: "Spectators cannot cancel undo requests",
        });
        return;
      }

      const playerIds = getPlayerIds(game);
      if (!playerIds.includes(playerId)) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      const request = undoRequests.get(gameId);
      if (!request || request.id !== undoId) {
        return;
      }

      // Only requester can cancel
      if (request.requesterId !== playerId) {
        socket.emit("error", {
          code: "NOT_REQUESTER",
          message: "Only the requester can cancel an undo request",
        });
        return;
      }

      if (request.status !== 'pending') {
        return;
      }

      request.status = 'cancelled';

      io.to(gameId).emit("undoCancelled", {
        gameId,
        undoId: request.id,
        reason: "Cancelled by requester",
      });

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${request.requesterName} cancelled their undo request.`,
        ts: Date.now(),
      });
    } catch (err: any) {
      debugError(1, `cancelUndo error for game ${gameId}:`, err);
    }
  });

  // Get available undo count (number of events that can be undone)
  socket.on("getUndoCount", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let eventCount = 0;
      try {
        eventCount = getEventCount(gameId);
      } catch (e) {
        debugWarn(1, `[getUndoCount] Failed to get event count for game ${gameId}:`, e);
      }

      socket.emit("undoCountUpdate", {
        gameId,
        eventCount,
      });
    } catch (err: any) {
      debugError(1, `getUndoCount error for game ${gameId}:`, err);
    }
  });

  // Get smart undo counts (step, phase, previous phase, turn)
  socket.on("getSmartUndoCounts", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[getSmartUndoCounts] Failed to get events for game ${gameId}:`, e);
      }

      const { stepCount, phaseCount, previousPhaseCount, turnCount, semanticStepCount, semanticPhaseCount, previews } = calculateSmartUndoCounts(game, events);

      socket.emit("smartUndoCountsUpdate", {
        gameId,
        stepCount,
        phaseCount,
        previousPhaseCount,
        turnCount,
        semanticStepCount,
        semanticPhaseCount,
        previews,
        totalCount: events.length,
      });
    } catch (err: any) {
      debugError(1, `getSmartUndoCounts error for game ${gameId}:`, err);
    }
  });

  // Request undo to step (convenience wrapper)
  socket.on("requestUndoToStep", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToStep] Failed to get events:`, e);
        return;
      }

      const { stepCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        await handleRequestUndo(gameId, actionsToUndo, 'Undo current step', 'step', previews.step);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToStep error for game ${gameId}:`, err);
    }
  });

  // Request undo to phase (convenience wrapper)
  socket.on("requestUndoToPhase", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToPhase] Failed to get events:`, e);
        return;
      }

      const { phaseCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        await handleRequestUndo(gameId, actionsToUndo, 'Undo current phase', 'phase', previews.phase);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to previous phase (convenience wrapper)
  socket.on("requestUndoToPreviousPhase", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToPreviousPhase] Failed to get events:`, e);
        return;
      }

      const { previousPhaseCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        await handleRequestUndo(gameId, actionsToUndo, 'Undo to previous phase', 'previousPhase', previews.previousPhase);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPreviousPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to turn (convenience wrapper)
  socket.on("requestUndoToTurn", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToTurn] Failed to get events:`, e);
        return;
      }

      const { turnCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        await handleRequestUndo(gameId, actionsToUndo, 'Undo current turn', 'turn', previews.turn);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurn error for game ${gameId}:`, err);
    }
  });
  socket.on("getUndoTurnPhaseTargets", (payload?: { gameId?: unknown; includeSteps?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let events: PersistedEvent[] = [];
      try {
        events = getEvents(gameId) as PersistedEvent[];
      } catch (e) {
        debugWarn(1, `[getUndoTurnPhaseTargets] Failed to get events for game ${gameId}:`, e);
      }

      const includeSteps = payload?.includeSteps !== false;
      const targets = listUndoTurnPhaseTargets(game, events, { includeSteps, limit: 200 });
      socket.emit("undoTurnPhaseTargetsUpdate", {
        gameId,
        targets,
      });
    } catch (err: any) {
      debugError(1, `getUndoTurnPhaseTargets error for game ${gameId}:`, err);
    }
  });

  socket.on("requestUndoToTurnPhase", async (payload?: {
    gameId?: unknown;
    turnNumber?: unknown;
    phase?: unknown;
    step?: unknown;
  }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      const phase = typeof payload?.phase === 'string' ? payload.phase.trim() : '';
      if (!phase) {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing phase.' });
        return;
      }
      const turnNumberRaw = Number(payload?.turnNumber);
      const turnNumber = Number.isFinite(turnNumberRaw) && turnNumberRaw > 0 ? turnNumberRaw : undefined;
      const step = typeof payload?.step === 'string' && payload.step.trim() ? payload.step.trim() : undefined;

      let events: PersistedEvent[] = [];
      try {
        events = getEvents(gameId) as PersistedEvent[];
      } catch (e) {
        debugWarn(1, `[requestUndoToTurnPhase] Failed to get events:`, e);
        return;
      }

      const { actionsToUndo, preview } = resolveUndoToTurnPhaseCount(ctx.game, events, {
        turnNumber,
        phase,
        step,
      });
      if (actionsToUndo > 0) {
        const label = preview?.summary
          ? `Undo to ${preview.summary}`
          : `Undo to turn ${turnNumber ?? '?'} / ${phase}`;
        await handleRequestUndo(gameId, actionsToUndo, label, undefined, preview);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurnPhase error for game ${gameId}:`, err);
    }
  });

}

