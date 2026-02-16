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
  socket.on("emitOpponentMayPayPrompt", (payload?: {
    gameId?: unknown;
    promptId?: unknown;
    sourceName?: unknown;
    sourceController?: unknown;
    decidingPlayer?: unknown;
    manaCost?: unknown;
    declineEffect?: unknown;
    triggerText?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const promptId = payload?.promptId;
    const sourceName = payload?.sourceName;
    const sourceController = payload?.sourceController;
    const decidingPlayer = payload?.decidingPlayer;
    const manaCost = payload?.manaCost;
    const declineEffect = payload?.declineEffect;
    const triggerText = payload?.triggerText;
    const declineEffectText = typeof declineEffect === 'string' ? declineEffect : undefined;
    const triggerTextValue = typeof triggerText === 'string' ? triggerText : undefined;

    if (!gameId || typeof gameId !== 'string') return;
    if (!decidingPlayer || typeof decidingPlayer !== 'string') return;
    if (!sourceName || typeof sourceName !== 'string') return;
    if (!manaCost || typeof manaCost !== 'string') return;

    // This is a high-risk enqueue endpoint; it should never be callable cross-game.
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    // Defense-in-depth: do not allow arbitrary clients to create opponent-pay prompts.
    // This flow should be driven by server-side rules resolution.
    const role = (socket.data as any)?.role;
    const isJudge = role === 'judge';
    if (!isJudge) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

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
      description: triggerTextValue || `${sourceName} triggers: ${getPlayerName(game, decidingPlayer)} may pay ${manaCost}.`,
      mandatory: true,

      // Custom metadata for resolution handler + client UI
      opponentMayPayChoice: true,
      promptId,
      sourceName,
      sourceController,
      decidingPlayer,
      manaCost,
      declineEffect: declineEffectText,
      triggerText: triggerTextValue,
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
          description: declineEffectText || 'Decline to pay',
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
      message: triggerTextValue || `${sourceName} triggers: ${getPlayerName(game, decidingPlayer)} may pay ${manaCost}.`,
      ts: Date.now(),
    });
  });

  /**
   * Set a trigger shortcut preference for auto-responses
   */
  socket.on("setOpponentMayPayShortcut", (payload?: {
    gameId?: unknown;
    sourceName?: unknown;
    preference?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const sourceName = payload?.sourceName;
    const preference = payload?.preference; // 'always_pay' or 'never_pay'

    const pid = socket.data.playerId as PlayerID | undefined;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;
    if (!sourceName || typeof sourceName !== 'string') return;
    if (preference !== 'always_pay' && preference !== 'never_pay') return;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

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
