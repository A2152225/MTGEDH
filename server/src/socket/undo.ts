// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, transformDbEventsForReplay, clearScheduledHumanAutoPassForGame, suppressAutomationOnNextBroadcast } from "./util";
import { getEvents, truncateEventsForUndo, getEventCount } from "../db";
import GameManager from "../GameManager.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { createInitialGameState } from "../state/gameState.js";
import { clearScheduledAIActionsForGame } from "./ai.js";

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

export function clearUndoRequestsForGame(gameId: string): void {
  undoRequests.delete(gameId);
}

// Undo timeout in milliseconds (60 seconds)
const UNDO_TIMEOUT_MS = 60000;

type PersistedEvent = { type: string; payload?: any };

function getPhaseBucket(stateAny: any): string {
  const phase = String(stateAny?.phase || '').toLowerCase();
  return phase === 'pre_game' || phase === 'pre-game' || phase === '' ? 'pre_game' : 'live';
}

function getTurnBoundaryKey(stateAny: any): string {
  const rawTurn = Number((stateAny as any)?.turn);
  if (Number.isFinite(rawTurn) && rawTurn > 0) {
    return `turn:${rawTurn}`;
  }
  return `turn:${getPhaseBucket(stateAny)}`;
}

function getPhaseBoundaryKey(stateAny: any): string {
  return `${getTurnBoundaryKey(stateAny)}|phase:${String(stateAny?.phase || '').toLowerCase()}`;
}

function getStepBoundaryKey(stateAny: any): string {
  return `${getPhaseBoundaryKey(stateAny)}|step:${String(stateAny?.step || '').toUpperCase()}`;
}

function calculateBoundaryUndoCount(
  events: PersistedEvent[],
  game: any,
  getBoundaryKey: (stateAny: any) => string,
): number {
  if (events.length === 0) return 0;

  const currentState = (game?.state || {}) as any;
  const liveBoundaryKey = getBoundaryKey(currentState);
  if (!liveBoundaryKey) return 0;

  const replayEvents = transformDbEventsForReplay(events as any);
  const scratch = createInitialGameState(`undo_probe_${game?.gameId || 'game'}`);
  const boundaryEntryIndices = new Map<string, number>();
  let previousBoundaryKey = getBoundaryKey((scratch as any).state || {});
  boundaryEntryIndices.set(previousBoundaryKey, -1);

  for (let index = 0; index < replayEvents.length; index++) {
    scratch.applyEvent(replayEvents[index] as any);
    const nextBoundaryKey = getBoundaryKey((scratch as any).state || {});
    if (nextBoundaryKey !== previousBoundaryKey) {
      boundaryEntryIndices.set(nextBoundaryKey, index);
    }
    previousBoundaryKey = nextBoundaryKey;
  }

  let targetBoundaryKey = liveBoundaryKey;
  let entryIndex = boundaryEntryIndices.get(targetBoundaryKey);

  if (entryIndex === undefined) {
    targetBoundaryKey = previousBoundaryKey;
    entryIndex = boundaryEntryIndices.get(targetBoundaryKey) ?? -1;
    debugWarn(1, `[undo] Failed to locate live boundary ${liveBoundaryKey}; using replay boundary ${targetBoundaryKey}`);
  }

  return Math.max(0, replayEvents.length - (entryIndex + 1));
}

function calculateSmartUndoCounts(game: any, events: PersistedEvent[]): { stepCount: number; phaseCount: number; turnCount: number } {
  if (!game || events.length === 0) {
    return { stepCount: 0, phaseCount: 0, turnCount: 0 };
  }

  return {
    stepCount: calculateBoundaryUndoCount(events, game, getStepBoundaryKey),
    phaseCount: calculateBoundaryUndoCount(events, game, getPhaseBoundaryKey),
    turnCount: calculateBoundaryUndoCount(events, game, getTurnBoundaryKey),
  };
}

function buildPlayerNameMap(game: any): Record<string, string> {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const playerNames: Record<string, string> = {};
  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    playerNames[playerId] = String(player?.name || playerId);
  }
  return playerNames;
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
    clearScheduledHumanAutoPassForGame(gameId);
    clearScheduledAIActionsForGame(gameId);

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
          spectator: !!(p.spectator || p.isSpectator),
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

    suppressAutomationOnNextBroadcast(existingGame as any);

    void import('./ai.js').then((aiModule) => {
      if (typeof aiModule.rehydrateAIGameRuntime === 'function') {
        aiModule.rehydrateAIGameRuntime(gameId, { refreshDeckProfiles: true });
      }
    }).catch((err) => {
      debugWarn(1, `[undo] Failed to rehydrate AI runtime for game ${gameId}:`, err);
    });
    
    return { success: true };
  } catch (err: any) {
    debugError(1, `[undo] performUndo failed for game ${gameId}:`, err);
    return { success: false, error: err?.message || "Unknown error" };
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

  const handleRequestUndo = (gameId: string, rawActionsToUndo: unknown, description?: string) => {
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
      description: description || `Undo ${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}`,
      actionsToUndo,
      createdAt: Date.now(),
      expiresAt: Date.now() + UNDO_TIMEOUT_MS,
      approvals: initialApprovals,
      status: 'pending',
    };
    const playerNames = buildPlayerNameMap(game);

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
  socket.on("requestUndo", (payload?: { gameId?: unknown; actionsToUndo?: unknown }) => {
    const gameId = payload?.gameId;
    const actionsToUndo = payload?.actionsToUndo ?? 1;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
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
  socket.on("respondUndo", (payload?: { gameId?: unknown; undoId?: unknown; approved?: unknown }) => {
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

  // Get smart undo counts (step, phase, turn)
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

      const { stepCount, phaseCount, turnCount } = calculateSmartUndoCounts(game, events);

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
  socket.on("requestUndoToStep", (payload?: { gameId?: unknown }) => {
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

      const { stepCount: actionsToUndo } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current step');
      }
    } catch (err: any) {
      debugError(1, `requestUndoToStep error for game ${gameId}:`, err);
    }
  });

  // Request undo to phase (convenience wrapper)
  socket.on("requestUndoToPhase", (payload?: { gameId?: unknown }) => {
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

      const { phaseCount: actionsToUndo } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current phase');
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to turn (convenience wrapper)
  socket.on("requestUndoToTurn", (payload?: { gameId?: unknown }) => {
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

      const { turnCount: actionsToUndo } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current turn');
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurn error for game ${gameId}:`, err);
    }
  });
}

