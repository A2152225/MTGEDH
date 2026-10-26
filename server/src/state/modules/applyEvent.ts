// server/src/state/modules/applyEvent.ts
// Event application / replay / reset helpers.
//
// Exports:
// - applyEvent(ctx, e)
// - replay(ctx, events)
// - reset(ctx, preservePlayers)
// - skip(ctx, playerId)
// - unskip(ctx, playerId)
// - remove(ctx, playerId)
//
// Defensive implementation: tolerates unknown event types and missing engine helpers.
import { createContext, type GameContext } from "../context";
import type { PlayerID, GameEvent } from "../types";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  drawCardsByIds,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  searchLibrary,
  reconcileZonesConsistency,
  applyScry,
  applySurveil,
  movePermanentToHand,
  applyExplore,
  applyDredgeDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
} from "./zones";
import { nextTurn, nextStep, passPriority } from "./turn";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import { dropPromptsCompletedBeforeReplayEnd } from "../resolution/replayCompletedPromptSteps.js";
import {
  consumeReplayedTriggeredAbilityStackItems,
  consumeReplayedActivatedAbilityStackItems,
  finalizeGameStateAfterReplay,
  replayPopTopOfStackDuringEventReplay,
  replayResolveAllTriggersDuringEventReplay,
  replayEnsureAsEntersPermanentFromPromptSteps,
  replayEnsureInterveningIfSubjectOnBattlefield,
} from "./replay-prompt-cleanup.js";

// Context lifecycle fallbacks live in a leaf module; re-exported here so the
// long-standing "./applyEvent.js" import path keeps working.
import {
  reset,
  skip,
  unskip,
  remove,
} from "./apply-event-handlers/applyEventLifecycleResetHandlers.js";
import { applyLobbySetupEvents } from "./apply-event-handlers/applyEventLobbySetupEvents.js";
import { applyCommanderCounterDamageEvents } from "./apply-event-handlers/applyEventCommanderCounterDamageEvents.js";
import { applyStackCoreEvents } from "./apply-event-handlers/applyEventStackCoreEvents.js";
import { applyCastSpellEvents } from "./apply-event-handlers/applyEventCastSpellEvents.js";
import { applyStackPromptEvents } from "./apply-event-handlers/applyEventStackPromptEvents.js";
import { applyReflexivePromptEvents } from "./apply-event-handlers/applyEventReflexivePromptEvents.js";
import { applyCopyRetargetEvents } from "./apply-event-handlers/applyEventCopyRetargetEvents.js";
import { applyPermanentKeywordEvents } from "./apply-event-handlers/applyEventPermanentKeywordEvents.js";
import { applyTurnPhaseTopLibraryEvents } from "./apply-event-handlers/applyEventTurnPhaseTopLibraryEvents.js";
import { applyLibraryGambleChoiceEvents } from "./apply-event-handlers/applyEventLibraryGambleChoiceEvents.js";
import { applyPriorityMulliganLifeEvents } from "./apply-event-handlers/applyEventPriorityMulliganLifeEvents.js";
import { applyTapSacrificeCounterEvents } from "./apply-event-handlers/applyEventTapSacrificeCounterEvents.js";
import { applyCombatEvents } from "./apply-event-handlers/applyEventCombatEvents.js";
import { applyManaPoolEvents } from "./apply-event-handlers/applyEventManaPoolEvents.js";
import { applyRevealLandChoiceEvents } from "./apply-event-handlers/applyEventRevealLandChoiceEvents.js";
import { applyActivateAbilityEvents } from "./apply-event-handlers/applyEventActivateAbilityEvents.js";
import { applyActivateGraveyardAbilityEvents } from "./apply-event-handlers/applyEventActivateGraveyardAbilityEvents.js";
import { applyChoicePromptEvents } from "./apply-event-handlers/applyEventChoicePromptEvents.js";
import { applySacrificeChoiceEvents } from "./apply-event-handlers/applyEventSacrificeChoiceEvents.js";
import { applyLibrarySearchEvents } from "./apply-event-handlers/applyEventLibrarySearchEvents.js";
import { applyGroupVoteEvents } from "./apply-event-handlers/applyEventGroupVoteEvents.js";
import { applyTriggerQueueEvents } from "./apply-event-handlers/applyEventTriggerQueueEvents.js";
import { applyDungeonVoteEvents } from "./apply-event-handlers/applyEventDungeonVoteEvents.js";
import { applyExecuteEffectEvents } from "./apply-event-handlers/applyEventExecuteEffectEvents.js";
import { applyAttachmentEvents } from "./apply-event-handlers/applyEventAttachmentEvents.js";
import { applyGraveyardTargetConfirmEvents } from "./apply-event-handlers/applyEventGraveyardTargetConfirmEvents.js";
import { applyPlayerChoiceEvents } from "./apply-event-handlers/applyEventPlayerChoiceEvents.js";
import { applyEffectProgramZoneEvents } from "./apply-event-handlers/applyEventEffectProgramZoneEvents.js";
import { applyActivateBattlefieldAbilityEvents } from "./apply-event-handlers/applyEventActivateBattlefieldAbilityEvents.js";
import { applyManualActionEvents } from "./apply-event-handlers/applyEventManualActionEvents.js";
import { applyUpkeepPaidUntapEvents } from "./apply-event-handlers/applyEventUpkeepPaidUntapEvents.js";
import { applyUntapCapChoiceEvents } from "./apply-event-handlers/applyEventUntapCapChoiceEvents.js";
export { reset, skip, unskip, remove };


