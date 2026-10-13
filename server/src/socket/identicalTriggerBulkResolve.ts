/**
 * Bulk resolution for runs of identical triggered abilities on top of the stack
 * (Cathars' Crusade x100 when 100 Mites enter, Soul Warden x71, ...).
 *
 * Rules stay intact: every instance still resolves on its own through the normal
 * persist-first resolveTopOfStack path (own replay event, own SBA pass, new
 * triggers pushed normally), and every player still passes priority between
 * instances. What the batch removes is the per-instance overhead: one broadcast
 * per pass, the human auto-pass delay and the client round trip.
 *
 * A player is only passed for when the engine would have passed for them anyway
 * (idle, auto-pass rest of turn, Smart Pass on their own trigger, a trigger
 * shortcut / yielded source), or when they explicitly asked to resolve the run
 * ("Resolve all identical (xN)"). The run stops as soon as:
 *   - the top of the stack is no longer the same trigger (new triggers went on top),
 *   - a resolution prompt or pending trigger ordering/targeting appears,
 *   - a player who has not consented and is not idle receives priority.
 *
 * Long runs resolve in short synchronous chunks and yield to the event loop
 * (setImmediate) between chunks, so throttled progress events flush and other
 * sockets stay responsive. Each instance (pass + resolve) is still one
 * synchronous unit, so ordering and the replay log are unchanged; every chunk
 * re-validates the stack top, prompts and priority before continuing. One run
 * per game at a time (isIdenticalTriggerBulkActive).
 *
 * Public entry symbols: identicalTriggerBulkKey, countIdenticalTopTriggerRun,
 *   continueIdenticalTriggerRun, runIdenticalTriggerRunAsync, isIdenticalTriggerBulkActive,
 *   captureIdenticalTriggerRun, continueCapturedIdenticalTriggerRun,
 *   emitIdenticalTriggerRunChat, IDENTICAL_TRIGGER_BULK_MIN_RUN.
 */
import type { Server } from "socket.io";
import type { InMemoryGame } from "../state/types.js";
import type { PlayerID } from "../../../shared/src/index.js";
import {
  contextHasBlockingNonPaymentResolutionSteps,
  contextPendingResolutionSummary,
} from "../state/resolution/resolutionQueueGameIds.js";
import { isPlayerIdleForAutoPass } from "../state/modules/can-respond.js";
import { getTopTriggeredAbilityAutoPassReason } from "./trigger-shortcuts.js";
import { shouldBypassIdleForNonEmptyStack } from "./util-handlers/autoPassTimerState.js";
import { appendGameEvent, persistAndResolveTopOfStack } from "./util-handlers/appendGameEvent.js";
import { runPostResolutionPermanentPromptChecks } from "./game-actions-handlers/gameActionsPermanentEntryPrompts.js";
import { isAiContextuallyIdleForAutoPass } from "./ai-handlers/aiAutoPassContextualIdle.js";
import { isGameReplayLocked } from "../gameRestoreState.js";
import { debug, debugWarn } from "../utils/debug.js";
import { createIdenticalTriggerBulkProgress, type IdenticalTriggerBulkStopReason } from "./identicalTriggerBulkProgress.js";
import { tryCollapseIdenticalCounterRun } from "./identicalTriggerCollapsedCounterRun.js";

/** Runs shorter than this resolve the normal way (no batching benefit). */
export const IDENTICAL_TRIGGER_BULK_MIN_RUN = 2;
const MAX_BULK_RESOLUTIONS = 2000;

/** Effect wording that means the instance asks someone for a decision while resolving. */
const CHOICE_EFFECT_RE = /\b(?:target|you may|choose|chosen by|any number|divided|distribute|vote|unless|in any order|of your choice|of their choice)\b|\bX\b/i;

function normalizeEffect(text: unknown): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasEntries(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set || value instanceof Map) return value.size > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Grouping key for a stack item, or null when the item may not be bulk-resolved
 * (not a trigger, optional, targeted, modal or otherwise asks for choices).
 */
export function identicalTriggerBulkKey(item: any): string | null {
  if (!item || item.type !== "triggered_ability") return null;
  if (item.mandatory === false || item.optional === true) return null;
  if (hasEntries(item.targets) || hasEntries(item.targetIds) || item.requiresTarget === true || item.needsTargets === true) return null;
  if (hasEntries(item.modes) || hasEntries(item.selectedModes) || item.isModal === true || item.modal === true) return null;
  if (item.isCopy === true || item.copyOf) return null;
  const effect = normalizeEffect(item.effect || item.description);
  if (!effect || CHOICE_EFFECT_RE.test(effect)) return null;
  const controller = String(item.controller || "").trim();
  const source = String(item.source || item.sourceId || item.permanentId || "").trim();
  const sourceName = String(item.sourceName || item.card?.name || "").trim().toLowerCase();
  if (!controller || (!source && !sourceName)) return null;
  return [controller, source, sourceName, String(item.triggerType || ""), effect].join("|");
}

