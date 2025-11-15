/**
 * Event application / replay / reset helpers.
 *
 * Exports:
 * - applyEvent(ctx, e)
 * - replay(ctx, events)
 * - reset(ctx, preservePlayers)
 * - skip(ctx, playerId)
 * - unskip(ctx, playerId)
 * - remove(ctx, playerId)
 *
 * NOTE: This file contains a safe fallback reset implementation that
 * clears player hands, pendingInitialDraw and resets libraries when the
 * engine's dedicated reset is not available. This prevents the "old hand + new hand"
 * situation on import.
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../types";
import type { GameEvent } from "../types";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  searchLibrary,
  reconcileZonesConsistency,
} from "./zones";
import { applyScry, applySurveil } from "./zones_helpers";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  applyEngineEffects,
  runSBA,
} from "./counters_tokens";
import { pushStack, resolveTopOfStack, playLand } from "./stack";
import { nextTurn, nextStep, passPriority } from "./turn";
import { uid } from "../utils";

/* NOTE: replayModule may be present in your project; if so prefer it.
   If you have a separate replay implementation, it will be detected at runtime. */
declare const replayModule: any;

/* applyEvent: mirror of the original monolithic behavior */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  switch (e.type) {
    case "rngSeed":
      ctx.rngSeed = (e as any).seed >>> 0;
      ctx.rng = (function(seed: number) {
        let t = seed;
        return () => {
          t = (t + 0x6D2B79F5) >>> 0;
          let r = t;
          r = Math.imul(r ^ (r >>> 15), r | 1);
          r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
          return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
      })(ctx.rngSeed);
      ctx.bumpSeq();
      break;

    case "setTurnDirection":
      ctx.state.turnDirection = (e as any).direction;
      ctx.bumpSeq();
      break;

    case "join":
      // join is handled by join module; skip mutation here
      break;

    case "restart":
      reset(ctx, Boolean((e as any).preservePlayers));
      break;

    case "skipPlayer":
      skip(ctx, (e as any).playerId);
      break;

    case "unskipPlayer":
      unskip(ctx, (e as any).playerId);
      break;

    case "spectatorGrant": {
      const set = ctx.grants.get((e as any).owner) ?? new Set<PlayerID>();
      set.add((e as any).spectator);
      ctx.grants.set((e as any).owner, set);
      ctx.bumpSeq();
      break;
    }

    case "spectatorRevoke": {
      const set = ctx.grants.get((e as any).owner) ?? new Set<PlayerID>();
      set.delete((e as any).spectator);
      ctx.grants.set((e as any).owner, set);
      ctx.bumpSeq();
      break;
    }

    case "deckImportResolved":
      importDeckResolved(ctx, (e as any).playerId, (e as any).cards);
      break;

    case "shuffleLibrary":
      shuffleLibrary(ctx, (e as any).playerId);
      break;

    case "drawCards":
      drawCards(ctx, (e as any).playerId, (e as any).count);
      break;

    case "selectFromLibrary":
      selectFromLibrary(ctx, (e as any).playerId, (e as any).cardIds, (e as any).moveTo);
      break;

    case "handIntoLibrary":
      moveHandToLibrary(ctx, (e as any).playerId);
      break;

    case "setCommander":
      setCommander(ctx, (e as any).playerId, (e as any).commanderNames, (e as any).commanderIds, (e as any).colorIdentity);
      break;

    case "castCommander":
      castCommander(ctx, (e as any).playerId, (e as any).commanderId);
      break;

    case "moveCommanderToCZ":
      moveCommanderToCZ(ctx, (e as any).playerId, (e as any).commanderId);
      break;

    case "updateCounters":
      updateCounters(ctx, (e as any).permanentId, (e as any).deltas);
      break;

    case "updateCountersBulk":
      applyUpdateCountersBulk(ctx, (e as any).updates);
      break;

    case "createToken":
      createToken(ctx, (e as any).controller, (e as any).name, (e as any).count, (e as any).basePower, (e as any).baseToughness);
      break;

    case "removePermanent":
      removePermanent(ctx, (e as any).permanentId);
      break;

    case "dealDamage": {
      const effects: any[] = [];
      applyEngineEffects(ctx, effects);
      runSBA(ctx);
      break;
    }

    case "resolveSpell": {
      // resolution logic should be handled by callers; no-op here
      break;
    }

    case "pushStack":
      pushStack(ctx, (e as any).item);
      break;

    case "resolveTopOfStack":
      resolveTopOfStack(ctx);
      break;

    case "playLand":
      playLand(ctx, (e as any).playerId, (e as any).card);
      break;

    case "nextTurn":
      nextTurn(ctx);
      break;

    case "nextStep":
      nextStep(ctx);
      break;

    case "reorderHand":
      zonesReorderHand(ctx, (e as any).playerId, (e as any).order);
      break;

    case "shuffleHand":
      zonesShuffleHand(ctx, (e as any).playerId);
      break;

    case "scryResolve":
      applyScry(ctx, (e as any).playerId, (e as any).keepTopOrder, (e as any).bottomOrder);
      break;

    case "surveilResolve":
      applySurveil(ctx, (e as any).playerId, (e as any).toGraveyard, (e as any).keepTopOrder);
      break;

    case "passPriority":
      // handled elsewhere
      break;

    default:
      // Unknown event type - fail closed (no state mutation)
      console.warn("applyEvent: unknown event type", (e as any).type);
      break;
  }
}

