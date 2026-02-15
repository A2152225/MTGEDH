// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, transformDbEventsForReplay } from "./util";
import { getEvents, truncateEventsForUndo, getEventCount } from "../db";
import GameManager from "../GameManager.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Undo request state
 */
interface UndoRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  description: string;
  actionsToUndo: number;
  createdAt: number;
  expiresAt: number;
  approvals: Record<string, boolean>; // playerId -> approved (true) or rejected (false)
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
}

// Store undo requests by gameId - with cleanup on request completion/expiration
const undoRequests = new Map<string, UndoRequest>();

// Undo timeout in milliseconds (60 seconds)
const UNDO_TIMEOUT_MS = 60000;

// Event types that represent step changes
const STEP_CHANGE_EVENTS = ['nextStep', 'skipToPhase'];

// Event types that represent phase changes
// Note: Currently same as STEP_CHANGE_EVENTS because the game doesn't distinguish 
// between step and phase transitions in the event log. Both 'nextStep' events can 
// represent moving to a new step within a phase OR moving to a new phase entirely.
// The calculateUndoToPhase function handles this by looking for multiple step changes.
const PHASE_CHANGE_EVENTS = ['nextStep', 'skipToPhase'];

// Event types that represent turn changes
const TURN_CHANGE_EVENTS = ['nextTurn'];

/**
 * Calculate how many events to undo to get back to the previous step.
 * This finds the most recent step/phase transition event and undoes back to just before it.
 */
function calculateUndoToStep(events: Array<{ type: string; payload?: any }>): number {
  if (events.length === 0) return 0;
  
  // Search backwards for the most recent step change event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (STEP_CHANGE_EVENTS.includes(event.type)) {
      // Found a step change - undo back to just before this event
      return events.length - i;
    }
  }
  
  // No step change found, return all events
  return events.length;
}

/**
 * Calculate how many events to undo to get back to the previous phase.
 * This finds the most recent phase transition and undoes back to the start of that phase.
 */
function calculateUndoToPhase(events: Array<{ type: string; payload?: any }>): number {
  if (events.length === 0) return 0;
  
  let foundCurrentPhase = false;
  
  // Search backwards for the phase boundary
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (PHASE_CHANGE_EVENTS.includes(event.type)) {
      if (!foundCurrentPhase) {
        // This is the event that started the current step/phase, skip it
        foundCurrentPhase = true;
        continue;
      }
      // Found an earlier phase change - undo back to just before this event
      return events.length - i;
    }
  }
  
  // If we found one phase change but no earlier one, undo to beginning
  if (foundCurrentPhase) {
    return events.length;
  }
  
  // No phase change found, return all events
  return events.length;
}

/**
 * Calculate how many events to undo to get back to the previous turn.
 * This finds the most recent turn transition and undoes back to just before it.
 */
function calculateUndoToTurn(events: Array<{ type: string; payload?: any }>): number {
  if (events.length === 0) return 0;
  
  // Search backwards for the most recent turn change event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (TURN_CHANGE_EVENTS.includes(event.type)) {
      // Found a turn change - undo back to just before this event
      return events.length - i;
    }
  }
  
  // No turn change found, return all events
  return events.length;
}

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

/**
 * Get all non-spectator player IDs from a game
 */
function getPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator)
    .map((p: any) => p.id);
}

/**
 * Get all AI player IDs from a game
 */
function getAIPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && p.isAI)
    .map((p: any) => p.id);
}

/**
 * Get all human (non-AI) player IDs from a game
 */
function getHumanPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isAI)
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

/**
 * Perform the actual undo by:
 * 1. Getting the current event count
 * 2. Calculating how many events to keep
 * 3. Truncating the event log in the database
 * 4. Resetting the existing game state (preserving socket/participant mappings)
 * 5. Replaying the remaining events on the SAME game context
 * 
 * IMPORTANT: We use the existing game's reset + replay methods rather than creating
 * a fresh game. This ensures:
 * - The RNG state is properly reset and re-seeded from the rngSeed event
 * - Libraries (card arrays) are properly rebuilt from deckImportResolved events
 * - Socket/participant mappings are preserved (joinedBySocket, participantsList, etc.)
 * - Life/poison/experience counters are properly restored
 * - All internal context state matches what was replayed
 * 
 * Returns true on success, false on failure
 */
