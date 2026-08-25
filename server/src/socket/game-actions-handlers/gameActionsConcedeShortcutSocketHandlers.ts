/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handlers for concede and
 * setTriggerShortcut.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleConcedeRequest, handleSetTriggerShortcutRequest.
 */
import type { Server, Socket } from "socket.io";
import {
  SHORTCUT_ELIGIBLE_TRIGGERS,
  isTriggerShortcutPreferenceAllowed,
  isTriggerShortcutType,
  type TriggerShortcut,
} from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame, getPlayerName } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";


/**
 * Handle player conceding the game.
 * 
 * When a player concedes:
 * 1. They are marked as eliminated/conceded immediately
 * 2. Their permanents remain on the battlefield until their next turn would begin
 * 3. On their next turn, all their permanents are exiled and their turn is skipped
 * 4. If only one player remains, that player wins
 */
export async function handleConcedeRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;

    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const players = game.state?.players || [];
    const player = players.find((p: any) => p.id === playerId);
    
    if (!player) {
      socket.emit("error", { code: "CONCEDE_ERROR", message: "Player not found" });
      return;
    }

    // Check if player already conceded or is eliminated
    if ((player as any).hasLost || (player as any).eliminated) {
      socket.emit("error", { code: "CONCEDE_ERROR", message: "You have already left the game" });
      return;
    }

    const playerName = player.name || playerId;
    const immediateConcede = Boolean((game.state as any)?.houseRules?.immediateConcede);

    if (immediateConcede) {
      const battlefield = game.state.battlefield || [];
      const concedingPermanents = battlefield.filter((permanent: any) => permanent.controller === playerId);

      if (concedingPermanents.length > 0) {
        const zones = (game.state as any).zones = (game.state as any).zones || {};
        const playerZones = zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
        (playerZones as any).exile = (playerZones as any).exile || [];

        for (const perm of concedingPermanents) {
          (playerZones as any).exile.push({
            id: perm.id,
            ...perm.card,
            zone: 'exile',
          });
        }

        game.state.battlefield = battlefield.filter((permanent: any) => permanent.controller !== playerId);
      }

      (player as any).hasLost = true;
      (player as any).eliminated = true;
      (player as any).lossReason = 'Conceded';
      delete (player as any).conceded;
      delete (player as any).concededAt;
      (player as any).departureMode = 'concede';

      const stateAny = game.state as any;
      if (stateAny.autoPassForTurn && typeof stateAny.autoPassForTurn === 'object') {
        delete stateAny.autoPassForTurn[playerId];
      }
      if (stateAny.autoPassPlayers instanceof Set) {
        stateAny.autoPassPlayers.delete(playerId);
      }
      if (stateAny.priorityClaimed instanceof Set) {
        stateAny.priorityClaimed.delete(playerId);
      }
      if (String(stateAny._pauseHumanAutoPassUntilActionFor || '') === String(playerId)) {
        delete stateAny._pauseHumanAutoPassUntilActionFor;
      }
      if (!(stateAny.eliminationNotifications instanceof Set)) {
        stateAny.eliminationNotifications = new Set<string>();
      }
      stateAny.eliminationNotifications.add(playerId);

      io.to(gameId).emit("playerConceded", {
        gameId,
        playerId,
        playerName,
        message: `${playerName} has conceded the game. Their permanents were removed immediately.`,
      });

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `=�Ŧn+� ${playerName} has conceded the game immediately.`,
        ts: Date.now(),
      });

      if (game.state.priority === playerId) {
        const turnOrder = game.state.turnOrder || players.filter((p: any) => !p.isSpectator).map((p: any) => p.id);
        const currentIndex = turnOrder.indexOf(playerId);

        for (let i = 1; i < turnOrder.length; i++) {
          const nextIndex = (currentIndex + i) % turnOrder.length;
          const nextPlayerId = turnOrder[nextIndex];
          const nextPlayer = players.find((p: any) => p.id === nextPlayerId);
          if (nextPlayer && !(nextPlayer as any).hasLost && !(nextPlayer as any).eliminated && !(nextPlayer as any).conceded && !(nextPlayer as any).isSpectator) {
            game.state.priority = nextPlayerId;
            break;
          }
        }
      }

      const activePlayers = players.filter((p: any) =>
        !p.hasLost && !p.eliminated && !p.conceded && !p.isSpectator
      );

      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        const winnerName = winner.name || winner.id;

        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'victory',
          winnerId: winner.id,
          winnerName,
          loserId: playerId,
          loserName: playerName,
          message: `${winnerName} wins! All opponents have conceded.`,
        });

        (game.state as any).gameOver = true;
        (game.state as any).winner = winner.id;
      } else if (activePlayers.length === 0) {
        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'draw',
          message: "All players have conceded. The game is a draw.",
        });

        (game.state as any).gameOver = true;
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, "concede", { playerId, playerName, immediate: true });
      } catch (e) {
        debugWarn(1, "appendEvent(concede) failed:", e);
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, "concededPlayerCleanup", { playerId, lossReason: 'Conceded' });
      } catch (e) {
        debugWarn(1, "appendEvent(concededPlayerCleanup) failed:", e);
      }

      broadcastGame(io, game, gameId);
      debug(2, `[concede] Player ${playerName} (${playerId}) conceded immediately in game ${gameId}`);
      return;
    }

    // Mark player as conceded - field cleanup happens on their next turn
    (player as any).conceded = true;
    (player as any).concededAt = Date.now();
    (player as any).departureMode = "concede";
    // Note: We do NOT set hasLost or eliminated yet - that happens when their turn would start
    // This allows their permanents to remain on the field for other players to interact with

    const stateAny = game.state as any;
    if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== "object") {
      stateAny.autoPassForTurn = {};
    }
    stateAny.autoPassForTurn[playerId] = true;

    if (stateAny.priorityClaimed instanceof Set) {
      stateAny.priorityClaimed.delete(playerId);
    }

    if (String(stateAny._pauseHumanAutoPassUntilActionFor || "") === String(playerId)) {
      delete stateAny._pauseHumanAutoPassUntilActionFor;
    }

    // Emit concede event
    io.to(gameId).emit("playerConceded", {
      gameId,
      playerId,
      playerName,
      message: `${playerName} has conceded the game. Their permanents will be removed at the start of their next turn.`,
    });

    // Notify via chat
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `=�Ŧn+� ${playerName} has conceded the game.`,
      ts: Date.now(),
    });

    // Check the remaining player count (excluding conceded players)
    const activePlayers = players.filter((p: any) => 
      !p.hasLost && !p.eliminated && !p.conceded && !p.isSpectator
    );

    // If the conceding player currently has priority, pass it to the next player
    if (game.state.priority === playerId) {
      const turnOrder = game.state.turnOrder || players.filter((p: any) => !p.isSpectator).map((p: any) => p.id);
      const currentIndex = turnOrder.indexOf(playerId);
      
      // Find next active player in turn order
      for (let i = 1; i < turnOrder.length; i++) {
        const nextIndex = (currentIndex + i) % turnOrder.length;
        const nextPlayerId = turnOrder[nextIndex];
        const nextPlayer = players.find((p: any) => p.id === nextPlayerId);
        if (nextPlayer && !(nextPlayer as any).hasLost && !(nextPlayer as any).eliminated && !(nextPlayer as any).conceded && !(nextPlayer as any).isSpectator) {
          game.state.priority = nextPlayerId;
          break;
        }
      }
    }

    // If only one active player remains, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const winnerName = winner.name || winner.id;

      io.to(gameId).emit("gameOver", {
        gameId,
        type: 'victory',
        winnerId: winner.id,
        winnerName,
        loserId: playerId,
        loserName: playerName,
        message: `${winnerName} wins! All opponents have conceded.`,
      });

      (game.state as any).gameOver = true;
      (game.state as any).winner = winner.id;
    } else if (activePlayers.length === 0) {
      // All players conceded - draw
      io.to(gameId).emit("gameOver", {
        gameId,
        type: 'draw',
        message: "All players have conceded. The game is a draw.",
      });

      (game.state as any).gameOver = true;
    }

    // Persist the concede event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "concede", { playerId, playerName });
    } catch (e) {
      debugWarn(1, "appendEvent(concede) failed:", e);
    }

    broadcastGame(io, game, gameId);

    debug(2, `[concede] Player ${playerName} (${playerId}) conceded in game ${gameId}`);
  } catch (err: any) {
    debugError(1, `concede error for game ${gameId}:`, err);
    socket.emit("error", { code: "CONCEDE_ERROR", message: err?.message ?? String(err) });
  }
}

