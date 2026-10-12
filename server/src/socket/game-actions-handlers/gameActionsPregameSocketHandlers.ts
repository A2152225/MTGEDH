/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the pre-game socket handlers - restarting a game (keeping or
 * clearing the roster) and the mulligan actions (keep hand, unkeep hand,
 * mulligan) including the London mulligan bottom selection.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleRestartGameRequest, handleRestartGameClearRequest,
 * handleKeepHandRequest, handleUnkeepHandRequest, handleMulliganRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent, isGameCreator } from "../../db";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import { checkAndPromptOpeningHandActions, isOpeningHandBattlefieldCard } from "../opening-hand";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import { broadcastGame, ensureGame, getPlayerName } from "../util";
import {
  calculateEffectiveMulliganCount,
  checkAllPlayersKeptHands,
  shouldMulliganBeFree,
} from "./gameActionsMulliganReadinessChecks.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

export async function handleRestartGameRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== "string") return;
    const playerId = socket.data?.playerId;
    if (!playerId || typeof playerId !== "string") {
      socket.emit("error", {
        code: "RESTART_NOT_AUTHORIZED",
        message: "Only the game creator can restart the game.",
      });
      return;
    }

    if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
      socket.emit("error", {
        code: "RESTART_NOT_IN_GAME",
        message: "You must be in the game to restart it.",
      });
      return;
    }

    if (!(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit("error", {
        code: "RESTART_NOT_IN_GAME",
        message: "You must be in the game to restart it.",
      });
      return;
    }

    if (!isGameCreator(gameId, playerId)) {
      socket.emit("error", {
        code: "RESTART_NOT_AUTHORIZED",
        message: "Only the game creator can restart the game.",
      });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "RESTART_GAME_NOT_FOUND",
        message: "Game not found.",
      });
      return;
    }
    game.reset(true);
    // Explicitly clear manaPool after restart (reset preserves it for replay scenarios,
    // but restart should always start with no floating mana).
    try {
      (game.state as any).manaPool = undefined;
    } catch {
      /* best effort */
    }
    // Make restarted games start in PRE_GAME to be consistent
    try {
      game.state = (game.state || {}) as any;
      (game.state as any).phase = "pre_game";
    } catch {
      /* best effort */
    }
    appendEvent(gameId, game.seq, "restart", { preservePlayers: true });
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    socket.emit("error", {
      code: "RESTART_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleRestartGameClearRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== "string") return;
    const playerId = socket.data?.playerId;
    if (!playerId || typeof playerId !== "string") {
      socket.emit("error", {
        code: "RESTART_NOT_AUTHORIZED",
        message: "Only the game creator can restart the game.",
      });
      return;
    }

    if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
      socket.emit("error", {
        code: "RESTART_NOT_IN_GAME",
        message: "You must be in the game to restart it.",
      });
      return;
    }

    if (!(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit("error", {
        code: "RESTART_NOT_IN_GAME",
        message: "You must be in the game to restart it.",
      });
      return;
    }

    if (!isGameCreator(gameId, playerId)) {
      socket.emit("error", {
        code: "RESTART_NOT_AUTHORIZED",
        message: "Only the game creator can restart the game.",
      });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "RESTART_GAME_NOT_FOUND",
        message: "Game not found.",
      });
      return;
    }
    game.reset(false);
    // Ensure cleared restart is PRE_GAME as well
    try {
      game.state = (game.state || {}) as any;
      (game.state as any).phase = "pre_game";
    } catch {
      /* best effort */
    }
    appendEvent(gameId, game.seq, "restart", { preservePlayers: false });
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    socket.emit("error", {
      code: "RESTART_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleKeepHandRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    // Allow keeping hand even if we've moved past PRE_GAME
    // This is needed because players might need to keep their hand after the game advances
    // (e.g., if the game moves to UNTAP before all hands are kept)
    const mulliganState = (game.state as any).mulliganState?.[playerId];

    // Check if player has already kept their hand
    if (mulliganState?.hasKeptHand) {
      socket.emit("error", {
        code: "ALREADY_KEPT",
        message: "You have already kept your hand",
      });
      return;
    }

    // If we already asked the player to put cards on bottom, avoid creating duplicate steps
    if (mulliganState?.pendingBottomCount && mulliganState.pendingBottomCount > 0) {
      socket.emit("error", {
        code: "PENDING_BOTTOM_SELECTION",
        message: "You must finish choosing cards to put on the bottom",
      });
      return;
    }

    // Get current mulligan count
    const mulligansTaken = mulliganState?.mulligansTaken || 0;

    // Calculate effective mulligan count based on house rules
    // This accounts for free first mulligan in multiplayer, group mulligan discount, etc.
    const effectiveMulliganCount = calculateEffectiveMulliganCount(mulligansTaken, game, playerId);

    // Track mulligan state - mark as pending bottom selection if mulligans were taken
    game.state = (game.state || {}) as any;
    (game.state as any).mulliganState = (game.state as any).mulliganState || {};

    if (effectiveMulliganCount > 0) {
      // London Mulligan: player must put back cards equal to effective number of mulligans
      // (after applying house rule discounts like free first mulligan or group mulligan)
      const zones = (game.state as any)?.zones?.[playerId];
      const hand = Array.isArray(zones?.hand) ? zones.hand : [];

      const resolutionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.HAND_TO_BOTTOM,
        playerId,
        description: `London Mulligan: Put ${effectiveMulliganCount} card${effectiveMulliganCount > 1 ? 's' : ''} on the bottom of your library (random order).`,
        mandatory: true,
        cardsToBottom: effectiveMulliganCount,
        hand,
        reason: 'mulligan',
      });

      (game.state as any).mulliganState[playerId] = {
        hasKeptHand: false, // Not fully kept yet - need to put cards back
        mulligansTaken,
        pendingBottomCount: effectiveMulliganCount, // Cards to put to bottom after house rule discounts
        pendingBottomStepId: resolutionStep.id,
      };

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Build message with house rule info
      let message = `${getPlayerName(game, playerId)} is choosing ${effectiveMulliganCount} card${effectiveMulliganCount > 1 ? 's' : ''} to put on the bottom of their library`;
      if (effectiveMulliganCount < mulligansTaken) {
        message += ` (${mulligansTaken - effectiveMulliganCount} free mulligan${mulligansTaken - effectiveMulliganCount > 1 ? 's' : ''})`;
      }
      message += '.';

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } else {
      // No cards to put back (either no mulligans or all were free)
      (game.state as any).mulliganState[playerId] = {
        hasKeptHand: true,
        mulligansTaken,
      };

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "keepHand", {
          playerId,
          mulligansTaken,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(keepHand) failed:", e);
      }

      let message = `${getPlayerName(game, playerId)} keeps their hand`;
      if (mulligansTaken > 0 && effectiveMulliganCount === 0) {
        message += ` (${mulligansTaken} free mulligan${mulligansTaken > 1 ? 's' : ''})`;
      }
      message += '.';

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message,
        ts: Date.now(),
      });

      // Check for opening hand actions (Leylines) and prompt if any exist
      checkAndPromptOpeningHandActions(io, game, gameId, playerId);

      broadcastGame(io, game, gameId);
      await tryAutoStartGameFromPreGame(io, game, gameId, 'allHandsKept');
    }
  } catch (err: any) {
    debugError(1, `keepHand error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "KEEP_HAND_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleUnkeepHandRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
      socket.emit("error", {
        code: "NOT_PREGAME",
        message: "Can only reopen your hand during pre-game",
      });
      return;
    }

    const mulliganState = (game.state as any).mulliganState?.[playerId];
    if (!mulliganState?.hasKeptHand) {
      socket.emit("error", {
        code: "HAND_NOT_KEPT",
        message: "Your hand is not currently locked in",
      });
      return;
    }

    const { allKept } = checkAllPlayersKeptHands(game);
    if (allKept) {
      socket.emit("error", {
        code: "PREGAME_LOCKED",
        message: "All players have already locked in their hands",
      });
      return;
    }

    const battlefield = Array.isArray((game.state as any)?.battlefield)
      ? ((game.state as any).battlefield as any[])
      : [];
    const hasResolvedOpeningHandCard = battlefield.some((perm: any) =>
      perm &&
      perm.controller === playerId &&
      isOpeningHandBattlefieldCard(perm.card, playerId, game.state)
    );
    if (hasResolvedOpeningHandCard) {
      socket.emit("error", {
        code: "OPENING_HAND_ACTIONS_RESOLVED",
        message: "Cannot reopen your hand after resolving opening hand actions",
      });
      return;
    }

    try {
      const openingHandSteps = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId)
        .filter((step: any) => step?.type === ResolutionStepType.OPENING_HAND_ACTIONS);
      for (const step of openingHandSteps) {
        try {
          ResolutionQueueManager.cancelStep(gameId, step.id);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    game.state = (game.state || {}) as any;
    (game.state as any).mulliganState = (game.state as any).mulliganState || {};
    (game.state as any).mulliganState[playerId] = {
      ...(mulliganState || {}),
      hasKeptHand: false,
      pendingBottomCount: 0,
      pendingBottomStepId: null,
    };

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, "unkeepHand", {
        playerId,
        mulligansTaken: Number(mulliganState?.mulligansTaken || 0),
      });
    } catch (e) {
      debugWarn(1, "appendEvent(unkeepHand) failed:", e);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} reopens their hand decision.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `unkeepHand error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "UNKEEP_HAND_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleMulliganRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    // Check if we're in PRE_GAME phase
    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
      socket.emit("error", {
        code: "NOT_PREGAME",
        message: "Can only mulligan during pre-game",
      });
      return;
    }

    // Check if player has already kept their hand
    const mulliganState = (game.state as any).mulliganState?.[playerId];
    if (mulliganState?.hasKeptHand) {
      socket.emit("error", {
        code: "ALREADY_KEPT",
        message: "You have already kept your hand",
      });
      return;
    }

    // Get current mulligan count
    const currentMulligans = mulliganState?.mulligansTaken || 0;

    // Check if player can still mulligan (max 7 mulligans = 0 cards)
    if (currentMulligans >= 6) {
      socket.emit("error", {
        code: "MAX_MULLIGANS",
        message: "Cannot mulligan further - you would have 0 cards",
      });
      return;
    }

    // Check if this mulligan is free due to "no lands or all lands" house rule
    const isFreeNoLandsAllLands = shouldMulliganBeFree(game, playerId);

    // Track mulligan state
    game.state = (game.state || {}) as any;
    (game.state as any).mulliganState = (game.state as any).mulliganState || {};

    // If this mulligan is free due to no lands/all lands, don't increment the count
    const newMulliganCount = isFreeNoLandsAllLands ? currentMulligans : currentMulligans + 1;

    (game.state as any).mulliganState[playerId] = {
      hasKeptHand: false,
      mulligansTaken: newMulliganCount,
      // Track if the last mulligan was free (for display purposes)
      lastMulliganWasFree: isFreeNoLandsAllLands,
    };

    // Shuffle hand back into library and draw new hand
    try {
      // Persist the hand return before drawCards() appends the replacement hand.
      // The mulligan marker is written after that draw; replay uses the pair
      // (drawCards with ids, then mulligan) and must see the old hand leave first.
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "handIntoLibrary", { playerId });
      } catch (e) {
        debugWarn(1, "appendEvent(handIntoLibrary) before mulligan failed:", e);
      }

      // Move hand to library
      if (typeof game.moveHandToLibrary === "function") {
        game.moveHandToLibrary(playerId);
      }

      // Shuffle library
      if (typeof game.shuffleLibrary === "function") {
        game.shuffleLibrary(playerId);
      }

      // Draw new hand (7 cards - Commander format has free mulligan, then London mulligan)
      // For simplicity, always draw 7 and put back cards at keep
      const cardsToDraw = 7;
      if (typeof game.drawCards === "function") {
        game.drawCards(playerId, cardsToDraw);
      }
    } catch (e) {
      debugError(1, "Mulligan hand manipulation failed:", e);
      socket.emit("error", {
        code: "MULLIGAN_FAILED",
        message: "Failed to process mulligan",
      });
      return;
    }

    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Persist the event
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "mulligan", { 
        playerId, 
        mulliganNumber: newMulliganCount,
        wasFree: isFreeNoLandsAllLands,
      });
    } catch (e) {
      debugWarn(1, "appendEvent(mulligan) failed:", e);
    }

    // Build the mulligan message
    let mulliganMessage = `${getPlayerName(game, playerId)} mulligans`;
    if (isFreeNoLandsAllLands) {
      mulliganMessage += ` (FREE - no lands/all lands hand)`;
    } else {
      mulliganMessage += ` (mulligan #${newMulliganCount})`;
    }
    mulliganMessage += '.';

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: mulliganMessage,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `mulligan error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "MULLIGAN_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
