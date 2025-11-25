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
