// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, transformDbEventsForReplay } from "./util";
import { getEvents, truncateEventsForUndo, getEventCount } from "../db";
import GameManager from "../GameManager";
import { createInitialGameState } from "../state/index";

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
 * 4. Creating a fresh game state
 * 5. Replaying the remaining events
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
      console.warn(`[undo] Failed to get event count for game ${gameId}:`, e);
      return { success: false, error: "Database not available" };
    }
    
    if (eventCount === 0) {
      return { success: false, error: "No actions to undo" };
    }
    
    // Calculate how many events to keep
    const eventsToKeep = Math.max(0, eventCount - actionsToUndo);
    
    console.log(`[undo] Performing undo for game ${gameId}: keeping ${eventsToKeep} of ${eventCount} events`);
    
    // Truncate the event log in the database
    try {
      truncateEventsForUndo(gameId, eventsToKeep);
    } catch (e) {
      console.error(`[undo] Failed to truncate events for game ${gameId}:`, e);
      return { success: false, error: "Failed to truncate event log" };
    }
    
    // Get the remaining events
    let remainingEvents: any[];
    try {
      remainingEvents = getEvents(gameId);
    } catch (e) {
      console.warn(`[undo] Failed to get events after truncation:`, e);
      remainingEvents = [];
    }
    
    // Create a fresh game state
    const freshGame = createInitialGameState(gameId);
    
    // Replay the remaining events
    if (remainingEvents.length > 0 && typeof freshGame.replay === "function") {
      // Transform events from DB format to replay format using shared utility
      const replayEvents = transformDbEventsForReplay(remainingEvents);
      
      try {
        freshGame.replay(replayEvents);
        console.log(`[undo] Replayed ${replayEvents.length} events for game ${gameId}`);
      } catch (replayErr) {
        console.error(`[undo] Replay failed for game ${gameId}:`, replayErr);
        return { success: false, error: "Failed to replay events" };
      }
    }
    
    // Replace the game in GameManager with the fresh replayed state
    // We need to update the in-memory game reference properly
    const existingGame = GameManager.getGame(gameId);
    if (existingGame) {
      // Deep copy the fresh game state to avoid shared references
      // We can't just replace the game object because socket handlers hold references to it
      try {
        // Clear existing state properties
        for (const key of Object.keys(existingGame.state)) {
          delete (existingGame.state as any)[key];
        }
        // Use structuredClone for efficient deep cloning (available in Node 17+)
        // Falls back to JSON parse/stringify if not available
        let freshStateClone: any;
        if (typeof structuredClone === 'function') {
          freshStateClone = structuredClone(freshGame.state);
        } else {
          freshStateClone = JSON.parse(JSON.stringify(freshGame.state));
        }
        for (const [key, value] of Object.entries(freshStateClone)) {
          (existingGame.state as any)[key] = value;
        }
      } catch (copyErr) {
        console.warn('[undo] Deep copy failed, falling back to Object.assign:', copyErr);
        Object.assign(existingGame.state, freshGame.state);
      }
      
      // Also update seq if it exists
      if (typeof (freshGame as any).seq !== 'undefined') {
        (existingGame as any).seq = (freshGame as any).seq;
      }
      
      // Bump seq to trigger UI updates
      if (typeof existingGame.bumpSeq === 'function') {
        existingGame.bumpSeq();
      }
    }
    
    return { success: true };
  } catch (err: any) {
    console.error(`[undo] performUndo failed for game ${gameId}:`, err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

export function registerUndoHandlers(io: Server, socket: Socket) {
  // Request an undo
  socket.on("requestUndo", ({ gameId, actionsToUndo = 1 }: { gameId: string; actionsToUndo?: number }) => {
    try {
      // Clean up expired requests periodically
      cleanupExpiredRequests();

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if player is not a spectator
      if (socket.data.spectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_UNDO",
          message: "Spectators cannot request undos",
        });
        return;
      }

      // Check if there's already a pending undo request
      const existingRequest = undoRequests.get(gameId);
      if (existingRequest && existingRequest.status === 'pending') {
        socket.emit("error", {
          code: "UNDO_PENDING",
          message: "There is already a pending undo request",
        });
        return;
      }

      const playerIds = getPlayerIds(game);
      const humanPlayerIds = getHumanPlayerIds(game);
      const aiPlayerIds = getAIPlayerIds(game);
      
      // If single player, auto-approve and perform undo immediately
      if (playerIds.length === 1) {
        // Actually perform the undo
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
        // Don't add the requester twice (they're already auto-approved)
        if (aiId !== playerId) {
          initialApprovals[aiId] = true;
        }
      }

      // Create new undo request
      const request: UndoRequest = {
        id: generateUndoId(),
        requesterId: playerId,
        requesterName: getPlayerName(game, playerId),
        description: `Undo ${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}`,
        actionsToUndo,
        createdAt: Date.now(),
        expiresAt: Date.now() + UNDO_TIMEOUT_MS,
        approvals: initialApprovals, // Requester auto-approves, AI players auto-approve
        status: 'pending',
      };

      // Check if all players have already approved (all non-requester humans are AI)
      if (checkAllApproved(request, playerIds)) {
        request.status = 'approved';
        
        // Actually perform the undo
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

      // Notify all players (only human players need to respond)
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

      // Notify about AI auto-approval if applicable
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

      // Set expiration timer
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

    } catch (err: any) {
      console.error(`requestUndo error for game ${gameId}:`, err);
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

      const playerIds = getPlayerIds(game);
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
      console.error(`respondUndo error for game ${gameId}:`, err);
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
      console.error(`cancelUndo error for game ${gameId}:`, err);
    }
  });
}
