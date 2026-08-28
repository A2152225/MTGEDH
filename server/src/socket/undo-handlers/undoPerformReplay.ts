// server/src/socket/undo-handlers/undoPerformReplay.ts
// Origin parent: server/src/socket/undo.ts
// Cluster moved: performUndo — truncate the event log, reset the live game,
// replay remaining events, restore seats/priority, and emit rebuild progress.
// Public entry symbols: performUndo.

import type { Server } from "socket.io";
import {
  transformDbEventsForReplay,
  clearScheduledHumanAutoPassForGame,
  suppressAutomationOnNextBroadcast,
  pauseHumanAutoPassUntilAction,
} from "../util.js";
import { getEvents, truncateEventsForUndo, getEventCount } from "../../db/index.js";
import { markGameRestoring, clearGameRestoring } from "../../gameRestoreState.js";
import GameManager from "../../GameManager.js";
import { reconcileCommandZoneZoneConsistency } from "../../state/modules/commander.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { clearScheduledAIActionsForGame } from "../ai-handlers/aiScheduler.js";

const UNDO_REPLAY_YIELD_EVERY = 50;

function emitUndoRebuildProgress(
  io: Server | undefined,
  gameId: string,
  current: number,
  total: number,
  done = false,
): void {
  const percent =
    done || total <= 0
      ? 100
      : Math.min(100, Math.round((current / total) * 100));
  try {
    GameManager.publishResumeProgress(gameId, current, total, done, "undo");
  } catch {
    /* best-effort */
  }
  try {
    io?.emit("gameResumeProgress", {
      gameId,
      current,
      total,
      percent,
      isRestoring: !done,
      reason: "undo",
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Truncate the persisted log and rebuild the live game by replaying the
 * remaining events on the same GameManager instance (preserves sockets).
 */
export async function performUndo(
  gameId: string,
  actionsToUndo: number,
  eventCountOverride?: number,
  io?: Server,
): Promise<{ success: boolean; error?: string }> {
  let progressStarted = false;
  let progressTotal = 0;
  try {
    clearScheduledHumanAutoPassForGame(gameId);
    clearScheduledAIActionsForGame(gameId);

    let eventCount: number;
    if (typeof eventCountOverride === "number" && Number.isFinite(eventCountOverride) && eventCountOverride >= 0) {
      eventCount = Math.floor(eventCountOverride);
    } else {
      try {
        eventCount = getEventCount(gameId);
      } catch (e) {
        debugWarn(1, `[undo] Failed to get event count for game ${gameId}:`, e);
        return { success: false, error: "Database not available" };
      }
    }

    if (eventCount === 0) {
      return { success: false, error: "No actions to undo" };
    }

    const eventsToKeep = Math.max(0, eventCount - actionsToUndo);

    debug(2, `[undo] Performing undo for game ${gameId}: keeping ${eventsToKeep} of ${eventCount} events`);

    try {
      truncateEventsForUndo(gameId, eventsToKeep);
    } catch (e) {
      debugError(1, `[undo] Failed to truncate events for game ${gameId}:`, e);
      return { success: false, error: "Failed to truncate event log" };
    }

    let remainingEvents: any[];
    try {
      remainingEvents = getEvents(gameId);
    } catch (e) {
      debugWarn(1, `[undo] Failed to get events after truncation:`, e);
      remainingEvents = [];
    }

    const existingGame = GameManager.getGame(gameId);

    if (!existingGame) {
      debugError(1, `[undo] Game ${gameId} not found in GameManager`);
      return { success: false, error: "Game not found" };
    }

    let savedParticipants: Array<{ socketId: string; playerId: string; spectator: boolean }> = [];
    try {
      if (typeof existingGame.participants === "function") {
        savedParticipants = existingGame.participants().map((p: any) => ({
          socketId: p.socketId,
          playerId: p.playerId,
          spectator: !!(p.spectator || p.isSpectator),
        }));
      }
    } catch (e) {
      debugWarn(1, "[undo] Failed to save participants:", e);
    }

    progressTotal = remainingEvents.length;
    progressStarted = true;
    emitUndoRebuildProgress(io, gameId, 0, progressTotal);

    if (typeof existingGame.reset === "function") {
      try {
        existingGame.reset(true); // preservePlayers = true
        debug(2, `[undo] Reset game state for ${gameId}`);
      } catch (resetErr) {
        debugError(1, `[undo] Reset failed for game ${gameId}:`, resetErr);
        return { success: false, error: "Failed to reset game state" };
      }
    } else {
      debugError(1, `[undo] Game ${gameId} does not have reset method`);
      return { success: false, error: "Game does not support reset" };
    }

    if (remainingEvents.length > 0 && typeof existingGame.replay === "function") {
      const replayEvents = transformDbEventsForReplay(remainingEvents);

      markGameRestoring(gameId);
      try {
        if (typeof existingGame.replayAsync === "function") {
          await existingGame.replayAsync(replayEvents, {
            yieldEvery: UNDO_REPLAY_YIELD_EVERY,
            onProgress: (current: number, total: number) => {
              emitUndoRebuildProgress(io, gameId, current, total);
            },
          });
        } else {
          existingGame.replay(replayEvents);
        }
        debug(2, `[undo] Replayed ${replayEvents.length} events for game ${gameId}`);
      } catch (replayErr) {
        debugError(1, `[undo] Replay failed for game ${gameId}:`, replayErr);
        return { success: false, error: "Failed to replay events" };
      } finally {
        clearGameRestoring(gameId);
      }
    } else if (remainingEvents.length === 0) {
      debug(2, `[undo] No events to replay for game ${gameId} (undid all actions)`);
    }

    try {
      if (savedParticipants.length > 0 && typeof existingGame.join === "function") {
        const currentParticipants = typeof existingGame.participants === "function"
          ? existingGame.participants()
          : [];

        if (currentParticipants.length === 0 && savedParticipants.length > 0) {
          debug(2, `[undo] Restoring ${savedParticipants.length} participant(s) for game ${gameId}`);
          for (const p of savedParticipants) {
            if (p.socketId && p.playerId) {
              try {
                existingGame.join(p.socketId, p.playerId, p.spectator, p.playerId);
              } catch (joinErr) {
                debugWarn(1, `[undo] Failed to restore participant ${p.playerId}:`, joinErr);
              }
            }
          }
        }
      }
    } catch (e) {
      debugWarn(1, "[undo] Failed to restore participants:", e);
    }

    try {
      const purged = reconcileCommandZoneZoneConsistency((existingGame as any)?.state);
      if (purged.removedBattlefield || purged.removedStack) {
        debugWarn(1, `[undo] Reconciled command-zone/BF ghosts for ${gameId}`, purged);
      }
    } catch (reconcileErr) {
      debugWarn(1, `[undo] reconcileCommandZoneZoneConsistency failed for ${gameId}:`, reconcileErr);
    }

    if (typeof existingGame.bumpSeq === "function") {
      existingGame.bumpSeq();
    }

    try {
      const stateAny = (existingGame.state as any) || {};
      const turnPlayer = String(stateAny.turnPlayer || "").trim();
      const phase = String(stateAny.phase || "").toLowerCase();
      const step = String(stateAny.step || "").toUpperCase();
      const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);

      if (turnPlayer) {
        pauseHumanAutoPassUntilAction(existingGame as any, turnPlayer);
      }

      if (
        turnPlayer &&
        !pendingSummary.hasPending &&
        phase !== "pre_game" &&
        phase !== "pre-game" &&
        !["UNTAP", "CLEANUP"].includes(step)
      ) {
        stateAny.priority = turnPlayer;
      }
    } catch (priorityErr) {
      debugWarn(1, `[undo] Failed to restore priority/autopass pause for ${gameId}:`, priorityErr);
    }

    suppressAutomationOnNextBroadcast(existingGame as any);

    void import("../ai.js").then((aiModule) => {
      if (typeof aiModule.rehydrateAIGameRuntime === "function") {
        aiModule.rehydrateAIGameRuntime(gameId, { refreshDeckProfiles: true });
      }
    }).catch((err) => {
      debugWarn(1, `[undo] Failed to rehydrate AI runtime for game ${gameId}:`, err);
    });

    return { success: true };
  } catch (err: any) {
    debugError(1, `[undo] performUndo failed for game ${gameId}:`, err);
    return { success: false, error: err?.message || "Unknown error" };
  } finally {
    if (progressStarted) {
      emitUndoRebuildProgress(io, gameId, progressTotal, progressTotal, true);
    }
  }
}