function topItem(game: InMemoryGame): any | null {
  const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Length of the run of identical bulk-eligible triggers on top of the stack. */
export function countIdenticalTopTriggerRun(state: any): { key: string | null; count: number; sourceName: string } {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const key = identicalTriggerBulkKey(top);
  if (!key) return { key: null, count: 0, sourceName: "" };
  let count = 0;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (identicalTriggerBulkKey(stack[i]) !== key) break;
    count += 1;
  }
  return { key, count, sourceName: String(top?.sourceName || top?.card?.name || "Triggered ability") };
}

function hasPendingInteraction(game: InMemoryGame, gameId: string): boolean {
  if (contextPendingResolutionSummary(game, gameId).hasPending) return true;
  if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) return true;
  const state = game.state as any;
  return hasEntries(state?.pendingTriggerOrdering)
    || hasEntries(state?.pendingDamageTriggers)
    || hasEntries(state?.pendingTargets)
    || state?.priority == null;
}

/** Same consent rules checkAndTriggerAutoPass / autoPassLoop apply, minus the delay. */
function holderWouldPass(game: InMemoryGame, holder: string, consentingPlayerId?: string): boolean {
  if (consentingPlayerId && holder === consentingPlayerId) return true;
  const state = game.state as any;
  if (state?.priorityClaimed instanceof Set && state.priorityClaimed.has(holder)) return false;
  if (String(state?._pauseHumanAutoPassUntilActionFor || "").trim() === holder) return false;
  if (state?.autoPassForTurn?.[holder]) return true;
  if (getTopTriggeredAbilityAutoPassReason(state, holder)) return true;
  const stackLen = Array.isArray(state?.stack) ? state.stack.length : 0;
  if (shouldBypassIdleForNonEmptyStack({
    stackLen,
    autoPassEnabled: state?.autoPassPlayers instanceof Set ? state.autoPassPlayers.has(holder) : false,
    loopStackDrain: state?.loopShortcutStackDrain?.[holder] === true,
    autoPassForTurn: false,
    state,
    playerId: holder,
  })) return true;
  const ctx = (game as any).ctx || game;
  try {
    if (isPlayerIdleForAutoPass(ctx, holder as PlayerID)) return true;
  } catch {
    return false;
  }
  try {
    return isAiContextuallyIdleForAutoPass(ctx, holder as PlayerID);
  } catch {
    return false;
  }
}

function beginSuppressBroadcast(game: InMemoryGame): void {
  const state = game.state as any;
  state._suppressBroadcastCount = Math.max(0, Number(state._suppressBroadcastCount) || 0) + 1;
}

function endSuppressBroadcast(game: InMemoryGame): void {
  const state = game.state as any;
  const next = Math.max(0, (Number(state._suppressBroadcastCount) || 0) - 1);
  if (next <= 0) delete state._suppressBroadcastCount;
  else state._suppressBroadcastCount = next;
}

/**
 * Pass + resolve exactly one instance as a single synchronous unit. Returns null when it
 * resolved, otherwise why the run has to stop.
 */
function resolveOneIdenticalInstance(
  io: Server | null,
  game: InMemoryGame,
  gameId: string,
  key: string,
  consentingPlayerId?: string,
): IdenticalTriggerBulkStopReason | null {
  if (identicalTriggerBulkKey(topItem(game)) !== key) return "different_top";
  if (hasPendingInteraction(game, gameId)) return "pending_choice";

  // One priority round for this instance: pass for consenting / idle holders until
  // the engine reports that everyone passed (resolvedNow) or someone may act.
  let resolvedNow = false;
  const playerCount = Array.isArray((game.state as any)?.players) ? (game.state as any).players.length : 4;
  for (let pass = 0; pass <= playerCount + 1 && !resolvedNow; pass += 1) {
    const holder = String((game.state as any)?.priority || "").trim();
    if (!holder || !holderWouldPass(game, holder, consentingPlayerId)) return "player_can_respond";
    const result = (game as any).passPriority(holder, true);
    if (!result?.changed) return "player_can_respond";
    appendGameEvent(game, gameId, "passPriority", { by: holder, auto: true, bulk: true });
    resolvedNow = Boolean(result.resolvedNow);
  }
  if (!resolvedNow) return "player_can_respond";
  if (!persistAndResolveTopOfStack(game, gameId, { auto: true, bulk: true })) return "error";
  if (io) {
    try {
      runPostResolutionPermanentPromptChecks(io, game, gameId);
    } catch (err) {
      debugWarn(1, "[identicalTriggerBulk] post-resolution prompt checks failed", err);
      return "error";
    }
  }
  return null;
}