function performUndo(gameId: string, actionsToUndo: number): { success: boolean; error?: string } {
  try {
    // Get current event count
    let eventCount: number;
    try {
      eventCount = getEventCount(gameId);
    } catch (e) {
      debugWarn(1, `[undo] Failed to get event count for game ${gameId}:`, e);
      return { success: false, error: "Database not available" };
    }
    
    if (eventCount === 0) {
      return { success: false, error: "No actions to undo" };
    }
    
    // Calculate how many events to keep
    const eventsToKeep = Math.max(0, eventCount - actionsToUndo);
    
    debug(2, `[undo] Performing undo for game ${gameId}: keeping ${eventsToKeep} of ${eventCount} events`);
    
    // Truncate the event log in the database
    try {
      truncateEventsForUndo(gameId, eventsToKeep);
    } catch (e) {
      debugError(1, `[undo] Failed to truncate events for game ${gameId}:`, e);
      return { success: false, error: "Failed to truncate event log" };
    }
    
    // Get the remaining events
    let remainingEvents: any[];
    try {
      remainingEvents = getEvents(gameId);
    } catch (e) {
      debugWarn(1, `[undo] Failed to get events after truncation:`, e);
      remainingEvents = [];
    }
    
    // Get the existing game - we'll reset and replay on the SAME game context
    // This preserves socket mappings and internal state references
    const existingGame = GameManager.getGame(gameId);
    
    if (!existingGame) {
      debugError(1, `[undo] Game ${gameId} not found in GameManager`);
      return { success: false, error: "Game not found" };
    }
    
    // Save participant mappings before reset (in case reset clears them)
    let savedParticipants: Array<{ socketId: string; playerId: string; spectator: boolean }> = [];
    try {
      if (typeof existingGame.participants === 'function') {
        savedParticipants = existingGame.participants().map((p: any) => ({
          socketId: p.socketId,
          playerId: p.playerId,
          spectator: !!p.spectator,
        }));
      }
    } catch (e) {
      debugWarn(1, '[undo] Failed to save participants:', e);
    }
    
    // Reset the game state while preserving player roster
    // This clears libraries, zones, battlefield, stack, counters, etc.
    // but keeps the player list so replay can work with existing player IDs
    if (typeof existingGame.reset === 'function') {
      try {
        existingGame.reset(true); // preservePlayers = true
        debug(2, `[undo] Reset game state for ${gameId}`);
      } catch (resetErr) {
        debugError(1, `[undo] Reset failed for game ${gameId}:`, resetErr);
        return { success: false, error: "Failed to reset game state" };
      }
    } else {
      debugError(1, `[undo] Game ${gameId} does not have reset method`);
      return { success: false, error: "Game does not support reset" };
    }
    
    // Replay the remaining events on the SAME game context
    // This rebuilds all state including:
    // - RNG seed and state (from rngSeed event)
    // - Libraries (from deckImportResolved events)
    // - Shuffled order (from shuffleLibrary events)  
    // - Hand contents (from drawCards events)
    // - Mulligan results (from mulligan events)
    // - All other game actions
    if (remainingEvents.length > 0 && typeof existingGame.replay === 'function') {
      // Transform events from DB format to replay format using shared utility
      const replayEvents = transformDbEventsForReplay(remainingEvents);
      
      try {
        existingGame.replay(replayEvents);
        debug(2, `[undo] Replayed ${replayEvents.length} events for game ${gameId}`);
      } catch (replayErr) {
        debugError(1, `[undo] Replay failed for game ${gameId}:`, replayErr);
        return { success: false, error: "Failed to replay events" };
      }
    } else if (remainingEvents.length === 0) {
      debug(2, `[undo] No events to replay for game ${gameId} (undid all actions)`);
    }
    
    // Restore participant socket mappings if they were lost during reset
    // This ensures connected clients stay connected after undo
    try {
      if (savedParticipants.length > 0 && typeof existingGame.join === 'function') {
        // Check if participants were preserved
        const currentParticipants = typeof existingGame.participants === 'function' 
          ? existingGame.participants() 
          : [];
        
        // If participants were lost during reset, try to restore them
        if (currentParticipants.length === 0 && savedParticipants.length > 0) {
          debug(2, `[undo] Restoring ${savedParticipants.length} participant(s) for game ${gameId}`);
          for (const p of savedParticipants) {
            if (p.socketId && p.playerId) {
              try {
                existingGame.join(p.socketId, p.playerId, p.spectator, p.playerId);
              } catch (joinErr) {
                debugWarn(1, `[undo] Failed to restore participant ${p.playerId}:`, joinErr);
              }
            }
          }
        }
      }
    } catch (e) {
      debugWarn(1, '[undo] Failed to restore participants:', e);
    }
    
    // Bump seq to trigger UI updates
    if (typeof existingGame.bumpSeq === 'function') {
      existingGame.bumpSeq();
    }
    
    return { success: true };
  } catch (err: any) {
    debugError(1, `[undo] performUndo failed for game ${gameId}:`, err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

export function registerUndoHandlers(io: Server, socket: Socket) {
  const getUndoRequesterContext = (gameId: string) => {
    const playerId = socket.data.playerId;

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

    if (socket.data.spectator) {
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

  const handleRequestUndo = (gameId: string, rawActionsToUndo: unknown) => {
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
      const undoResult = performUndo(gameId, actionsToUndo);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}).`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        broadcastGame(io, game, gameId);
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
      description: `Undo ${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}`,
      actionsToUndo,
      createdAt: Date.now(),
      expiresAt: Date.now() + UNDO_TIMEOUT_MS,
      approvals: initialApprovals,
      status: 'pending',
    };

    // If all approvals are already satisfied, perform immediately.
    if (checkAllApproved(request, playerIds)) {
      request.status = 'approved';
      const undoResult = performUndo(gameId, actionsToUndo);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}). AI opponents auto-approved.`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        broadcastGame(io, game, gameId);
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
      actionsToUndo,
      expiresAt: request.expiresAt,
      approvals: request.approvals,
      playerIds,
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
  socket.on("requestUndo", ({ gameId, actionsToUndo = 1 }: { gameId: string; actionsToUndo?: number }) => {
    try {
      handleRequestUndo(gameId, actionsToUndo);

    } catch (err: any) {
      debugError(1, `requestUndo error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "UNDO_REQUEST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Respond to an undo request
  socket.on("respondUndo", ({ gameId, undoId, approved }: { gameId: string; undoId: string; approved: boolean }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if player is not a spectator
      if (socket.data.spectator) {
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
        const undoResult = performUndo(gameId, request.actionsToUndo);
        
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

          broadcastGame(io, game, gameId);
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

  // Cancel an undo request (by the requester)
  socket.on("cancelUndo", ({ gameId, undoId }: { gameId: string; undoId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      if (socket.data.spectator) {
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
  socket.on("getUndoCount", ({ gameId }: { gameId: string }) => {
    try {
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

  // Get smart undo counts (step, phase, turn)
  socket.on("getSmartUndoCounts", ({ gameId }: { gameId: string }) => {
    try {
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[getSmartUndoCounts] Failed to get events for game ${gameId}:`, e);
      }

      const stepCount = calculateUndoToStep(events);
      const phaseCount = calculateUndoToPhase(events);
      const turnCount = calculateUndoToTurn(events);

      socket.emit("smartUndoCountsUpdate", {
        gameId,
        stepCount,
        phaseCount,
        turnCount,
        totalCount: events.length,
      });
    } catch (err: any) {
      debugError(1, `getSmartUndoCounts error for game ${gameId}:`, err);
    }
  });

  // Request undo to step (convenience wrapper)
  socket.on("requestUndoToStep", ({ gameId }: { gameId: string }) => {
    try {
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToStep] Failed to get events:`, e);
        return;
      }

      const actionsToUndo = calculateUndoToStep(events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToStep error for game ${gameId}:`, err);
    }
  });

  // Request undo to phase (convenience wrapper)
  socket.on("requestUndoToPhase", ({ gameId }: { gameId: string }) => {
    try {
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToPhase] Failed to get events:`, e);
        return;
      }

      const actionsToUndo = calculateUndoToPhase(events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to turn (convenience wrapper)
  socket.on("requestUndoToTurn", ({ gameId }: { gameId: string }) => {
    try {
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToTurn] Failed to get events:`, e);
        return;
      }

      const actionsToUndo = calculateUndoToTurn(events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurn error for game ${gameId}:`, err);
    }
  });
}

