/**
 * server/src/socket/opponent-may-pay.ts
 * 
 * Socket handlers for "opponent may pay" triggered abilities like:
 * - Smothering Tithe (opponent may pay {2})
 * - Rhystic Study (opponent may pay {1})
 * - Mystic Remora (opponent may pay {4})
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, getOrInitManaPool, resolveManaCostForPoolPayment } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";

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

    // If the deciding player has a shortcut preference, auto-resolve without prompting.
    try {
      const shortcuts = (game.state as any)?.triggerShortcuts?.[decidingPlayer];
      const shortcut = Array.isArray(shortcuts)
        ? shortcuts.find((s: any) => String(s?.cardName || '').toLowerCase() === String(sourceName || '').toLowerCase())
        : null;
      const pref = shortcut?.preference;
      if (pref === 'always_pay' || pref === 'never_pay') {
        let willPay = pref === 'always_pay';

        // Fail closed: if auto-pay is chosen but not affordable, auto-decline.
        if (willPay) {
          try {
            const pool = getOrInitManaPool(game.state as any, decidingPlayer) as any;
            const resolved = resolveManaCostForPoolPayment(pool, String(manaCost || ''));
            if (!resolved.ok) {
              willPay = false;
            }
          } catch {
            willPay = false;
          }
        }

        game.applyEvent({
          type: "opponentMayPayResolve",
          playerId: decidingPlayer,
          promptId,
          willPay,
        });

        appendEvent(gameId, game.seq, "opponentMayPayResolve", {
          playerId: decidingPlayer,
          promptId,
          willPay,
          auto: true,
          sourceName,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${sourceName} triggers: ${getPlayerName(game, decidingPlayer)} auto-${willPay ? 'pays' : 'declines'} ${manaCost}.`,
          ts: Date.now(),
        });

        broadcastGame(io, game, gameId);
        return;
      }
    } catch {
      /* best-effort */
    }
    
    // Get the deciding player's mana pool
    const manaPool = game.state?.manaPool?.[decidingPlayer] || {};

    // Enqueue as a Resolution Queue step
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: decidingPlayer,
      description: triggerText || `${sourceName} triggers: ${getPlayerName(game, decidingPlayer)} may pay ${manaCost}.`,
      mandatory: true,

      // Custom metadata for resolution handler + client UI
      opponentMayPayChoice: true,
      promptId,
      sourceName,
      sourceController,
      decidingPlayer,
      manaCost,
      declineEffect,
      triggerText,
      availableMana: manaPool,

      options: [
        {
          id: 'pay',
          label: `Pay ${manaCost}`,
          description: `Pay ${manaCost}`,
        },
        {
          id: 'decline',
          label: 'Decline',
          description: declineEffect || 'Decline to pay',
        },
      ],
      minSelections: 1,
      maxSelections: 1,
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
