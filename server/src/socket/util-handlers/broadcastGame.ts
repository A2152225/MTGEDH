// server/src/socket/util-handlers/broadcastGame.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: broadcastGame - per-participant state emit, then AI / auto-pass
//   / elimination follow-ups.
// Public entry symbols: runBroadcastGame.
// Parent keeps the public broadcastGame wrapper and supplies
//   scheduleAutomationResume / checkAndTriggerAutoPass (cycle-safe).

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import { emitPendingCombatDamageChat } from "../combatLogUtils.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { debug, debugWarn } from "../../utils/debug.js";
import {
  clearScheduledAutomationResume,
  clearScheduledHumanAutoPass,
} from "./autoPassTimerState.js";
import { ts, repairMissingPriorityIfStuck } from "./repairMissingPriorityIfStuck.js";
import { normalizeViewForEmit, logStateDebug } from "./gameStateEmitNormalize.js";
import {
  checkAndTriggerAI,
  checkAndEmitKynaiosChoicePrompts,
  checkAndEmitPlayerElimination,
} from "./checkAndTriggerAI.js";

export type BroadcastGameDeps = {
  scheduleAutomationResume: (
    io: Server,
    game: InMemoryGame,
    gameId: string,
    suppressUntil: number,
  ) => void;
  checkAndTriggerAutoPass: (io: Server, game: InMemoryGame, gameId: string) => void;
};

/**
 * Broadcasts the full state of a game to all participants.
 * Uses the game's participants() method if available, otherwise falls back to participantsList.
 *
 * This version normalizes view and mirrors minimal zone shapes back into game.state so clients
 * and other server code never observe missing per-player zones.
 * 
 * After broadcasting, checks if the current priority holder is an AI player
 * and triggers AI handling if needed.
 */
export function runBroadcastGame(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  options: { forceStateReplace?: boolean } = {},
  deps: BroadcastGameDeps,
) {
  const { scheduleAutomationResume, checkAndTriggerAutoPass } = deps;
  if (isGameReplayLocked(game, gameId)) {
    return;
  }
  // Loop-shortcut batch runs suppress mid-batch broadcasts; caller emits once at end.
  if (Number((game.state as any)?._suppressBroadcastCount || 0) > 0) {
    return;
  }

  repairMissingPriorityIfStuck(game, gameId, '[broadcastGame]');

  let participants:
    | Array<{
        socketId: string;
        playerId: string;
        spectator: boolean;
      }>
    | null = null;

  try {
    if (typeof (game as any).participants === "function") {
      participants = (game as any).participants();
    } else if (
      (game as any).participantsList &&
      Array.isArray((game as any).participantsList)
    ) {
      participants = (game as any).participantsList.slice();
    } else {
      participants = [];
    }
  } catch (err) {
    debugWarn(1, "broadcastGame: failed to obtain participants:", err);
    participants = [];
  }

  let anySent = false;

  if (participants && participants.length) {
    for (const p of participants) {
      try {
        const participantIsSpectator = !!(
          (p as any)?.spectator || (p as any)?.isSpectator
        );
        let rawView;
        try {
          rawView =
            typeof (game as any).viewFor === "function"
              ? (game as any).viewFor(p.playerId, participantIsSpectator)
              : (game as any).state;
        } catch {
          rawView = (game as any).state;
        }

        const view = normalizeViewForEmit(rawView, game);

        logStateDebug("BROADCAST_STATE", gameId, view);

        if (p.socketId) {
          io.to(p.socketId).emit("state", {
            gameId,
            view,
            seq: (game as any).seq,
            ...(options.forceStateReplace ? { forceStateReplace: true } : {}),
          });
          anySent = true;
        }
      } catch (err) {
        debugWarn(1, 
          "broadcastGame: failed to send state to",
          p.socketId,
          err
        );
      }
    }
  }

  // Fallback: if we had no participants or failed to send to anyone,
  // emit to the entire game room so rejoined sockets still receive updates.
  if (!anySent) {
    try {
      let rawView: any;
      try {
        if (typeof (game as any).viewFor === "function") {
          const statePlayers: any[] = (game as any).state?.players || [];
          const firstId: string | undefined = statePlayers[0]?.id;
          rawView = firstId
            ? (game as any).viewFor(firstId, true)
            : (game as any).state;
        } else {
          rawView = (game as any).state;
        }
      } catch {
        rawView = (game as any).state;
      }

      const view = normalizeViewForEmit(rawView, game);
      logStateDebug("BROADCAST_STATE", gameId, view);
      io.to(gameId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq,
        ...(options.forceStateReplace ? { forceStateReplace: true } : {}),
      });
    } catch (err) {
      debugWarn(1, 
        "broadcastGame: fallback emit to room failed for gameId",
        gameId,
        err
      );
    }
  }
  
  const stateAny = (game.state as any) || {};
  const suppressAutomation = stateAny._suppressAutomationOnNextBroadcast === true;
  const suppressUntil = Number(stateAny._suppressAutomationUntil || 0);
  const deferAutomation = suppressUntil > Date.now();
  if (suppressAutomation || deferAutomation) {
    delete stateAny._suppressAutomationOnNextBroadcast;
    clearScheduledHumanAutoPass(gameId);

    if (deferAutomation) {
      scheduleAutomationResume(io, game, gameId, suppressUntil);
      debug(2, `${ts()} [broadcastGame] Suppressed AI/auto-pass automation until ${suppressUntil} for ${gameId}`);
    } else {
      delete stateAny._suppressAutomationUntil;
      clearScheduledAutomationResume(gameId);
      debug(2, `[broadcastGame] Suppressed AI/auto-pass automation once for ${gameId}`);
    }

    // CRITICAL RUNTIME FIX: AI players should NEVER have their automatic priority responses suppressed.
    // Suppressing AI results in infinite game deadlocks if the active player is an AI,
    // because human players have no priority to act and break the silence.
    checkAndTriggerAI(io, game, gameId);
  } else {
    clearScheduledAutomationResume(gameId);
    // After broadcasting, check if the current priority holder is an AI player
    // This ensures AI responds to game state changes
    checkAndTriggerAI(io, game, gameId);
    
    // Check if the current priority holder should auto-pass
    // This ensures human players with auto-pass enabled don't get stuck with priority
    checkAndTriggerAutoPass(io, game, gameId);
  }
  
  // Check for pending Kynaios and Tiro style choices (play land or draw)
  checkAndEmitKynaiosChoicePrompts(io, game, gameId);
  
  // Legacy checkAndEmitProliferatePrompts call removed - now handled by processPendingProliferate()
  // in resolution queue after stack resolution
  
  // Check for newly eliminated players (commander damage, life loss, etc.)
  checkAndEmitPlayerElimination(io, game, gameId);

  emitPendingCombatDamageChat(io, game, gameId);
}