/**
 * Replay a sequence of events into the context (used for loading / replays)
 */
export function replay(ctx: GameContext, events: GameEvent[]) {
  for (const e of events) {
    if (e.type === "passPriority") {
      passPriority(ctx, (e as any).by);
    } else {
      applyEvent(ctx, e);
    }
  }
  reconcileZonesConsistency(ctx);
}

/**
 * Safe reset fallback.
 *
 * Preferred behavior:
 * - If a replayModule.reset exists, use it.
 * - Else if ctx.reset exists, call it.
 * - Otherwise perform a best-effort reset that:
 *    * preserves participants list when preservePlayers === true
 *    * preserves identity of ctx.state.zones, ctx.state.life, ctx.state.commandZone where possible
 *    * clears per-player hands (hand arrays + handCount)
 *    * resets ctx.libraries entries for players to empty arrays
 *    * clears pendingInitialDraw so no stale flag remains
 */
export function reset(ctx: any, preservePlayers: boolean): void {
  if (!ctx) throw new Error("reset: missing ctx");

  if (typeof replayModule !== "undefined" && replayModule && typeof (replayModule as any).reset === "function") {
    return (replayModule as any).reset(ctx, preservePlayers);
  }

  if (typeof ctx.reset === "function") {
    return ctx.reset(preservePlayers);
  }

  try {
    // Backup participants if needed
    const playersBackup = preservePlayers && typeof ctx.participants === "function" ? ctx.participants().slice() : [];

    // Create a base state if available; else shallow copy existing state
    const baseState = typeof ctx.createInitialState === "function" ? ctx.createInitialState() : { ...(ctx.state || {}) };

    // Preserve object identities for commonly referenced maps/objects
    const zonesRef = ctx.state && ctx.state.zones ? ctx.state.zones : (baseState.zones || {});
    const lifeRef = ctx.state && ctx.state.life ? ctx.state.life : (baseState.life || {});
    const commandZoneRef = ctx.state && ctx.state.commandZone ? ctx.state.commandZone : (baseState.commandZone || {});

    // Replace state, reattach preserved objects
    ctx.state = baseState;
    ctx.state.zones = zonesRef;
    ctx.state.life = lifeRef;
    ctx.state.commandZone = commandZoneRef;

    // Restore participants list identity if present
    if (preservePlayers && Array.isArray(playersBackup)) {
      if (Array.isArray((ctx as any).participantsList)) {
        (ctx as any).participantsList.length = 0;
        (ctx as any).participantsList.push(...playersBackup);
      } else {
        (ctx as any).participantsList = playersBackup.slice();
      }
    } else {
      if (Array.isArray((ctx as any).participantsList)) (ctx as any).participantsList.length = 0;
      else (ctx as any).participantsList = [];
    }

    // Ensure libraries map exists
    if (!ctx.libraries || typeof ctx.libraries !== "object") {
      try { ctx.libraries = new Map<PlayerID, any[]>(); } catch { ctx.libraries = {}; }
    }

    // Compute player ids to initialize/clear zones for
    const playerIds: PlayerID[] = preservePlayers && Array.isArray(playersBackup)
      ? playersBackup.map(p => p.playerId).filter(Boolean)
      : Object.keys(ctx.state.zones || {}) as PlayerID[];

    // Normalize zones and clear hands & libraries
    if (!ctx.state.zones || typeof ctx.state.zones !== "object") ctx.state.zones = {};
    for (const pid of playerIds) {
      if (!pid) continue;
      ctx.state.zones[pid] = ctx.state.zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
      // Clear hand
      try { ctx.state.zones[pid].hand = []; } catch { ctx.state.zones[pid] = { ...(ctx.state.zones[pid] || {}), hand: [] }; }
      ctx.state.zones[pid].handCount = 0;

      // Reset library container for this player
      try {
        if (ctx.libraries && typeof ctx.libraries.set === "function") ctx.libraries.set(pid, []);
        else ctx.libraries[pid] = [];
      } catch (e) {
        // ignore
      }

      // Update libraryCount and graveyardCount
      try {
        const libArr = (ctx.libraries && typeof ctx.libraries.get === "function") ? ctx.libraries.get(pid) : (ctx.libraries ? ctx.libraries[pid] : undefined);
        ctx.state.zones[pid].libraryCount = Array.isArray(libArr) ? libArr.length : 0;
      } catch {
        ctx.state.zones[pid].libraryCount = 0;
      }
      if (!Array.isArray(ctx.state.zones[pid].graveyard)) ctx.state.zones[pid].graveyard = [];
      ctx.state.zones[pid].graveyardCount = (ctx.state.zones[pid].graveyard || []).length;
    }

    // Clear pending initial draw flags to avoid double-draws
    try {
      if ((ctx as any).pendingInitialDraw && typeof (ctx as any).pendingInitialDraw.clear === "function") {
        (ctx as any).pendingInitialDraw.clear();
      } else {
        (ctx as any).pendingInitialDraw = new Set<PlayerID>();
      }
    } catch {
      (ctx as any).pendingInitialDraw = new Set<PlayerID>();
    }

    // Reset seq counters conservatively
    try { if (ctx.seq && typeof ctx.seq === "object" && "value" in ctx.seq) ctx.seq.value = 0; } catch {}
    try { if (ctx.passesInRow && typeof ctx.passesInRow === "object" && "value" in ctx.passesInRow) ctx.passesInRow.value = 0; } catch {}
    try { if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq(); } catch {}

  } catch (err) {
    console.warn("reset fallback failed:", err);
  }
}

/* Skip / unskip / remove fallbacks (prefer module implementations) */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (typeof (ctx as any).skip === "function") return ctx.skip(playerId);
  try {
    if (!((ctx as any).skipped instanceof Set)) (ctx as any).skipped = new Set<PlayerID>();
    (ctx as any).skipped.add(playerId);
  } catch (err) {
    console.warn("skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (typeof (ctx as any).unskip === "function") return ctx.unskip(playerId);
  try {
    if ((ctx as any).skipped instanceof Set) (ctx as any).skipped.delete(playerId);
  } catch (err) {
    console.warn("unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (typeof (ctx as any).remove === "function") return ctx.remove(playerId);
  try {
    if (Array.isArray((ctx as any).participantsList)) {
      const idx = (ctx as any).participantsList.findIndex((p: any) => p.playerId === playerId);
      if (idx !== -1) (ctx as any).participantsList.splice(idx, 1);
    }
    if ((ctx as any).grants instanceof Map) {
      for (const [owner, set] of (ctx as any).grants.entries()) {
        if (set instanceof Set && set.has(playerId)) set.delete(playerId);
      }
    }
  } catch (err) {
    console.warn("remove fallback failed:", err);
  }
}