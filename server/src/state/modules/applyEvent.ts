/**
 * Compatibility module restoring applyEvent/replay/reset/skip/unskip/remove exports
 * expected by the state index wrapper after the monolith -> modules split.
 *
 * Prefer authoritative implementations from the localized replay module when available,
 * then fall back to implementations attached to the ctx, and finally conservative
 * local fallbacks. This prevents "no implementation found on context" during replay.
 */

import type { PlayerID } from "../types";
import type { GameEvent } from "../types";
import * as replayModule from "./replay";

/**
 * Apply a single persisted event into ctx.
 * Preference order:
 * 1) replay module's applyEvent
 * 2) ctx.applyEvent
 * 3) ctx.applyEventImpl
 * 4) throw (fail loud)
 */
export function applyEvent(ctx: any, ev: GameEvent): void {
  if (!ctx) throw new Error("applyEvent: missing ctx");

  if (replayModule && typeof (replayModule as any).applyEvent === "function") {
    return (replayModule as any).applyEvent(ctx, ev);
  }

  if (typeof ctx.applyEvent === "function") {
    return ctx.applyEvent(ev);
  }
  if (typeof (ctx as any).applyEventImpl === "function") {
    return (ctx as any).applyEventImpl(ev);
  }

  // No authoritative impl found — throw so callers notice and we don't silently lose events.
  throw new Error("applyEvent: no implementation found on context");
}

/**
 * Replay an array of persisted events into ctx.
 * Preference order:
 * 1) replay module's replay
 * 2) call local applyEvent for each event
 */
export function replay(ctx: any, events: GameEvent[]): void {
  if (!ctx) throw new Error("replay: missing ctx");

  if (replayModule && typeof (replayModule as any).replay === "function") {
    return (replayModule as any).replay(ctx, events);
  }

  for (const ev of events) {
    applyEvent(ctx, ev);
  }
}

/**
 * Reset the in-memory context. Prefer replayModule.reset, then ctx.reset,
 * otherwise attempt a conservative reinitialization.
 */
export function reset(ctx: any, preservePlayers: boolean): void {
  if (!ctx) throw new Error("reset: missing ctx");

  if (replayModule && typeof (replayModule as any).reset === "function") {
    return (replayModule as any).reset(ctx, preservePlayers);
  }

  if (typeof ctx.reset === "function") {
    return ctx.reset(preservePlayers);
  }

  // Best-effort fallback: reinitialize minimal pieces of state without touching DB.
  try {
    const playersBackup = preservePlayers && typeof ctx.participants === "function" ? ctx.participants() : [];
    const baseState = typeof ctx.createInitialState === "function" ? ctx.createInitialState() : { ...ctx.state };
    ctx.state = baseState;
    if (preservePlayers && Array.isArray(playersBackup)) {
      if (Array.isArray((ctx as any).participantsList)) {
        (ctx as any).participantsList = playersBackup.slice();
      }
    }
  } catch (err) {
    console.warn("reset fallback failed:", err);
  }
}

/**
 * skip / unskip / remove — prefer replayModule or ctx implementations, otherwise safe fallbacks.
 */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (replayModule && typeof (replayModule as any).skip === "function") {
    return (replayModule as any).skip(ctx, playerId);
  }
  if (typeof ctx.skip === "function") return ctx.skip(playerId);

  try {
    if (!((ctx as any).skipped instanceof Set)) (ctx as any).skipped = new Set<PlayerID>();
    (ctx as any).skipped.add(playerId);
  } catch (err) {
    console.warn("skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (replayModule && typeof (replayModule as any).unskip === "function") {
    return (replayModule as any).unskip(ctx, playerId);
  }
  if (typeof ctx.unskip === "function") return ctx.unskip(playerId);

  try {
    if ((ctx as any).skipped instanceof Set) (ctx as any).skipped.delete(playerId);
  } catch (err) {
    console.warn("unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (replayModule && typeof (replayModule as any).remove === "function") {
    return (replayModule as any).remove(ctx, playerId);
  }
  if (typeof ctx.remove === "function") return ctx.remove(playerId);

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