/** Contiguous run items for `key`, top of the stack first. */
function runItemsFor(game: InMemoryGame, key: string): any[] {
  const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
  const out: any[] = [];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (identicalTriggerBulkKey(stack[i]) !== key) break;
    out.push(stack[i]);
  }
  return out;
}

/**
 * Collapse deterministic counter-placement runs into one event when every player
 * consents (see identicalTriggerCollapsedCounterRun.ts). Returns instances resolved.
 */
function collapseIdenticalRunIfPossible(
  io: Server | null,
  game: InMemoryGame,
  gameId: string,
  key: string,
  consentingPlayerId: string | undefined,
  limit: number,
): number {
  try {
    return tryCollapseIdenticalCounterRun(io, game, gameId, {
      key,
      limit,
      runItems: () => runItemsFor(game, key),
      everyoneConsents: () => {
        if (hasPendingInteraction(game, gameId)) return false;
        const players = Array.isArray((game.state as any)?.players) ? (game.state as any).players : [];
        const active = players.filter((p: any) => p && !p.spectator && !p.hasLost && !p.eliminated);
        return active.length > 0 && active.every((p: any) => holderWouldPass(game, String(p.id), consentingPlayerId));
      },
      resolveOne: () => resolveOneIdenticalInstance(io, game, gameId, key, consentingPlayerId) === null,
    });
  } catch (err) {
    debugWarn(1, "[identicalTriggerBulk] collapse failed; continuing per instance", err);
    return 0;
  }
}

/**
 * Synchronous variant (no yielding, no progress): keep resolving while the top of the
 * stack is the trigger identified by `key` and every priority holder passes.
 * Returns how many instances resolved. Caller broadcasts afterwards.
 */
export function continueIdenticalTriggerRun(
  io: Server | null,
  game: InMemoryGame,
  gameId: string,
  options: { key: string | null; consentingPlayerId?: string; maxCount?: number },
): number {
  const key = options.key;
  if (!key || isGameReplayLocked(game, gameId)) return 0;
  const limit = Math.max(0, Math.min(MAX_BULK_RESOLUTIONS, options.maxCount ?? MAX_BULK_RESOLUTIONS));
  let resolved = 0;
  beginSuppressBroadcast(game);
  try {
    resolved += collapseIdenticalRunIfPossible(io, game, gameId, key, options.consentingPlayerId, limit);
    while (resolved < limit && resolveOneIdenticalInstance(io, game, gameId, key, options.consentingPlayerId) === null) {
      resolved += 1;
    }
  } finally {
    endSuppressBroadcast(game);
  }
  if (resolved > 0 && typeof (game as any).bumpSeq === "function") (game as any).bumpSeq();
  debug(2, `[identicalTriggerBulk] resolved ${resolved} instance(s) of ${key}`);
  return resolved;
}

/** Instances per synchronous chunk before yielding to the event loop. */
export const IDENTICAL_TRIGGER_BULK_CHUNK_SIZE = 5;
/** A chunk also ends once it has run this long (big boards resolve slower). */
const CHUNK_TIME_BUDGET_MS = 60;
/** Runs shorter than this stay silent (no progress events). */
const PROGRESS_MIN_TOTAL = 3;

const activeRuns = new Set<string>();

