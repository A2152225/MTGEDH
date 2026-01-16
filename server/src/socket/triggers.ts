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
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Register trigger and ETB socket handlers
 */
export function registerTriggerHandlers(io: Server, socket: Socket): void {
  // NOTE: Legacy handlers for Mox Diamond and bounce lands have been removed.
  // These interactions are now handled via the Resolution Queue.

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
      const triggerQueue = (game.state as any)?.triggerQueue || [];
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
      if (choice?.accepted === false) {
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
          type: "ability",
          controller: playerId,
          card: {
            id: trigger.sourceId,
            name: `${trigger.sourceName} (trigger)`,
            type_line: "Triggered Ability",
            oracle_text: trigger.effect,
          },
          targets: choice?.targets || trigger.targets || [],
        };

        (game.state as any).stack = (game.state as any).stack || [];
        (game.state as any).stack.push(stackItem);

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
        debugWarn(1, "[triggers] Failed to persist resolveTrigger event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `[triggers] resolveTrigger error:`, err);
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

      const triggerQueue = (game.state as any)?.triggerQueue || [];
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
      debugError(1, `[triggers] skipTrigger error:`, err);
    }
  });

  // ========================================================================
  // NOTE: The legacy orderTriggers handler has been removed.
  // Trigger ordering is now handled by the Resolution Queue system
  // via submitResolutionResponse. See resolution.ts handleTriggerOrderResponse.
  // ========================================================================

  // ========================================================================
  // NOTE: The legacy kynaiosChoiceResponse handler has been removed.
  // Kynaios and Tiro choices are now handled by the Resolution Queue system
  // via submitResolutionResponse. See resolution.ts handleKynaiosChoiceResponse.
  // ========================================================================
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
 * Emit Mimic Vat trigger prompt to a player
 * When a nontoken creature dies, the Mimic Vat controller can exile it
 */
export function emitMimicVatPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  mimicVatId: string,
  mimicVatName: string,
  dyingCreatureId: string,
  dyingCreatureName: string,
  dyingCreatureCard: any,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "mimicVatTrigger", {
    gameId,
    mimicVatId,
    mimicVatName,
    dyingCreatureId,
    dyingCreatureName,
    dyingCreatureCard,
    imageUrl: dyingCreatureCard?.image_uris?.small || dyingCreatureCard?.image_uris?.normal || imageUrl,
    description: `${dyingCreatureName} died. You may exile it imprinted on ${mimicVatName}.`,
  });
}

/**
 * Emit Kroxa-style auto-sacrifice prompt
 * When a creature enters without its alternate cost (Escape), it sacrifices itself
 */
export function emitAutoSacrificeTrigger(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  reason: string,
  timing: 'immediate' | 'end_step',
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "autoSacrificeTrigger", {
    gameId,
    permanentId,
    cardName,
    reason,
    timing,
    imageUrl,
  });
}

/**
 * Emit devotion mana prompt
 * For cards like Karametra's Acolyte that add mana based on devotion
 */
export function emitDevotionManaPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  devotionCount: number,
  manaColor: string,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "devotionManaActivated", {
    gameId,
    permanentId,
    cardName,
    devotionCount,
    manaColor,
    manaAdded: devotionCount,
    imageUrl,
    message: `${cardName} adds ${devotionCount} ${manaColor} mana (devotion)`,
  });
}

