/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the socket handlers that drive turn flow - claiming the turn
 * pre-game, randomizing the starting player, advancing turn/step, and skipping
 * to a phase (including the turn-based actions a skip has to perform).
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleClaimMyTurnRequest,
 * handleRandomizeStartingPlayerRequest, handleNextTurnRequest,
 * handleNextStepRequest, handleSkipToPhaseRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import {
  completePendingPhaseSkipCore,
  handleSkipToCleanupPhase,
  processPhaseSkipTriggerStops,
} from "../../state/modules/phaseSkipUtils.js";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
// registerGameActions wraps this under the local name `checkAndEmitDamageTriggers`;
// importing it under that name keeps the moved handler bodies unchanged.
import { emitPendingDamageTriggers as checkAndEmitDamageTriggers } from "../damage-triggers.js";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import {
  processPendingBottomOrder,
  processPendingCascades,
  processPendingDanceWithCalamity,
  processPendingLimDulsVault,
  processPendingOracleIrCompoundResume,
  processPendingPonder,
  processPendingProliferate,
  processPendingScry,
  processPendingSurveil,
} from "../resolution.js";
import {
  advanceStepPersistingEvent,
  flushPendingDamageTriggersAfterStepAdvance,
} from "../step-advance.js";
import {
  appendGameEvent,
  broadcastGame,
  ensureGame,
  getPlayerName,
  persistAndResolveTopOfStack,
} from "../util";
import { checkAndPromptMiracle } from "./gameActionsCastFaceAndMiracleSelection.js";
import {
  checkAllPlayersHaveDecks,
  checkAllPlayersKeptHands,
} from "./gameActionsMulliganReadinessChecks.js";
import {
  checkColorChoiceForNewPermanents,
  checkCreatureTypeSelectionForNewPermanents,
  checkEnchantmentETBTriggers,
  checkPlayerSelectionForNewPermanents,
} from "./gameActionsPermanentEntryPrompts.js";
import { processOracleIRInteractions } from "./gameActionsSpellCastLock.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

