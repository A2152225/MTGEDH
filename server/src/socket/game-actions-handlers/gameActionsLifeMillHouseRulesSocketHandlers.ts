/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the contiguous registerGameActions socket handlers for
 * adjustLife, setLife, mill, and setHouseRules.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleAdjustLifeRequest, handleSetLifeRequest,
 * handleMillRequest, handleSetHouseRulesRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { queueLifegainTriggers } from "../../state/modules/triggers/lifegain.js";
import { queueLifeLossTriggers } from "../../state/modules/triggers/life-loss.js";
import { processMillTriggers } from "../../state/modules/zones.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame, getPlayerName } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

export async function handleAdjustLifeRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    delta?: unknown;
    targetPlayerId?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const delta = payload?.delta;
  const targetPlayerId = payload?.targetPlayerId;

  if (!gameId || typeof gameId !== 'string') return;
  if (typeof delta !== 'number') return;
  if (!(targetPlayerId === undefined || typeof targetPlayerId === 'string')) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    // Target player defaults to the acting player
    const targetPid = targetPlayerId || playerId;

    // Ensure life object exists
    if (!game.state.life) {
      game.state.life = {};
    }

    // Get current life (default to starting life)
    const startingLife = (game.state as any).startingLife ?? 40;
    const currentLife = (game.state.life as any)[targetPid] ?? startingLife;
    const newLife = currentLife + delta;

    // Update life total
    (game.state.life as any)[targetPid] = newLife;

    // Also update the ctx.life if it exists (for compatibility with modules)
    if ((game as any).life) {
      (game as any).life[targetPid] = newLife;
    }

    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Persist the event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "adjustLife", { 
        playerId: targetPid, 
        delta,
        oldLife: currentLife,
        newLife,
        by: playerId,
      });
    } catch (e) {
      debugWarn(1, "appendEvent(adjustLife) failed:", e);
    }

    // Emit chat message
    const actionType = delta > 0 ? "gained" : "lost";
    const actionAmount = Math.abs(delta);
    const targetName = getPlayerName(game, targetPid);
    const isOwnLife = targetPid === playerId;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${targetName} ${actionType} ${actionAmount} life. (${currentLife} G�� ${newLife})`,
      ts: Date.now(),
    });

    debug(2, `[adjustLife] ${targetName} ${actionType} ${actionAmount} life (${currentLife} G�� ${newLife}) in game ${gameId}`);

    // Check for lifegain triggers (Ratchet, Ajani's Pridemate, etc.)
    if (delta > 0) {
      try {
        const lifegainTriggers = queueLifegainTriggers(game as any, targetPid, delta, playerId);

        if (lifegainTriggers.length > 0) {
          for (const trigger of lifegainTriggers) {
            // Emit trigger notification
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}_trigger`,
              gameId,
              from: "system",
              message: `Lifegain trigger: ${trigger.sourceName} - ${trigger.effect}`,
              ts: Date.now(),
            });
          }
        }
      } catch (triggerErr) {
        debugWarn(1, "Error detecting lifegain triggers:", triggerErr);
      }
    }

    if (delta < 0) {
      try {
        const lifeLossTriggers = queueLifeLossTriggers(game as any, targetPid, Math.abs(delta), playerId);

        if (lifeLossTriggers.length > 0) {
          for (const trigger of lifeLossTriggers) {
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}_trigger`,
              gameId,
              from: "system",
              message: `Life-loss trigger: ${trigger.sourceName} - ${trigger.effect}`,
              ts: Date.now(),
            });
          }
        }
      } catch (triggerErr) {
        debugWarn(1, "Error detecting life-loss triggers:", triggerErr);
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `adjustLife error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "ADJUST_LIFE_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleSetLifeRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    life?: unknown;
    targetPlayerId?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const life = payload?.life;
  const targetPlayerId = payload?.targetPlayerId;

  if (!gameId || typeof gameId !== 'string') return;
  if (typeof life !== 'number') return;
  if (!(targetPlayerId === undefined || typeof targetPlayerId === 'string')) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    // Target player defaults to the acting player
    const targetPid = targetPlayerId || playerId;

    // Ensure life object exists
    if (!game.state.life) {
      game.state.life = {};
    }

    // Get current life
    const startingLife = (game.state as any).startingLife ?? 40;
    const currentLife = (game.state.life as any)[targetPid] ?? startingLife;

    // Set new life total
    (game.state.life as any)[targetPid] = life;

    // Also update the ctx.life if it exists (for compatibility with modules)
    if ((game as any).life) {
      (game as any).life[targetPid] = life;
    }

    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Persist the event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "setLife", { 
        playerId: targetPid, 
        oldLife: currentLife,
        newLife: life,
        by: playerId,
      });
    } catch (e) {
      debugWarn(1, "appendEvent(setLife) failed:", e);
    }

    // Emit chat message
    const targetName = getPlayerName(game, targetPid);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${targetName}'s life total set to ${life}. (was ${currentLife})`,
      ts: Date.now(),
    });

    debug(2, `[setLife] ${targetName}'s life set to ${life} (was ${currentLife}) in game ${gameId}`);

    // Check for player defeat (life <= 0)
    if (life <= 0) {
      const players = game.state.players || [];
      const activePlayers = players.filter((p: any) => !p.hasLost && !p.eliminated);
      
      // Mark player as eliminated
      const targetPlayer = players.find((p: any) => p.id === targetPid) as any;
      if (targetPlayer) {
        targetPlayer.hasLost = true;
        targetPlayer.eliminated = true;
        targetPlayer.lossReason = "Life total is 0 or less";
      }
      
      // Emit elimination event
      io.to(gameId).emit("playerEliminated", {
        gameId,
        playerId: targetPid,
        playerName: targetName,
        reason: "Life total is 0 or less",
      });
      
      // Check if game is over (only 1 or 0 players remaining)
      const remainingPlayers = activePlayers.filter((p: any) => p.id !== targetPid);
      
      if (remainingPlayers.length === 1) {
        // One player left - they win!
        const winner = remainingPlayers[0];
        const winnerName = getPlayerName(game, winner.id);
        
        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'victory',
          winnerId: winner.id,
          winnerName,
          loserId: targetPid,
          loserName: targetName,
          message: "You've Won!",
        });
        
        // Mark game as over
        (game.state as any).gameOver = true;
        (game.state as any).winner = winner.id;
      } else if (remainingPlayers.length === 0) {
        // No players left - draw
        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'draw',
          message: "Draw!",
        });
        
        (game.state as any).gameOver = true;
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `setLife error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "SET_LIFE_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleMillRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    count?: unknown;
    targetPlayerId?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const count = payload?.count;
  const targetPlayerId = payload?.targetPlayerId;

  if (!gameId || typeof gameId !== 'string') return;
  if (typeof count !== 'number') return;
  if (!(targetPlayerId === undefined || typeof targetPlayerId === 'string')) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    // Target player defaults to the acting player
    const targetPid = targetPlayerId || playerId;

    // Get the target player's zones
    const zones = game.state?.zones?.[targetPid];
    if (!zones) {
      socket.emit("error", {
        code: "ZONES_NOT_FOUND",
        message: "Player zones not found",
      });
      return;
    }

    // Get the library (may be stored differently in different game state formats)
    let library: any[] = [];
    if (typeof (game as any).getLibrary === "function") {
      library = (game as any).getLibrary(targetPid) || [];
    } else if (Array.isArray((zones as any).library)) {
      library = (zones as any).library;
    }

    // Rule 701.17b: Can't mill more than library size
    const actualCount = Math.min(count, library.length);
    if (actualCount <= 0) {
      socket.emit("error", {
        code: "NOTHING_TO_MILL",
        message: "No cards to mill",
      });
      return;
    }

    // Get the top N cards from library
    const millCtx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as any;
    zones.graveyard = zones.graveyard || [];
    const milledCards: any[] = [];
    for (let i = 0; i < actualCount; i++) {
      const card = library.shift();
      if (card) {
        pushCardToPlayerGraveyardWithReplacements(millCtx, String(targetPid), card, zones.graveyard);
        milledCards.push({ ...card, zone: 'graveyard' });
      }
    }

    // Update library count
    zones.libraryCount = library.length;
    zones.graveyardCount = zones.graveyard.length;

    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Persist the event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "mill", { 
        playerId: targetPid, 
        count: actualCount,
        cardIds: milledCards.map((c: any) => c.id),
        by: playerId,
      });
    } catch (e) {
      debugWarn(1, "appendEvent(mill) failed:", e);
    }

    processMillTriggers(game as any, targetPid as any, milledCards, playerId as any);

    // Emit chat message with milled card names
    const targetName = getPlayerName(game, targetPid);
    const cardNames = milledCards
      .filter((c: any) => c?.name)
      .map((c: any) => c.name)
      .slice(0, 5); // Show up to 5 card names
    const moreCount = milledCards.length - cardNames.length;
    
    let millMessage = `${targetName} milled ${actualCount} card${actualCount !== 1 ? 's' : ''}`;
    if (cardNames.length > 0) {
      millMessage += `: ${cardNames.join(', ')}`;
      if (moreCount > 0) {
        millMessage += ` and ${moreCount} more`;
      }
    }
    millMessage += '.';
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: millMessage,
      ts: Date.now(),
    });

    debug(2, `[mill] ${targetName} milled ${actualCount} cards in game ${gameId}`);

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `mill error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "MILL_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleSetHouseRulesRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    houseRules?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const houseRules = payload?.houseRules;

  if (!gameId || typeof gameId !== 'string') return;
  if (!houseRules || typeof houseRules !== 'object' || Array.isArray(houseRules)) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    // Check if we're in PRE_GAME phase
    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
      socket.emit("error", {
        code: "NOT_PREGAME",
        message: "House rules can only be set during pre-game",
      });
      return;
    }

    // Set house rules on the game state
    game.state = (game.state || {}) as any;
    (game.state as any).houseRules = {
      ...(game.state as any).houseRules,
      ...(houseRules as Record<string, unknown>),
    };

    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Persist the event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "setHouseRules", { 
        playerId, 
        houseRules: houseRules as Record<string, unknown>,
        rules: houseRules as Record<string, unknown>,
      });
    } catch (e) {
      debugWarn(1, "appendEvent(setHouseRules) failed:", e);
    }

    // Build a description of enabled rules
    const enabledRules: string[] = [];
    const rules = houseRules as {
      freeFirstMulligan?: boolean;
      freeMulliganNoLandsOrAllLands?: boolean;
      anyCommanderDamageCountsAsCommanderDamage?: boolean;
      groupMulliganDiscount?: boolean;
      immediateConcede?: boolean;
      enableArchenemy?: boolean;
      enablePlanechase?: boolean;
    };
    if (rules.freeFirstMulligan) enabledRules.push("Free First Mulligan");
    if (rules.freeMulliganNoLandsOrAllLands) enabledRules.push("Free Mulligan (No Lands/All Lands)");
    if (rules.anyCommanderDamageCountsAsCommanderDamage) enabledRules.push("Any Commander Damage Counts");
    if (rules.groupMulliganDiscount) enabledRules.push("Group Mulligan Discount");
    if (rules.immediateConcede) enabledRules.push("Immediate Concede");
    if (rules.enableArchenemy) enabledRules.push("Archenemy (NYI)");
    if (rules.enablePlanechase) enabledRules.push("Planechase (NYI)");

    const rulesMessage = enabledRules.length > 0
      ? `House rules enabled: ${enabledRules.join(", ")}`
      : "All house rules disabled.";

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `=��� ${getPlayerName(game, playerId)} updated house rules. ${rulesMessage}`,
      ts: Date.now(),
    });

    debug(2, `[setHouseRules] ${playerId} set house rules for game ${gameId}:`, houseRules);

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `setHouseRules error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "SET_HOUSE_RULES_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
