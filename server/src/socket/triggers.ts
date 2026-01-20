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