export function isIdenticalTriggerBulkActive(gameId: string): boolean {
  return activeRuns.has(String(gameId || ""));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Chunked, yielding run with throttled progress events to the game room.
 * Broadcasts are suppressed only inside a chunk, never across a yield, so other
 * handlers that run in between still broadcast normally.
 */
export async function runIdenticalTriggerRunAsync(
  io: Server | null,
  game: InMemoryGame,
  gameId: string,
  options: {
    key: string | null;
    consentingPlayerId?: string;
    maxCount?: number;
    sourceName?: string;
    /** Instances of this run already resolved by the caller (counted in progress). */
    alreadyResolved?: number;
  },
): Promise<{ resolved: number; reason: IdenticalTriggerBulkStopReason }> {
  const key = options.key;
  if (!key || isGameReplayLocked(game, gameId)) return { resolved: 0, reason: "different_top" };
  if (activeRuns.has(gameId)) return { resolved: 0, reason: "busy" };

  const limit = Math.max(0, Math.min(MAX_BULK_RESOLUTIONS, options.maxCount ?? MAX_BULK_RESOLUTIONS));
  const already = Math.max(0, options.alreadyResolved ?? 0);
  const run = countIdenticalTopTriggerRun(game.state);
  const remaining = run.key === key ? Math.min(limit, run.count) : 0;
  const total = already + remaining;
  const progress = createIdenticalTriggerBulkProgress(io, gameId, {
    sourceName: options.sourceName || run.sourceName,
    total,
    silent: remaining < PROGRESS_MIN_TOTAL,
  });

  activeRuns.add(gameId);
  let resolved = 0;
  let reason: IdenticalTriggerBulkStopReason = "complete";
  progress.start(already);
  try {
    beginSuppressBroadcast(game);
    try {
      resolved += collapseIdenticalRunIfPossible(io, game, gameId, key, options.consentingPlayerId, limit);
    } finally {
      endSuppressBroadcast(game);
    }
    if (resolved > 0) progress.update(already + resolved);
    outer: while (resolved < limit) {
      const chunkStart = Date.now();
      let inChunk = 0;
      beginSuppressBroadcast(game);
      try {
        while (resolved < limit && inChunk < IDENTICAL_TRIGGER_BULK_CHUNK_SIZE && Date.now() - chunkStart < CHUNK_TIME_BUDGET_MS) {
          const stop = resolveOneIdenticalInstance(io, game, gameId, key, options.consentingPlayerId);
          if (stop) {
            reason = stop === "different_top" && resolved >= remaining ? "complete" : stop;
            break outer;
          }
          resolved += 1;
          inChunk += 1;
        }
      } finally {
        endSuppressBroadcast(game);
      }
      progress.update(already + resolved);
      if (resolved >= limit) break;
      await yieldToEventLoop();
    }
  } catch (err) {
    reason = "error";
    debugWarn(1, "[identicalTriggerBulk] run failed", err);
  } finally {
    // The outer finally runs after break-out-of-chunk too: make sure suppression is cleared.
    activeRuns.delete(gameId);
    if (resolved > 0 && typeof (game as any).bumpSeq === "function") (game as any).bumpSeq();
    progress.end(already + resolved, reason);
  }
  const holderAtStop = String((game.state as any)?.priority || "");
  debug(1, `[identicalTriggerBulk] async run resolved ${resolved}/${remaining} of ${key} (${reason}; holder=${holderAtStop || "none"})`);
  return { resolved, reason };
}

/** Chat line for a finished run ("Cathars' Crusade resolves x100."). */
export function emitIdenticalTriggerRunChat(io: Server, gameId: string, sourceName: string, count: number): void {
  if (count <= 1) return;
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}_bulk`,
    gameId,
    from: "system",
    message: `${sourceName || "Triggered ability"} resolves x${count}.`,
    ts: Date.now(),
  });
}

export type CapturedIdenticalTriggerRun = { key: string | null; sourceName: string };

/** Call before resolving the top of the stack; pass the result to continueCapturedIdenticalTriggerRun. */
export function captureIdenticalTriggerRun(game: InMemoryGame): CapturedIdenticalTriggerRun {
  const top = topItem(game);
  return { key: identicalTriggerBulkKey(top), sourceName: String(top?.sourceName || top?.card?.name || "") };
}

/**
 * After one instance resolved through the normal pass path, keep going while the
 * next instance is identical and every holder would pass anyway. Emits progress and
 * one chat line for the whole run; calls afterRun (e.g. broadcast) when anything
 * resolved. Returns the number of extra instances resolved.
 */
export async function continueCapturedIdenticalTriggerRun(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  captured: CapturedIdenticalTriggerRun,
  afterRun?: () => void,
  /**
   * A player who just chose to pass on the first instance (the AI executor passes its
   * own id). Instances are identical and choice-free, so that choice carries over;
   * without it every instance stopped at the AI (player_can_respond) and waited for
   * a full AI decision cycle (~20s on a 770-permanent board).
   */
  consentingPlayerId?: string,
): Promise<number> {
  if (!captured.key || activeRuns.has(gameId)) return 0;
  if (identicalTriggerBulkKey(topItem(game)) !== captured.key) return 0;
  try {
    const { resolved } = await runIdenticalTriggerRunAsync(io, game, gameId, {
      key: captured.key,
      sourceName: captured.sourceName,
      alreadyResolved: 1,
      consentingPlayerId,
    });
    if (resolved > 0) {
      emitIdenticalTriggerRunChat(io, gameId, captured.sourceName, resolved + 1);
      afterRun?.();
    }
    return resolved;
  } catch (err) {
    debugWarn(1, "[identicalTriggerBulk] automatic continuation failed", err);
    return 0;
  }
}