/* -------- Core applyEvent implementation ---------- */

/**
 * Apply a single persisted game event into the provided GameContext.
 * Tolerant: unknown event types are logged and ignored.
 */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  if (!e || typeof e.type !== "string") return;

  try {
    if (applyLobbySetupEvents(ctx, e)) return;
    if (applyCommanderCounterDamageEvents(ctx, e)) return;
    if (applyStackCoreEvents(ctx, e)) return;
    if (applyCastSpellEvents(ctx, e)) return;
    if (applyStackPromptEvents(ctx, e)) return;
    if (applyReflexivePromptEvents(ctx, e)) return;
    if (applyCopyRetargetEvents(ctx, e)) return;
    if (applyPermanentKeywordEvents(ctx, e)) return;
    if (applyTurnPhaseTopLibraryEvents(ctx, e)) return;
    if (applyLibraryGambleChoiceEvents(ctx, e)) return;
    if (applyPriorityMulliganLifeEvents(ctx, e)) return;
    if (applyTapSacrificeCounterEvents(ctx, e)) return;
    if (applyCombatEvents(ctx, e)) return;
    if (applyManaPoolEvents(ctx, e)) return;
    if (applyRevealLandChoiceEvents(ctx, e)) return;
    if (applyActivateAbilityEvents(ctx, e)) return;
    if (applyActivateGraveyardAbilityEvents(ctx, e)) return;
    if (applyChoicePromptEvents(ctx, e)) return;
    if (applySacrificeChoiceEvents(ctx, e)) return;
    if (applyLibrarySearchEvents(ctx, e)) return;
    if (applyGroupVoteEvents(ctx, e)) return;
    if (applyTriggerQueueEvents(ctx, e)) return;
    if (applyDungeonVoteEvents(ctx, e)) return;
    if (applyExecuteEffectEvents(ctx, e)) return;
    if (applyAttachmentEvents(ctx, e)) return;
    if (applyGraveyardTargetConfirmEvents(ctx, e)) return;
    if (applyPlayerChoiceEvents(ctx, e)) return;
    if (applyEffectProgramZoneEvents(ctx, e)) return;
    if (applyActivateBattlefieldAbilityEvents(ctx, e)) return;
    if (applyManualActionEvents(ctx, e)) return;
    if (applyUpkeepPaidUntapEvents(ctx, e)) return;
    if (applyUntapCapChoiceEvents(ctx, e)) return;
    switch (e.type) {

      default: {
        // Log unknown events but don't fail - they may be newer events not yet supported
        // or events that don't affect core game state
        break;
      }
    }
  } catch (err) {
    debugWarn(1, "applyEvent: failed to apply event", (e as any).type, err);
  }
}

