/**
 * server/src/socket/opponent-may-pay.ts
 * 
 * Socket handlers for "opponent may pay" triggered abilities like:
 * - Smothering Tithe (opponent may pay {2})
 * - Rhystic Study (opponent may pay {1})
 * - Mystic Remora (opponent may pay {4})
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";

/**
 * Register opponent may pay socket handlers
 */
export function registerOpponentMayPayHandlers(io: Server, socket: Socket): void {
  /**
   * Emit a payment prompt to an opponent when a "may pay" trigger resolves
   */
  socket.on("emitOpponentMayPayPrompt", ({
    gameId,
    promptId,
    sourceName,
    sourceController,
    decidingPlayer,
    manaCost,
    declineEffect,
    triggerText,
  }) => {
    const game = ensureGame(gameId);
    
    // Get the deciding player's mana pool
    const manaPool = game.state?.manaPool?.[decidingPlayer] || {};
    
    // Emit to the deciding player
    emitToPlayer(io, decidingPlayer, "opponentMayPayPrompt", {
      promptId,
      sourceName,
      sourceController,
      decidingPlayer,
      manaCost,
      declineEffect,
      triggerText,
      availableMana: manaPool,
    });

    // Announce to all players
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${sourceName} triggers: ${getPlayerName(game, decidingPlayer)} may pay ${manaCost}.`,
      ts: Date.now(),
    });
  });

  /**
   * Handle opponent's decision to pay or decline
   */
  socket.on("respondToOpponentMayPay", ({
    gameId,
    promptId,
    willPay,
  }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);

    // Apply the payment/decline event
    game.applyEvent({
      type: "opponentMayPayResolve",
      playerId: pid,
      promptId,
      willPay,
    });

    appendEvent(gameId, game.seq, "opponentMayPayResolve", {
      playerId: pid,
      promptId,
      willPay,
    });

    // The actual effect (draw card, create token, etc.) is handled by
    // the trigger resolution system in the rules engine
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Set a trigger shortcut preference for auto-responses
   */
  socket.on("setOpponentMayPayShortcut", ({
    gameId,
    sourceName,
    preference, // 'always_pay' or 'never_pay'
  }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);

    // Store the shortcut preference
    if (!game.state.triggerShortcuts) {
      game.state.triggerShortcuts = {};
    }
    if (!game.state.triggerShortcuts[pid]) {
      game.state.triggerShortcuts[pid] = [];
    }

    // Remove existing shortcut for this card
    game.state.triggerShortcuts[pid] = game.state.triggerShortcuts[pid].filter(
      (s: { cardName: string; playerId: PlayerID; preference: string }) => 
        s.cardName.toLowerCase() !== sourceName.toLowerCase()
    );

    // Add new shortcut
    game.state.triggerShortcuts[pid].push({
      cardName: sourceName.toLowerCase(),
      playerId: pid,
      preference,
    });

    appendEvent(gameId, game.seq, "setTriggerShortcut", {
      playerId: pid,
      cardName: sourceName,
      preference,
    });

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} set ${sourceName} shortcut: ${preference.replace('_', ' ')}.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  });
}