export async function handleClaimMyTurnRequest(
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

    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (socketIsSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Spectators can't claim the starting turn." } as any);
      return;
    }

    const statePlayers = ((game.state as any)?.players || []) as any[];
    const me = statePlayers.find((p: any) => p?.id === playerId);
    if (!me || me?.spectator || me?.isSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized." } as any);
      return;
    }

    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    const pregame =
      phaseStr === "" ||
      phaseStr === "PRE_GAME" ||
      phaseStr.includes("BEGIN");

    if (!pregame) {
      socket.emit("error", {
        code: "CLAIM_TURN_NOT_PREGAME",
        message: "Claiming turn only allowed in pre-game.",
      });
      return;
    }

    if (game.state.turnPlayer) {
      socket.emit("error", {
        code: "CLAIM_TURN_EXISTS",
        message: "Active player already set.",
      });
      return;
    }

    // Set as active player
    try {
      game.state.turnPlayer = playerId;
      // Track starting player for intervening-if templates like "if you weren't the starting player".
      // Best-effort: only set if missing so reconnects/duplicate actions don't overwrite.
      if (!(game.state as any).startingPlayerId) {
        (game.state as any).startingPlayerId = playerId;
        // Legacy alias for intervening-if fallbacks.
        (game.state as any).startingPlayer = (game.state as any).startingPlayerId;
      }
      appendGameEvent(game, gameId, "claimTurn", { by: playerId });
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} claimed first turn.`,
        ts: Date.now(),
      });
      broadcastGame(io, game, gameId);
      await tryAutoStartGameFromPreGame(io, game, gameId, 'claimTurn');
    } catch (e) {
      debugError(1, "claimMyTurn: failed to set turnPlayer", e);
      socket.emit("error", {
        code: "CLAIM_TURN_FAILED",
        message: String(e),
      });
    }
  } catch (err) {
    debugError(1, "claimMyTurn handler failed:", err);
  }
}

export async function handleRandomizeStartingPlayerRequest(
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

    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (socketIsSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Spectators can't randomize the starting player." } as any);
      return;
    }

    const statePlayers = ((game.state as any)?.players || []) as any[];
    const me = statePlayers.find((p: any) => p?.id === playerId);
    if (!me || me?.spectator || me?.isSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized." } as any);
      return;
    }

    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    const isPreGame =
      phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("PRE");

    if (!isPreGame) {
      socket.emit("error", {
        code: "RANDOMIZE_NOT_PREGAME",
        message: "Randomizing starting player only allowed in pre-game.",
      });
      return;
    }

    const players = (game.state?.players || []).filter((p: any) => p && !p.spectator && !p.isSpectator);
    if (players.length === 0) {
      socket.emit("error", {
        code: "RANDOMIZE_NO_PLAYERS",
        message: "No players to randomize.",
      });
      return;
    }

    // Pick a random player
    const randomIndex = Math.floor(Math.random() * players.length);
    const randomPlayer = players[randomIndex];

    // Set as active player
    try {
      game.state.turnPlayer = randomPlayer.id;
      // Track starting player for intervening-if templates like "if you weren't the starting player".
      (game.state as any).startingPlayerId = randomPlayer.id;
      // Legacy alias for intervening-if fallbacks.
      (game.state as any).startingPlayer = (game.state as any).startingPlayerId;
      appendGameEvent(game, gameId, "randomizeStartingPlayer", { 
        selectedPlayerId: randomPlayer.id,
        by: playerId
      });
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `=�Ħ ${getPlayerName(game, randomPlayer.id)} was randomly selected to go first!`,
        ts: Date.now(),
      });
      broadcastGame(io, game, gameId);
      await tryAutoStartGameFromPreGame(io, game, gameId, 'randomizeStartingPlayer');
    } catch (e) {
      debugError(1, "randomizeStartingPlayer: failed to set turnPlayer", e);
      socket.emit("error", {
        code: "RANDOMIZE_FAILED",
        message: String(e),
      });
    }
  } catch (err) {
    debugError(1, "randomizeStartingPlayer handler failed:", err);
  }
}

export async function handleNextTurnRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  if (!gameId || typeof gameId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    // Debug logging
    try {
      debug(1, 
        `[nextTurn] request from player=${playerId} game=${gameId} turnPlayer=${
          game.state?.turnPlayer
        } stack=${(game.state?.stack || []).length} phase=${String(
          game.state?.phase
        )}`
      );
    } catch {
      /* ignore */
    }

    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    const pregame =
      phaseStr === "" ||
      phaseStr === "PRE_GAME" ||
      phaseStr.includes("BEGIN");

    // During pre-game, check that all players have imported their decks
    if (pregame) {
      const { allHaveDecks, waitingPlayers: deckWaiters } = checkAllPlayersHaveDecks(game);
      if (!allHaveDecks && deckWaiters.length > 0) {
        socket.emit("error", {
          code: "PREGAME_DECKS_NOT_LOADED",
          message: `Waiting for player(s) to import their deck: ${deckWaiters.join(", ")}`,
        });
        debug(1, 
          `[nextTurn] rejected - not all players have decks (waiting: ${deckWaiters.join(", ")})`
        );
        return;
      }

      // Check that all players have kept their hands before allowing transition
      const { allKept, waitingPlayers } = checkAllPlayersKeptHands(game);
      if (!allKept && waitingPlayers.length > 0) {
        socket.emit("error", {
          code: "PREGAME_HANDS_NOT_KEPT",
          message: `Waiting for player(s) to keep their hand: ${waitingPlayers.join(", ")}`,
        });
        debug(1, 
          `[nextTurn] rejected - not all players kept hands (waiting: ${waitingPlayers.join(", ")})`
        );
        return;
      }
    }

    const playersArr: any[] =
      game.state && Array.isArray(game.state.players)
        ? game.state.players
        : [];

    // Only active player may advance if set (except pre-game start: any ready player may begin)
    if (game.state.turnPlayer && game.state.turnPlayer !== playerId && !pregame) {
      socket.emit("error", {
        code: "NEXT_TURN",
        message: "Only the active player can advance the turn.",
      });
      debug(1, 
        `[nextTurn] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`
      );
      return;
    }

    if (!game.state.turnPlayer) {
      if (playersArr.length <= 1) {
        try {
          game.state.turnPlayer = playerId;
          appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
          debug(1, 
            `[nextTurn] auto-assigned turnPlayer to single player ${playerId}`
          );
        } catch (e) {
          debugWarn(1, "nextTurn: auto-assign failed", e);
        }
      } else if (!pregame) {
        socket.emit("error", {
          code: "NEXT_TURN",
          message: "No active player set; cannot advance turn.",
        });
        debug(1, 
          `[nextTurn] rejected - no turnPlayer and not pregame (phase=${phaseStr})`
        );
        return;
      } else {
        socket.emit("error", {
          code: "NEXT_TURN_NO_CLAIM",
          message:
            "No active player set. Use 'Claim Turn' or Random Start to pick the first player.",
        });
        debug(1, 
          `[nextTurn] rejected - no turnPlayer; ask user to claim (player=${playerId})`
        );
        return;
      }
    }

    if (game.state.stack && game.state.stack.length > 0) {
      socket.emit("error", {
        code: "NEXT_TURN",
        message: "Cannot advance turn while the stack is not empty.",
      });
      debug(1, 
        `[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`
      );
      return;
    }

    // Invoke underlying implementation
    try {
      if (typeof (game as any).nextTurn === "function") {
        await (game as any).nextTurn();
        debug(2, 
          `[nextTurn] Successfully advanced turn for game ${gameId}`
        );
      } else {
        debugError(1, 
          `[nextTurn] CRITICAL: game.nextTurn not available on game ${gameId} - this should not happen with full engine`
        );
        socket.emit("error", {
          code: "NEXT_TURN_IMPL_MISSING",
          message:
            "Server error: game engine not properly initialized. Please contact support.",
        });
        return;
      }
    } catch (e) {
      debugError(1, "nextTurn: game.nextTurn invocation failed:", e);
      socket.emit("error", {
        code: "NEXT_TURN_IMPL_ERROR",
        message: String(e),
      });
      return;
    }

    // Handle conceded player cleanup when their turn would start
    // If the new turn player has conceded, clean up their field and skip to next player
    const newTurnPlayer = game.state.turnPlayer;
    const players = game.state.players || [];
    const concededPlayer = players.find((p: any) => 
      p.id === newTurnPlayer && p.conceded && !p.eliminated
    );

    if (concededPlayer) {
      const concededPlayerName = concededPlayer.name || newTurnPlayer;
      const departureMode = String((concededPlayer as any).departureMode || "concede").toLowerCase();
      const lossReason = departureMode === "leave" ? "Left the game" : "Conceded";

      // Clean up conceded player's permanents (exile them)
      const battlefield = game.state.battlefield || [];
      const concededPermanents = battlefield.filter((p: any) => p.controller === newTurnPlayer);

      if (concededPermanents.length > 0) {
        // Move all their permanents to exile
        const zones = (game.state as any).zones = (game.state as any).zones || {};
        const playerZones = zones[newTurnPlayer] = zones[newTurnPlayer] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
        (playerZones as any).exile = (playerZones as any).exile || [];

        for (const perm of concededPermanents) {
          (playerZones as any).exile.push({
            id: perm.id,
            ...perm.card,
            zone: 'exile',
          });
        }

        // Remove from battlefield
        game.state.battlefield = battlefield.filter((p: any) => p.controller !== newTurnPlayer);

        debug(2, `[nextTurn] Removed ${concededPermanents.length} permanents from conceded player ${concededPlayerName}`);
      }

      // Mark player as fully eliminated now
      (concededPlayer as any).hasLost = true;
      (concededPlayer as any).eliminated = true;
      (concededPlayer as any).lossReason = lossReason;

      const stateAny = game.state as any;
      if (stateAny.autoPassForTurn && typeof stateAny.autoPassForTurn === "object") {
        delete stateAny.autoPassForTurn[newTurnPlayer];
      }
      if (stateAny.autoPassPlayers instanceof Set) {
        stateAny.autoPassPlayers.delete(newTurnPlayer);
      }
      if (stateAny.priorityClaimed instanceof Set) {
        stateAny.priorityClaimed.delete(newTurnPlayer);
      }

      // Emit that their field was cleaned up
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `=�Ŧn+� ${concededPlayerName}'s permanents have been removed from the game.`,
        ts: Date.now(),
      });

      try {
        appendEvent(gameId, (game as any).seq || 0, "concededPlayerCleanup", {
          playerId: newTurnPlayer,
          lossReason,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(concededPlayerCleanup) failed", e);
      }

      // Skip to next player's turn
      if (typeof (game as any).nextTurn === "function") {
        await (game as any).nextTurn();
        debug(2, `[nextTurn] Skipped conceded player ${concededPlayerName}, advancing to next player`);
      }
    }

    // Persist event without re-applying it in-memory (avoid double-advance)
    try {
      appendEvent(
        gameId,
        (game as any).seq || 0,
        "nextTurn",
        { by: playerId }
      );
    } catch (e) {
      debugWarn(1, "appendEvent(nextTurn) failed", e);
    }

    // Optional: bump seq if your ctx.bumpSeq isn't already doing it inside nextTurn
    if (typeof (game as any).bumpSeq === "function") {
      try {
        (game as any).bumpSeq();
      } catch {
        /* ignore */
      }
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Turn advanced. Active player: ${getPlayerName(game, game.state.turnPlayer)}`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `nextTurn error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "NEXT_TURN_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleNextStepRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  if (!gameId || typeof gameId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    // Debug logging
    try {
      debug(1, 
        `[nextStep] request from player=${playerId} game=${gameId} turnPlayer=${
          game.state?.turnPlayer
        } step=${String(game.state?.step)} stack=${
          (game.state?.stack || []).length
        } phase=${String(game.state?.phase)}`
      );
    } catch {
      /* ignore */
    }

    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    const pregame =
      phaseStr === "" ||
      phaseStr === "PRE_GAME" ||
      phaseStr.includes("BEGIN");

    // During pre-game, check that all players have imported their decks
    if (pregame) {
      const { allHaveDecks, waitingPlayers: deckWaiters } = checkAllPlayersHaveDecks(game);
      if (!allHaveDecks && deckWaiters.length > 0) {
        socket.emit("error", {
          code: "PREGAME_DECKS_NOT_LOADED",
          message: `Waiting for player(s) to import their deck: ${deckWaiters.join(", ")}`,
        });
        debug(1, 
          `[nextStep] rejected - not all players have decks (waiting: ${deckWaiters.join(", ")})`
        );
        return;
      }

      // Check that all players have kept their hands before allowing transition
      const { allKept, waitingPlayers } = checkAllPlayersKeptHands(game);
      if (!allKept && waitingPlayers.length > 0) {
        socket.emit("error", {
          code: "PREGAME_HANDS_NOT_KEPT",
          message: `Waiting for player(s) to keep their hand: ${waitingPlayers.join(", ")}`,
        });
        debug(1, 
          `[nextStep] rejected - not all players kept hands (waiting: ${waitingPlayers.join(", ")})`
        );
        return;
      }

      // During pre-game, start the game via nextTurn (nextStep is blocked in pre_game).
      try {
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          flushPendingDamageTriggersAfterStepAdvance(io, game as any, gameId);
          debug(2, 
            `[nextStep] Pre-game: started game via nextTurn for game ${gameId}`
          );
        }
      } catch (e) {
        debugError(1, "nextStep: game.nextTurn invocation failed during pre-game:", e);
        socket.emit("error", {
          code: "NEXT_STEP_IMPL_ERROR",
          message: String(e),
        });
        return;
      }

      try {
        appendEvent(
          gameId,
          (game as any).seq || 0,
          "nextTurn",
          { by: playerId, pregame: true, reason: 'beginGame' }
        );
      } catch (e) {
        debugWarn(1, "appendEvent(nextTurn) failed", e);
      }

      broadcastGame(io, game, gameId);
      return;
    }

    const playersArr: any[] =
      game.state && Array.isArray(game.state.players)
        ? game.state.players
        : [];

    // For single-player games, directly advance
    if (playersArr.length <= 1) {
      if (!game.state.turnPlayer) {
        game.state.turnPlayer = playerId;
      }

      // Check for empty stack
      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", {
          code: "NEXT_STEP",
          message: "Cannot advance step while the stack is not empty.",
        });
        return;
      }

      try {
        if (!advanceStepPersistingEvent(io, game as any, gameId, { by: playerId })) {
          return;
        }
        debug(2, 
          `[nextStep] Single-player: advanced step for game ${gameId}`
        );
      } catch (e) {
        debugError(1, "nextStep: game.nextStep invocation failed:", e);
        return;
      }

      broadcastGame(io, game, gameId);
      return;
    }

    // Multi-player: "Next Step" should pass priority
    // The step will advance when all players pass in succession

    // Check if player has priority
    if (game.state.priority !== playerId) {
      socket.emit("error", {
        code: "NOT_YOUR_PRIORITY",
        message: "You don't have priority. Wait for your turn to pass.",
      });
      debug(1, 
        `[nextStep] rejected - not player's priority (player=${playerId} priority=${game.state.priority})`
      );
      return;
    }

    // Pass priority (this handles step advancement when all pass)
    const { changed, resolvedNow, advanceStep } = game.passPriority(playerId);
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, viaNextStep: true });

    if (resolvedNow) {
      // Capture the top spell before it resolves
      const stackBefore = game.state?.stack || [];
      const topItem = stackBefore.length > 0 ? stackBefore[stackBefore.length - 1] : null;

      if (persistAndResolveTopOfStack(game, gameId)) {
        debug(2, `[nextStep] Stack resolved for game ${gameId}`);

        // Queue prompts for any "you may" oracle IR effects on the resolved spell
        await processOracleIRInteractions(io, game, gameId, topItem);

        checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
        checkColorChoiceForNewPermanents(io, game, gameId);
        checkPlayerSelectionForNewPermanents(io, game, gameId);
        checkEnchantmentETBTriggers(io, game, gameId);
      }
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: "Top of stack resolved.",
        ts: Date.now(),
      });

      // Process any cascade triggers
      await processPendingCascades(io, game, gameId);

      // Process any pending scry effects
      processPendingScry(io, game, gameId);

      // Process any pending surveil effects
      processPendingSurveil(io, game, gameId);

      // Process any pending proliferate effects
      processPendingProliferate(io, game, gameId);

      // Process any pending ponder effects
      processPendingPonder(io, game, gameId);

      // Process any pending bottom-order effects
      processPendingBottomOrder(io, game, gameId);

      // Process any pending Lim-Dul's Vault effects
      processPendingLimDulsVault(io, game, gameId);

      // Process any pending Dance with Calamity effects
      processPendingDanceWithCalamity(io, game, gameId);
      processPendingOracleIrCompoundResume(io, game, gameId);
    }

    // If all players passed priority with empty stack, advance to next step
    if (advanceStep) {
      if (advanceStepPersistingEvent(io, game as any, gameId, { reason: 'allPlayersPassed' })) {
        debug(2, `[nextStep] All players passed priority - advanced to next step for game ${gameId}`);

        const newStep = (game.state as any)?.step || 'unknown';
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Step advanced to ${newStep}.`,
          ts: Date.now(),
        });

        // Let the normal broadcast-driven AI/auto-pass flow handle any later
        // progression after this step settles.
        delete (game.state as any)._autoPassResult;
      }
    }

    broadcastGame(io, game, gameId);

    // Check for pending damage triggers
    checkAndEmitDamageTriggers(io, game, gameId);
  } catch (err: any) {
    debugError(1, `nextStep error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "NEXT_STEP_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export async function handleSkipToPhaseRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    targetPhase?: unknown;
    targetStep?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const targetPhase = payload?.targetPhase;
  const targetStep = payload?.targetStep;

  if (!gameId || typeof gameId !== 'string') return;
  if (typeof targetPhase !== 'string' || typeof targetStep !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const currentPhase = String(game.state?.phase || "").toLowerCase();
    const currentStep = String(game.state?.step || "").toUpperCase();
    const turnPlayer = game.state.turnPlayer;

    // Debug logging
    try {
      debug(1,
        `[skipToPhase] request from player=${playerId} game=${gameId} turnPlayer=${turnPlayer} currentPhase=${currentPhase} currentStep=${currentStep} targetPhase=${targetPhase} targetStep=${targetStep}`
      );
    } catch {
      /* ignore */
    }

    // Only active player may skip phases
    if (turnPlayer && turnPlayer !== playerId) {
      socket.emit("error", {
        code: "SKIP_TO_PHASE",
        message: "Only the active player can skip to a phase.",
      });
      return;
    }

    // Ensure stack is empty
    if (game.state.stack && game.state.stack.length > 0) {
      socket.emit("error", {
        code: "SKIP_TO_PHASE",
        message: "Cannot skip phases while the stack is not empty.",
      });
      return;
    }

    // Ensure there are no pending Resolution Queue interactions that need to be resolved
    const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
    if (queueSummary.hasPending) {
      socket.emit("error", {
        code: "SKIP_TO_PHASE",
        message: "Cannot skip phases while there are pending interactions. Resolve them first.",
      });
      return;
    }

    // ========================================================================
    // CRITICAL FIX: Check if we're skipping through phases with triggers.
    // We must stop at each phase that has triggers, fire them in the correct
    // phase, and wait for them to resolve before continuing.
    // This applies to: UPKEEP, DRAW, MAIN1, BEGIN_COMBAT, END_COMBAT, MAIN2, and END_STEP
    // ========================================================================
    if (!turnPlayer) {
      socket.emit("error", {
        code: "SKIP_TO_PHASE",
        message: "No active player for phase skip.",
      });
      return;
    }

    const stopResult = processPhaseSkipTriggerStops({
      game,
      gameId,
      io,
      playerId,
      turnPlayer,
      targetPhase,
      targetStep,
      skipOriginPhase: currentPhase,
      skipOriginStep: currentStep,
      logPrefix: '[skipToPhase]',
      emitError: (code, message) => socket.emit('error', { code, message }),
    });
    if (stopResult === 'stopped') return;
    if (stopResult === 'blocked') return;

    const { untappedPermanentIds, drawnCards } = completePendingPhaseSkipCore({
      game,
      gameId,
      io,
      playerId,
      turnPlayer,
      targetPhase,
      targetStep,
      skipOriginPhase: currentPhase,
      skipOriginStep: currentStep,
    });

    if (Array.isArray(drawnCards) && drawnCards.length > 0) {
      checkAndPromptMiracle(io, game, gameId, turnPlayer, drawnCards);
    }

    const targetStepUpper = targetStep.toUpperCase();

    // Handle CLEANUP phase specially - need to check for discard and auto-advance to next turn
    const isCleanupPhase = targetStepUpper === "CLEANUP";
    let queuedCleanupDiscard = false;

    if (isCleanupPhase && turnPlayer) {
      const cleanupResult = handleSkipToCleanupPhase({
        game,
        gameId,
        turnPlayer,
        onAfterNextStep: () => flushPendingDamageTriggersAfterStepAdvance(io, game as any, gameId),
      });
      queuedCleanupDiscard = cleanupResult.queuedCleanupDiscard;
    }

    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    // Persist event
    try {
      appendEvent(
        gameId,
        (game as any).seq || 0,
        "skipToPhase",
        {
          by: playerId,
          targetPhase,
          targetStep,
          ...(untappedPermanentIds.length > 0 ? { untappedPermanentIds } : {}),
        }
      );
    } catch (e) {
      debugWarn(1, "appendEvent(skipToPhase) failed", e);
    }

    debug(2, 
      `[skipToPhase] Skipped to phase=${targetPhase}, step=${targetStep} for game ${gameId}`
    );

    // Different message based on whether we're going to cleanup or regular phase
    const chatMessage = isCleanupPhase 
      ? (queuedCleanupDiscard 
          ? `${getPlayerName(game, playerId)} moved to cleanup. Discard to hand size.`
          : `${getPlayerName(game, playerId)} ended their turn.`)
      : `${getPlayerName(game, playerId)} skipped to ${targetPhase} phase.`;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: chatMessage,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `skipToPhase error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "SKIP_TO_PHASE_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