/**
 * Set a trigger shortcut preference for a player.
 * This allows players to set automatic responses for "may" triggers
 * and "opponent may pay" triggers like Smothering Tithe.
 */
export async function handleSetTriggerShortcutRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    cardName?: unknown;
    preference?: unknown;
    triggerDescription?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const cardName = payload?.cardName;
  const preference = payload?.preference;
  const triggerDescription = payload?.triggerDescription;

  if (!gameId || typeof gameId !== 'string') return;
  if (!cardName || typeof cardName !== 'string') return;
  if (!isTriggerShortcutType(preference)) return;
  if (!(triggerDescription === undefined || typeof triggerDescription === 'string')) return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId as string | undefined;

    if (!game || !playerId) {
      socket.emit("error", {
        code: "SET_TRIGGER_SHORTCUT_ERROR",
        message: "Game not found or player not identified",
      });
      return;
    }

    // Initialize trigger shortcuts if needed
    game.state.triggerShortcuts = game.state.triggerShortcuts || {};
    game.state.triggerShortcuts[playerId] = game.state.triggerShortcuts[playerId] || [];

    // Normalize card name for matching
    const normalizedCardName = cardName.toLowerCase().trim();
    const eligibleTrigger = SHORTCUT_ELIGIBLE_TRIGGERS[normalizedCardName];
    if (!eligibleTrigger) {
      socket.emit("error", {
        code: "SET_TRIGGER_SHORTCUT_ERROR",
        message: `Unknown trigger shortcut source: ${cardName}`,
      });
      return;
    }

    if (!isTriggerShortcutPreferenceAllowed(eligibleTrigger.type, preference)) {
      socket.emit("error", {
        code: "SET_TRIGGER_SHORTCUT_ERROR",
        message: `Preference ${String(preference)} is not valid for ${cardName}`,
      });
      return;
    }

    // Find existing shortcut for this card
    const existingIndex = game.state.triggerShortcuts[playerId].findIndex(
      (s: TriggerShortcut) => s.cardName === normalizedCardName && 
                  (!triggerDescription || s.triggerDescription === triggerDescription)
    );

    if (preference === 'ask_each_time') {
      // Remove the shortcut if setting to default
      if (existingIndex >= 0) {
        game.state.triggerShortcuts[playerId].splice(existingIndex, 1);
      }
    } else {
      // Add or update the shortcut
      const normalizedPreference = preference;
      const normalizedTriggerDescription = triggerDescription as string | undefined;
      const shortcut = {
        cardName: normalizedCardName,
        playerId,
        preference: normalizedPreference,
        triggerDescription: normalizedTriggerDescription,
      };

      if (existingIndex >= 0) {
        game.state.triggerShortcuts[playerId][existingIndex] = shortcut;
      } else {
        game.state.triggerShortcuts[playerId].push(shortcut);
      }
    }

    // Notify the player
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} set shortcut for ${cardName}: ${preference.replace(/_/g, ' ')}`,
      ts: Date.now(),
    });

    // Persist the event
    try {
      await appendEvent(gameId, (game as any).seq || 0, "setTriggerShortcut", {
        playerId,
        cardName: normalizedCardName,
        preference,
        triggerDescription,
      });
    } catch (e) {
      debugWarn(1, "[game-actions] Failed to persist setTriggerShortcut event:", e);
    }

    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    broadcastGame(io, game, gameId);

    debug(2, `[setTriggerShortcut] Player ${playerId} set ${cardName} preference to ${preference}`);

  } catch (err: any) {
    debugError(1, `setTriggerShortcut error for game ${gameId}:`, err);
    socket.emit("error", { code: "SET_TRIGGER_SHORTCUT_ERROR", message: err?.message ?? String(err) });
  }
}

