// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";

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
      
      // If single player or only one human player (rest are AI), auto-approve
      if (playerIds.length === 1 || humanPlayerIds.length === 1) {
        // TODO: Actually perform the undo by replaying events
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}).`,
          ts: Date.now(),
        });
        
        socket.emit("undoComplete", { gameId, success: true });
        broadcastGame(io, game, gameId);
        return;
      }

      // Build initial approvals: requester auto-approves, AI players auto-approve
      const initialApprovals: Record<string, boolean> = { [playerId]: true };
      for (const aiId of aiPlayerIds) {
        initialApprovals[aiId] = true;
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
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}). AI opponents auto-approved.`,
          ts: Date.now(),
        });
        
        socket.emit("undoComplete", { gameId, success: true });
        broadcastGame(io, game, gameId);
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

        // TODO: Actually perform the undo by replaying events
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
