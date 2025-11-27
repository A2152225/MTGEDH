/**
 * join-forces.ts
 * 
 * Socket handlers for Join Forces and Tempting Offer cards.
 * These are multiplayer effects where each player can contribute mana
 * or choose to participate in an effect.
 * 
 * Join Forces examples: Collective Voyage, Minds Aglow
 * Tempting Offer examples: Tempt with Discovery, Tempt with Vengeance
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";

/**
 * Pending Join Forces effect waiting for player contributions
 */
interface PendingJoinForces {
  id: string;
  gameId: string;
  initiator: string;
  cardName: string;
  effectDescription: string;
  contributions: Record<string, number>; // playerId -> mana contributed
  responded: Set<string>; // playerIds who have responded
  players: string[]; // all player IDs who can contribute
  timeout?: NodeJS.Timeout;
  createdAt: number;
}

// Store pending Join Forces effects by ID
const pendingJoinForces = new Map<string, PendingJoinForces>();

// Timeout for contributions (60 seconds)
const CONTRIBUTION_TIMEOUT_MS = 60000;

/**
 * Generate unique ID for a Join Forces effect
 */
function generateJoinForcesId(): string {
  return `jf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Check if all players have responded
 */
function allPlayersResponded(pending: PendingJoinForces): boolean {
  return pending.players.every(pid => pending.responded.has(pid));
}

/**
 * Calculate total contributions
 */
function calculateTotalContributions(pending: PendingJoinForces): number {
  return Object.values(pending.contributions).reduce((sum, n) => sum + n, 0);
}

/**
 * Complete a Join Forces effect after all players have responded
 */
function completeJoinForces(io: Server, pending: PendingJoinForces): void {
  const total = calculateTotalContributions(pending);
  
  // Clear timeout
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }
  
  // Notify all players of the result
  io.to(pending.gameId).emit("joinForcesComplete", {
    id: pending.id,
    gameId: pending.gameId,
    cardName: pending.cardName,
    contributions: pending.contributions,
    totalContributions: total,
    initiator: pending.initiator,
  });
  
  // Chat message
  io.to(pending.gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId: pending.gameId,
    from: "system",
    message: `🤝 ${pending.cardName} resolved with ${total} total mana contributed!`,
    ts: Date.now(),
  });
  
  // Clean up
  pendingJoinForces.delete(pending.id);
  
  // Persist the event
  try {
    const game = ensureGame(pending.gameId);
    if (game) {
      appendEvent(pending.gameId, (game as any).seq ?? 0, "joinForcesComplete", {
        id: pending.id,
        cardName: pending.cardName,
        contributions: pending.contributions,
        totalContributions: total,
      });
    }
  } catch (e) {
    console.warn("appendEvent(joinForcesComplete) failed:", e);
  }
}

export function registerJoinForcesHandlers(io: Server, socket: Socket) {
  /**
   * Initiate a Join Forces effect
   */
  socket.on("initiateJoinForces", ({ 
    gameId, 
    cardName, 
    effectDescription,
    cardImageUrl,
  }: { 
    gameId: string; 
    cardName: string; 
    effectDescription: string;
    cardImageUrl?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Get all non-spectator players
      const players = (game.state?.players || [])
        .filter((p: any) => p && !p.spectator)
        .map((p: any) => p.id);
      
      if (players.length === 0) {
        socket.emit("error", {
          code: "JOIN_FORCES_NO_PLAYERS",
          message: "No players available for Join Forces effect.",
        });
        return;
      }

      const id = generateJoinForcesId();
      
      const pending: PendingJoinForces = {
        id,
        gameId,
        initiator: playerId,
        cardName,
        effectDescription,
        contributions: {},
        responded: new Set(),
        players,
        createdAt: Date.now(),
      };
      
      // Initialize contributions to 0
      for (const pid of players) {
        pending.contributions[pid] = 0;
      }
      
      // Set timeout
      pending.timeout = setTimeout(() => {
        // Auto-complete with whatever contributions we have
        console.log(`[joinForces] Timeout for ${id} - completing with partial responses`);
        completeJoinForces(io, pending);
      }, CONTRIBUTION_TIMEOUT_MS);
      
      pendingJoinForces.set(id, pending);
      
      // Notify all players
      io.to(gameId).emit("joinForcesRequest", {
        id,
        gameId,
        initiator: playerId,
        initiatorName: getPlayerName(game, playerId),
        cardName,
        effectDescription,
        cardImageUrl,
        players,
        timeoutMs: CONTRIBUTION_TIMEOUT_MS,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🤝 ${getPlayerName(game, playerId)} casts ${cardName} - all players may contribute mana!`,
        ts: Date.now(),
      });
      
      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "joinForcesInitiated", {
          id,
          cardName,
          initiator: playerId,
          players,
        });
      } catch (e) {
        console.warn("appendEvent(joinForcesInitiated) failed:", e);
      }
    } catch (err: any) {
      console.error(`initiateJoinForces error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "JOIN_FORCES_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Submit a contribution to a Join Forces effect
   */
  socket.on("contributeJoinForces", ({ 
    gameId, 
    joinForcesId, 
    amount,
  }: { 
    gameId: string; 
    joinForcesId: string; 
    amount: number;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const pending = pendingJoinForces.get(joinForcesId);
      if (!pending || pending.gameId !== gameId) {
        socket.emit("error", {
          code: "JOIN_FORCES_NOT_FOUND",
          message: "Join Forces effect not found or expired.",
        });
        return;
      }
      
      if (pending.responded.has(playerId)) {
        socket.emit("error", {
          code: "JOIN_FORCES_ALREADY_RESPONDED",
          message: "You have already contributed to this effect.",
        });
        return;
      }
      
      if (!pending.players.includes(playerId)) {
        socket.emit("error", {
          code: "JOIN_FORCES_NOT_PLAYER",
          message: "You are not a participant in this effect.",
        });
        return;
      }
      
      // Record the contribution
      const contribution = Math.max(0, Math.floor(amount));
      pending.contributions[playerId] = contribution;
      pending.responded.add(playerId);
      
      // Notify all players of the update
      io.to(gameId).emit("joinForcesUpdate", {
        id: joinForcesId,
        gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        contribution,
        responded: Array.from(pending.responded),
        contributions: pending.contributions,
        totalContributions: calculateTotalContributions(pending),
      });
      
      // Check if all players have responded
      if (allPlayersResponded(pending)) {
        completeJoinForces(io, pending);
      }
    } catch (err: any) {
      console.error(`contributeJoinForces error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTRIBUTE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
}

export default registerJoinForcesHandlers;