/**
 * Replay a sequence of persisted events into ctx.
 * Special-case passPriority events to call passPriority directly for safety.
 *
 * Also handles backward compatibility for old games that don't have explicit
 * shuffleLibrary/drawCards events after setCommander.
 */

export type ReplayProgressHooks = {
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void;
  onProgress?: (current: number, total: number) => void;
  /** Yield to the event loop every N applied events (async replay only). Default 50. */
  yieldEvery?: number;
};

type ReplayCompatSets = {
  playersWithShuffleEvent: Set<string>;
  playersWithDrawEvent: Set<string>;
};

function beginReplayPass(
  ctx: GameContext,
  events: GameEvent[],
): ReplayCompatSets {
  // Ensure any stale per-game resolution steps are cleared before rebuilding state.
  // The queue is not persisted in the event log, so it must not leak across reset/replay.
  try {
    if (ctx?.gameId) {
      ResolutionQueueManager.clearAllSteps(ctx.gameId);
      ResolutionQueueManager.beginReplay(ctx.gameId);
    }
  } catch {
    // best-effort only
  }

  // Track which players have shuffle/draw events anywhere in the event list
  // This is used to detect old-style games that don't have explicit shuffle/draw events
  // and need backward compatibility handling
  const playersWithShuffleEvent = new Set<string>();
  const playersWithDrawEvent = new Set<string>();

  for (const e of events) {
    if (!e || typeof e.type !== "string") continue;

    const pid = (e as any).playerId as string | undefined;
    if (!pid) continue;

    if (e.type === "shuffleLibrary") {
      playersWithShuffleEvent.add(pid);
    } else if (e.type === "drawCards") {
      playersWithDrawEvent.add(pid);
    }
  }

  try {
    (ctx as any)._replayEvents = events;
  } catch {
    // ignore
  }

  return { playersWithShuffleEvent, playersWithDrawEvent };
}

function applyOneReplayEvent(
  ctx: GameContext,
  events: GameEvent[],
  i: number,
  compat: ReplayCompatSets,
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void,
): void {
  const e = events[i];
  if (!e || typeof e.type !== "string") return;

  // Provide lookahead/lookbehind for replay-only behaviors.
  // Lookahead: avoid double-applying when an explicit event follows
  // (e.g., nextStep calling nextTurn vs a nextTurn event; nextStep then pushTriggeredAbility).
  // Lookbehind: live sockets historically appended nextStep *after* nextStep() ran,
  // so persisted pushTriggeredAbility events land immediately before the nextStep event.
  try {
    (ctx as any)._replayEventIndex = i;
    (ctx as any)._replayCurrentEventType = e.type;
    (ctx as any)._replayNextEventType = (events[i + 1] as any)?.type;
    (ctx as any)._replayPreviousEvent = i > 0 ? events[i - 1] : null;
    (ctx as any)._replayPreviousEventType = (events[i - 1] as any)?.type;
  } catch {
    // ignore
  }

  if (e.type === "passPriority") {
    try {
      if (typeof passPriority === "function")
        passPriority(ctx as any, (e as any).by);
    } catch (err) {
      debugWarn(1, "replay: passPriority failed", err);
    }
    return;
  }

  applyEvent(ctx, e);

  // Backward compatibility: if setCommander was called and there are no
  // shuffleLibrary/drawCards events FOR THIS PLAYER in the event list, do them now
  // This handles old games that don't have explicit shuffle/draw events after setCommander
  if (e.type === "setCommander") {
    const pid = (e as any).playerId;
    const needsShuffle = !compat.playersWithShuffleEvent.has(pid);
    const needsDraw = !compat.playersWithDrawEvent.has(pid);

    if (needsShuffle || needsDraw) {
      // Check if hand is empty (meaning opening draw hasn't happened)
      const zones = ctx.state.zones || {};
      const z = zones[pid];
      const handCount = z
        ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0))
        : 0;

      if (handCount === 0) {
        debug(1, "[replay] Backward compat: performing opening draw after setCommander for", pid);
        try {
          if (needsShuffle) {
            shuffleLibrary(ctx as any, pid);
          }
          if (needsDraw) {
            drawCards(ctx as any, pid, 7);
          }
        } catch (err) {
          debugWarn(1, "[replay] Backward compat: opening draw failed for", pid, err);
        }
      }
    }
  }

  if (typeof afterEachEvent === "function") {
    try {
      afterEachEvent(ctx, e, i);
    } catch {
      // ignore probe callback failures
    }
  }
}

