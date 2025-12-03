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
import { isAIPlayer } from "./ai.js";

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

// AI response delay (1-3 seconds for natural feel)
const AI_RESPONSE_MIN_MS = 1000;
const AI_RESPONSE_MAX_MS = 3000;

/**
 * Generate unique ID for a Join Forces effect
 */
function generateJoinForcesId(): string {
  return `jf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Calculate AI contribution for Join Forces
 * AI will contribute based on strategy and available mana
 */
function calculateAIJoinForcesContribution(game: any, aiPlayerId: string, cardName: string): number {
  // Get AI's available mana (simplified - count untapped lands)
  const battlefield = game.state?.battlefield || [];
  const aiLands = battlefield.filter((p: any) => 
    p.controller === aiPlayerId && 
    !p.tapped &&
    (p.card?.type_line || '').toLowerCase().includes('land')
  );
  
  const availableMana = aiLands.length;
  
  // AI strategy for contribution:
  // - For beneficial effects (draw, ramp), contribute more
  // - Random factor for unpredictability
  const lowerCardName = cardName.toLowerCase();
  let contributionFactor = 0.3; // Default: contribute ~30% of available mana
  
  if (lowerCardName.includes('minds aglow') || lowerCardName.includes('draw')) {
    contributionFactor = 0.5; // More willing to draw cards
  } else if (lowerCardName.includes('collective voyage') || lowerCardName.includes('land')) {
    contributionFactor = 0.4; // Ramp is valuable
  }
  
  // Add some randomness (0.8x to 1.2x)
  const randomFactor = 0.8 + Math.random() * 0.4;
  
  const contribution = Math.floor(availableMana * contributionFactor * randomFactor);
  
  // Sometimes AI contributes 0 (especially if low on mana)
  if (availableMana <= 2 && Math.random() < 0.5) {
    return 0;
  }
  
  return Math.min(contribution, availableMana);
}

/**
 * Calculate AI decision for Tempting Offer
 * AI will accept based on how beneficial the offer is
 */
function shouldAIAcceptTemptingOffer(game: any, aiPlayerId: string, cardName: string): boolean {
  const lowerCardName = cardName.toLowerCase();
  
  // AI decision factors
  let acceptChance = 0.4; // Default 40% chance to accept
  
  // Tempt with Discovery - searching for lands is usually good
  if (lowerCardName.includes('discovery') || lowerCardName.includes('land')) {
    acceptChance = 0.7;
  }
  // Tempt with Vengeance - tokens are good but helps opponent too
  else if (lowerCardName.includes('vengeance') || lowerCardName.includes('token')) {
    acceptChance = 0.5;
  }
  // Tempt with Reflections - cloning is very situational
  else if (lowerCardName.includes('reflection') || lowerCardName.includes('copy')) {
    acceptChance = 0.3;
  }
  // Tempt with Immortality - reanimation is powerful
  else if (lowerCardName.includes('immortality') || lowerCardName.includes('graveyard')) {
    acceptChance = 0.6;
  }
  
  return Math.random() < acceptChance;
}

/**
 * Process AI responses for a Join Forces effect
 */
function processAIJoinForcesResponses(
  io: Server, 
  pending: PendingJoinForces, 
  game: any
): void {
  let aiPlayerCount = 0;
  
  for (const playerId of pending.players) {
    // Skip if already responded or not an AI
    if (pending.responded.has(playerId)) continue;
    if (!isAIPlayer(pending.gameId, playerId)) continue;
    
    aiPlayerCount++;
    
    // Calculate AI contribution
    const contribution = calculateAIJoinForcesContribution(game, playerId, pending.cardName);
    
    // Delay AI response for natural feel
    const delay = AI_RESPONSE_MIN_MS + Math.random() * (AI_RESPONSE_MAX_MS - AI_RESPONSE_MIN_MS);
    
    console.log(`[joinForces] AI player ${playerId} will respond in ${Math.round(delay)}ms with contribution ${contribution}`);
    
    setTimeout(() => {
      // Check if effect still pending
      const currentPending = pendingJoinForces.get(pending.id);
      if (!currentPending) {
        console.log(`[joinForces] AI ${playerId} response skipped - effect no longer pending`);
        return;
      }
      if (currentPending.responded.has(playerId)) {
        console.log(`[joinForces] AI ${playerId} response skipped - already responded`);
        return;
      }
      
      // Record AI contribution
      currentPending.contributions[playerId] = contribution;
      currentPending.responded.add(playerId);
      
      console.log(`[joinForces] AI ${playerId} contributed ${contribution} mana. Responded: ${currentPending.responded.size}/${currentPending.players.length}`);
      
      // Notify all players
      io.to(pending.gameId).emit("joinForcesUpdate", {
        id: pending.id,
        gameId: pending.gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        contribution,
        responded: Array.from(currentPending.responded),
        contributions: currentPending.contributions,
        totalContributions: Object.values(currentPending.contributions).reduce((sum, n) => sum + n, 0),
      });
      
      io.to(pending.gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: pending.gameId,
        from: "system",
        message: `🤖 ${getPlayerName(game, playerId)} (AI) contributes ${contribution} mana to ${pending.cardName}.`,
        ts: Date.now(),
      });
      
      // Check if all players have responded
      if (allPlayersResponded(currentPending)) {
        console.log(`[joinForces] All players responded - completing effect`);
        completeJoinForces(io, currentPending);
      }
    }, delay);
  }
  
  console.log(`[joinForces] Scheduled ${aiPlayerCount} AI responses for effect ${pending.id}`);
}

/**
 * Process AI responses for a Tempting Offer effect
 */
function processAITemptingOfferResponses(
  io: Server, 
  pending: any, // PendingTemptingOffer but defined later
  game: any,
  pendingMap: Map<string, any>
): void {
  for (const playerId of pending.opponents) {
    // Skip if already responded or not an AI
    if (pending.responded.has(playerId)) continue;
    if (!isAIPlayer(pending.gameId, playerId)) continue;
    
    // Decide if AI accepts
    const accept = shouldAIAcceptTemptingOffer(game, playerId, pending.cardName);
    
    // Delay AI response for natural feel
    const delay = AI_RESPONSE_MIN_MS + Math.random() * (AI_RESPONSE_MAX_MS - AI_RESPONSE_MIN_MS);
    
    setTimeout(() => {
      // Check if effect still pending
      const currentPending = pendingMap.get(pending.id);
      if (!currentPending || currentPending.responded.has(playerId)) return;
      
      // Record AI response
      currentPending.responded.add(playerId);
      if (accept) {
        currentPending.acceptedBy.add(playerId);
      }
      
      // Notify all players
      io.to(pending.gameId).emit("temptingOfferUpdate", {
        id: pending.id,
        gameId: pending.gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        accepted: accept,
        responded: Array.from(currentPending.responded),
        acceptedBy: Array.from(currentPending.acceptedBy),
      });
      
      io.to(pending.gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: pending.gameId,
        from: "system",
        message: accept 
          ? `🤖 ${getPlayerName(game, playerId)} (AI) accepts the tempting offer from ${pending.cardName}!`
          : `🤖 ${getPlayerName(game, playerId)} (AI) declines the tempting offer.`,
        ts: Date.now(),
      });
      
      // Check if all opponents have responded
      if (currentPending.opponents.every((pid: string) => currentPending.responded.has(pid))) {
        // Complete function is defined inside registerJoinForcesHandlers, so we emit an event
        io.to(pending.gameId).emit("_temptingOfferAllResponded", { id: pending.id });
      }
    }, delay);
  }
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
      
      // Process AI player responses automatically
      processAIJoinForcesResponses(io, pending, game);
      
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
      // Note: Mana payment validation is handled client-side via availableMana prop.
      // The server accepts any non-negative amount because Join Forces effects
      // may also allow tapping creatures/artifacts for mana, using mana abilities,
      // or other complex mana sources that the server cannot easily validate.
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

  // ===== TEMPTING OFFER HANDLERS =====
  
  /**
   * Pending Tempting Offer effect waiting for player responses
   */
  interface PendingTemptingOffer {
    id: string;
    gameId: string;
    initiator: string;
    cardName: string;
    effectDescription: string;
    acceptedBy: Set<string>;
    responded: Set<string>;
    opponents: string[];
    timeout?: NodeJS.Timeout;
    createdAt: number;
  }
  
  // Store pending Tempting Offers by ID
  const pendingTemptingOffers = new Map<string, PendingTemptingOffer>();
  
  /**
   * Initiate a Tempting Offer effect
   */
  socket.on("initiateTemptingOffer", ({
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

      // Get all opponents (non-spectator players that are not the initiator)
      const opponents = (game.state?.players || [])
        .filter((p: any) => p && !p.spectator && p.id !== playerId)
        .map((p: any) => p.id);
      
      if (opponents.length === 0) {
        // No opponents - initiator just gets the effect once
        io.to(gameId).emit("temptingOfferComplete", {
          gameId,
          id: `tempt_${Date.now()}`,
          cardName,
          acceptedBy: [],
          initiator: playerId,
          initiatorBonusCount: 1,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🎁 ${cardName} resolved - ${getPlayerName(game, playerId)} gets the effect once (no opponents).`,
          ts: Date.now(),
        });
        return;
      }

      const id = `tempt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      
      const pending: PendingTemptingOffer = {
        id,
        gameId,
        initiator: playerId,
        cardName,
        effectDescription,
        acceptedBy: new Set(),
        responded: new Set(),
        opponents,
        createdAt: Date.now(),
      };
      
      // Set timeout (60 seconds)
      pending.timeout = setTimeout(() => {
        console.log(`[temptingOffer] Timeout for ${id} - completing with partial responses`);
        completeTemptingOffer(io, pending, game);
      }, 60000);
      
      pendingTemptingOffers.set(id, pending);
      
      // Notify all players
      io.to(gameId).emit("temptingOfferRequest", {
        id,
        gameId,
        initiator: playerId,
        initiatorName: getPlayerName(game, playerId),
        cardName,
        effectDescription,
        cardImageUrl,
        opponents,
        timeoutMs: 60000,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎁 ${getPlayerName(game, playerId)} casts ${cardName} - opponents may accept the tempting offer!`,
        ts: Date.now(),
      });
      
      // Process AI opponent responses automatically
      processAITemptingOfferResponses(io, pending, game, pendingTemptingOffers);
      
      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "temptingOfferInitiated", {
          id,
          cardName,
          initiator: playerId,
          opponents,
        });
      } catch (e) {
        console.warn("appendEvent(temptingOfferInitiated) failed:", e);
      }
    } catch (err: any) {
      console.error(`initiateTemptingOffer error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "TEMPTING_OFFER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  // Internal event for completing tempting offer when all AI have responded
  socket.on("_temptingOfferAllResponded", ({ id }: { id: string }) => {
    const pending = pendingTemptingOffers.get(id);
    if (!pending) return;
    const game = ensureGame(pending.gameId);
    if (!game) return;
    completeTemptingOffer(io, pending, game);
  });

  /**
   * Respond to a Tempting Offer
   */
  socket.on("respondTemptingOffer", ({
    gameId,
    temptingOfferId,
    accept,
  }: {
    gameId: string;
    temptingOfferId: string;
    accept: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const pending = pendingTemptingOffers.get(temptingOfferId);
      if (!pending || pending.gameId !== gameId) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_NOT_FOUND",
          message: "Tempting Offer not found or expired.",
        });
        return;
      }
      
      if (pending.responded.has(playerId)) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_ALREADY_RESPONDED",
          message: "You have already responded to this offer.",
        });
        return;
      }
      
      if (!pending.opponents.includes(playerId)) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_NOT_OPPONENT",
          message: "You are not an opponent in this effect.",
        });
        return;
      }
      
      // Record the response
      pending.responded.add(playerId);
      if (accept) {
        pending.acceptedBy.add(playerId);
      }
      
      // Notify all players of the update
      io.to(gameId).emit("temptingOfferUpdate", {
        id: temptingOfferId,
        gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        accepted: accept,
        responded: Array.from(pending.responded),
        acceptedBy: Array.from(pending.acceptedBy),
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: accept 
          ? `✅ ${getPlayerName(game, playerId)} accepts the tempting offer from ${pending.cardName}!`
          : `❌ ${getPlayerName(game, playerId)} declines the tempting offer.`,
        ts: Date.now(),
      });
      
      // Check if all opponents have responded
      if (pending.opponents.every(pid => pending.responded.has(pid))) {
        completeTemptingOffer(io, pending, game);
      }
    } catch (err: any) {
      console.error(`respondTemptingOffer error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "RESPOND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  /**
   * Complete a Tempting Offer effect
   */
  function completeTemptingOffer(io: Server, pending: PendingTemptingOffer, game: any): void {
    const acceptedCount = pending.acceptedBy.size;
    const initiatorBonusCount = 1 + acceptedCount; // Initiator gets effect once + once for each opponent who accepted
    
    // Clear timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    
    // Notify all players of the result
    io.to(pending.gameId).emit("temptingOfferComplete", {
      id: pending.id,
      gameId: pending.gameId,
      cardName: pending.cardName,
      acceptedBy: Array.from(pending.acceptedBy),
      initiator: pending.initiator,
      initiatorBonusCount,
    });
    
    // Chat message
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🎁 ${pending.cardName} resolved! ${getPlayerName(game, pending.initiator)} gets the effect ${initiatorBonusCount} time${initiatorBonusCount !== 1 ? 's' : ''}.${acceptedCount > 0 ? ` ${acceptedCount} opponent${acceptedCount !== 1 ? 's' : ''} also get the effect.` : ''}`,
      ts: Date.now(),
    });
    
    // Clean up
    pendingTemptingOffers.delete(pending.id);
    
    // Persist the event
    try {
      appendEvent(pending.gameId, (game as any).seq ?? 0, "temptingOfferComplete", {
        id: pending.id,
        cardName: pending.cardName,
        acceptedBy: Array.from(pending.acceptedBy),
        initiatorBonusCount,
      });
    } catch (e) {
      console.warn("appendEvent(temptingOfferComplete) failed:", e);
    }
  }
}

export default registerJoinForcesHandlers;
