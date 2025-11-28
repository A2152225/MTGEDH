/**
 * server/src/socket/triggers.ts
 * 
 * Socket handlers for triggered abilities and ETB effects.
 * Handles shock land choices, triggered ability prompts, etc.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";

/**
 * List of shock lands and similar "pay life or enter tapped" lands
 */
const SHOCK_LANDS = new Set([
  "blood crypt",
  "breeding pool",
  "godless shrine",
  "hallowed fountain",
  "overgrown tomb",
  "sacred foundry",
  "steam vents",
  "stomping ground",
  "temple garden",
  "watery grave",
]);

/**
 * Check if a card is a shock land or similar
 */
function isShockLand(cardName: string): boolean {
  return SHOCK_LANDS.has((cardName || "").toLowerCase().trim());
}

/**
 * Register trigger and ETB socket handlers
 */
export function registerTriggerHandlers(io: Server, socket: Socket): void {
  /**
   * Handle shock land ETB choice - pay 2 life for untapped or enter tapped
   */
  socket.on("shockLandChoice", async ({
    gameId,
    permanentId,
    payLife,
  }: {
    gameId: string;
    permanentId: string;
    payLife: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "SHOCK_LAND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Find the permanent
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => 
        p.id === permanentId && p.controller === playerId
      );
      
      if (!permanent) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Permanent not found on battlefield",
        });
        return;
      }

      const cardName = (permanent as any).card?.name || "Land";

      if (payLife) {
        // Pay 2 life to enter untapped
        const currentLife = (game.state as any).life?.[playerId] || 
                           (game as any).life?.[playerId] || 40;
        const newLife = currentLife - 2;
        
        // Update life total
        if ((game.state as any).life) {
          (game.state as any).life[playerId] = newLife;
        }
        if ((game as any).life) {
          (game as any).life[playerId] = newLife;
        }
        
        // Ensure permanent is untapped
        (permanent as any).tapped = false;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} pays 2 life for ${cardName} to enter untapped. (${currentLife} → ${newLife})`,
          ts: Date.now(),
        });
      } else {
        // Enter tapped
        (permanent as any).tapped = true;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)}'s ${cardName} enters the battlefield tapped.`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "shockLandChoice", {
          playerId,
          permanentId,
          payLife,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist shockLandChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${payLife ? "Paid life for" : "Tapped"} ${cardName} for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] shockLandChoice error:`, err);
      socket.emit("error", {
        code: "SHOCK_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle bounce land ETB choice - player selects which land to return to hand
   */
  socket.on("bounceLandChoice", async ({
    gameId,
    bounceLandId,
    returnPermanentId,
  }: {
    gameId: string;
    bounceLandId: string;
    returnPermanentId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "BOUNCE_LAND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state and battlefield exist
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      
      // Find the bounce land permanent
      const battlefield = game.state.battlefield;
      const bounceLand = battlefield.find((p: any) => 
        p.id === bounceLandId && p.controller === playerId
      );
      
      if (!bounceLand) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Bounce land not found on battlefield",
        });
        return;
      }

      // Find the land to return
      const landToReturn = battlefield.find((p: any) => 
        p.id === returnPermanentId && p.controller === playerId
      );
      
      if (!landToReturn) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Land to return not found on battlefield",
        });
        return;
      }

      const bounceLandName = (bounceLand as any).card?.name || "Bounce Land";
      const returnedLandName = (landToReturn as any).card?.name || "Land";

      // Remove the land from battlefield
      const idx = battlefield.indexOf(landToReturn);
      if (idx !== -1) {
        battlefield.splice(idx, 1);
      }

      // Add the land to player's hand
      const zones = game.state?.zones?.[playerId];
      if (zones) {
        zones.hand = zones.hand || [];
        const returnedCard = { ...(landToReturn as any).card, zone: 'hand' };
        (zones.hand as any[]).push(returnedCard);
        zones.handCount = (zones.hand as any[]).length;
      }

      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)}'s ${bounceLandName} returns ${returnedLandName} to hand.`,
        ts: Date.now(),
      });

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "bounceLandChoice", {
          playerId,
          bounceLandId,
          returnPermanentId,
          bounceLandName,
          returnedLandName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist bounceLandChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${bounceLandName} returned ${returnedLandName} to hand for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] bounceLandChoice error:`, err);
      socket.emit("error", {
        code: "BOUNCE_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle triggered ability resolution
   */
  socket.on("resolveTrigger", async ({
    gameId,
    triggerId,
    choice,
  }: {
    gameId: string;
    triggerId: string;
    choice: any;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      // Find the trigger in the trigger queue
      const triggerQueue = (game as any).triggerQueue || [];
      const triggerIndex = triggerQueue.findIndex((t: any) => t.id === triggerId);
      
      if (triggerIndex === -1) {
        socket.emit("error", {
          code: "TRIGGER_NOT_FOUND",
          message: "Trigger not found",
        });
        return;
      }

      const trigger = triggerQueue[triggerIndex];
      
      // Handle based on choice
      if (choice.accepted === false) {
        // Player declined "may" trigger - remove it
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} declines ${trigger.sourceName}'s triggered ability.`,
          ts: Date.now(),
        });
      } else {
        // Execute the trigger effect
        // For now, just put it on the stack
        const stackItem = {
          id: `stack_trigger_${Date.now()}`,
          type: 'ability',
          controller: playerId,
          card: {
            id: trigger.sourceId,
            name: `${trigger.sourceName} (trigger)`,
            type_line: 'Triggered Ability',
            oracle_text: trigger.effect,
          },
          targets: choice.targets || trigger.targets || [],
        };
        
        game.state.stack = game.state.stack || [];
        game.state.stack.push(stackItem as any);
        
        // Remove from trigger queue
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${trigger.sourceName}'s triggered ability goes on the stack.`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "resolveTrigger", {
          playerId,
          triggerId,
          choice,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist resolveTrigger event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] resolveTrigger error:`, err);
      socket.emit("error", {
        code: "RESOLVE_TRIGGER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Skip a triggered ability (for "may" triggers)
   */
  socket.on("skipTrigger", async ({
    gameId,
    triggerId,
  }: {
    gameId: string;
    triggerId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      const triggerQueue = (game as any).triggerQueue || [];
      const triggerIndex = triggerQueue.findIndex((t: any) => t.id === triggerId);
      
      if (triggerIndex !== -1) {
        const trigger = triggerQueue[triggerIndex];
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} skips ${trigger.sourceName}'s triggered ability.`,
          ts: Date.now(),
        });
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] skipTrigger error:`, err);
    }
  });

  /**
   * Handle "sacrifice unless you pay" ETB choice (Transguild Promenade, Gateway Plaza, Rupture Spire)
   * Player can either pay the mana cost or sacrifice the permanent
   */
  socket.on("sacrificeUnlessPayChoice", async ({
    gameId,
    permanentId,
    payMana,
  }: {
    gameId: string;
    permanentId: string;
    payMana: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "SACRIFICE_UNLESS_PAY_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state exists
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      
      // Find the permanent
      const battlefield = game.state.battlefield;
      const permIndex = battlefield.findIndex((p: any) => 
        p.id === permanentId && p.controller === playerId
      );
      
      if (permIndex === -1) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Permanent not found on battlefield",
        });
        return;
      }

      const permanent = battlefield[permIndex];
      const cardName = (permanent as any).card?.name || "Permanent";

      if (payMana) {
        // Player chose to pay - permanent stays on battlefield
        // Note: Mana payment is handled by the client/mana system
        // We just need to acknowledge the choice
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} pays {1} for ${cardName}.`,
          ts: Date.now(),
        });
      } else {
        // Player chose not to pay - sacrifice the permanent
        const card = (permanent as any).card;
        
        // Remove from battlefield
        battlefield.splice(permIndex, 1);
        
        // Move to graveyard
        const zones = game.state?.zones?.[playerId];
        if (zones) {
          zones.graveyard = zones.graveyard || [];
          (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
          zones.graveyardCount = (zones.graveyard as any[]).length;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} sacrifices ${cardName} (didn't pay {1}).`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "sacrificeUnlessPayChoice", {
          playerId,
          permanentId,
          payMana,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist sacrificeUnlessPayChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${payMana ? "Paid for" : "Sacrificed"} ${cardName} for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] sacrificeUnlessPayChoice error:`, err);
      socket.emit("error", {
        code: "SACRIFICE_UNLESS_PAY_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
}

/**
 * Emit shock land prompt to a player
 */
export function emitShockLandPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  imageUrl?: string,
  currentLife?: number
): void {
  emitToPlayer(io, playerId, "shockLandPrompt", {
    gameId,
    permanentId,
    cardName,
    imageUrl,
    currentLife,
  });
}

/**
 * Emit triggered ability prompt to a player
 */
export function emitTriggerPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  trigger: {
    id: string;
    sourceId: string;
    sourceName: string;
    effect: string;
    type: 'may' | 'target' | 'order' | 'choice';
    options?: string[];
    targets?: { id: string; name: string; type: string }[];
    imageUrl?: string;
  }
): void {
  emitToPlayer(io, playerId, "triggerPrompt", {
    gameId,
    trigger,
  });
}

/**
 * Emit "sacrifice unless you pay" prompt to a player
 * Used for cards like Transguild Promenade, Gateway Plaza, Rupture Spire
 */
export function emitSacrificeUnlessPayPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  manaCost: string,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "sacrificeUnlessPayPrompt", {
    gameId,
    permanentId,
    cardName,
    manaCost,
    imageUrl,
  });
}