function endReplayPass(ctx: GameContext, events: GameEvent[]): void {
  (ctx as any).isReplaying = false;
  try {
    delete (ctx as any)._replayCurrentEventType;
    delete (ctx as any)._replayNextEventType;
    delete (ctx as any)._replayPreviousEvent;
    delete (ctx as any)._replayPreviousEventType;
    delete (ctx as any)._replayEvents;
    delete (ctx as any)._replayEventIndex;
    (ctx as any)._replayLastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    (ctx as any)._replayLastEventType = events.length > 0
      ? String((events[events.length - 1] as any)?.type || "").trim()
      : "";
    (ctx as any)._replayPenultimateEvent = events.length > 1 ? events[events.length - 2] : undefined;
  } catch {
    // ignore
  }
  try {
    dropPromptsCompletedBeforeReplayEnd(String((ctx as any)?.gameId || ''), events);
  } catch {
    // best-effort only
  }
  try {
    finalizeGameStateAfterReplay(ctx);
  } catch {
    // best-effort only
  }
}

export function replay(
  ctx: GameContext,
  events: GameEvent[],
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void,
) {
  if (!Array.isArray(events)) return;

  // Set replay mode flag to prevent side effects in functions like nextStep
  // This ensures that actions like drawing cards during draw step aren't duplicated
  // when explicit drawCards events are also in the event log
  (ctx as any).isReplaying = true;

  try {
    const compat = beginReplayPass(ctx, events);
    for (let i = 0; i < events.length; i++) {
      applyOneReplayEvent(ctx, events, i, compat, afterEachEvent);
    }
    try {
      reconcileZonesConsistency(ctx as any);
    } catch {
      /* swallow */
    }
  } finally {
    endReplayPass(ctx, events);
  }
}

/**
 * Same as {@link replay}, but yields to the event loop periodically so HTTP/socket
 * progress updates can flush during long post-restart restores.
 */
export async function replayAsync(
  ctx: GameContext,
  events: GameEvent[],
  options?: ReplayProgressHooks,
): Promise<void> {
  if (!Array.isArray(events)) return;

  const afterEachEvent = options?.afterEachEvent;
  const onProgress = options?.onProgress;
  const yieldEvery = Math.max(1, options?.yieldEvery ?? 50);
  const total = events.length;

  (ctx as any).isReplaying = true;

  try {
    const compat = beginReplayPass(ctx, events);
    onProgress?.(0, total);

    for (let i = 0; i < total; i++) {
      applyOneReplayEvent(ctx, events, i, compat, afterEachEvent);
      const current = i + 1;
      if (current === total || current % yieldEvery === 0) {
        onProgress?.(current, total);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    try {
      reconcileZonesConsistency(ctx as any);
    } catch {
      /* swallow */
    }
  } finally {
    endReplayPass(ctx, events);
  }
}


