/**
 * Compatibility module restoring applyEvent/replay/reset/skip/unskip/remove exports
 * expected by the state index wrapper after the monolith -> modules split.
 *
 * Each function prefers the authoritative implementation on the ctx when present.
 * Fallbacks are conservative to avoid silent data loss. If the ctx contains the
 * authoritative implementation, these wrappers simply delegate.
 */

import type { PlayerID } from "../types";
import type { GameEvent } from "../types";

/**
 * Apply a single persisted event into ctx. Prefers ctx.applyEvent if available.
 * Throws if no implementation present to avoid silent event loss.
 */
export function applyEvent(ctx: any, ev: GameEvent): void {
  if (!ctx) throw new Error("applyEvent: missing ctx");
  if (typeof ctx.applyEvent === "function") return ctx.applyEvent(ev);
  if (typeof (ctx as any).applyEventImpl === "function") return (ctx as any).applyEventImpl(ev);

  // Fail loudly to avoid dropping authoritative events silently.
  throw new Error("applyEvent: no implementation found on context");
}

/**
 * Replay an array of persisted events into ctx. Delegates to ctx.replay if present,
 * otherwise applies each event via applyEvent wrapper.
 */
export function replay(ctx: any, events: GameEvent[]): void {
  if (!ctx) throw new Error("replay: missing ctx");
  if (typeof ctx.replay === "function") return ctx.replay(events);

  // Fallback: try to apply each event using applyEvent wrapper (will throw if not present)
  for (const ev of events) applyEvent(ctx, ev);
}

/**
 * Reset the in-memory context. Prefer ctx.reset; fallback to conservative reinit.
 */
export function reset(ctx: any, preservePlayers: boolean): void {
  if (!ctx) throw new Error("reset: missing ctx");
  if (typeof ctx.reset === "function") return ctx.reset(preservePlayers);

  // Best-effort fallback: attempt to reinitialize a minimal state while preserving players
  try {
    const playersBackup = preservePlayers && typeof ctx.participants === "function" ? ctx.participants() : [];
    const baseState = typeof ctx.createInitialState === "function" ? ctx.createInitialState() : { ...ctx.state };
    ctx.state = baseState;
    // Reattach participants where implementation stores them on participantsList
    if (preservePlayers && Array.isArray(playersBackup) && Array.isArray((ctx as any).participantsList)) {
      (ctx as any).participantsList = playersBackup.slice();
    }
  } catch (err) {
    console.warn("reset fallback failed:", err);
  }
}

/**
 * Skip/unskip/remove wrappers prefer ctx implementations but have safe fallbacks.
 */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (typeof ctx.skip === "function") return ctx.skip(playerId);

  // fallback: track skipped players in a Set
  try {
    if (!((ctx as any).skipped instanceof Set)) (ctx as any).skipped = new Set<PlayerID>();
    (ctx as any).skipped.add(playerId);
  } catch (err) {
    console.warn("skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (typeof ctx.unskip === "function") return ctx.unskip(playerId);

  try {
    if ((ctx as any).skipped instanceof Set) (ctx as any).skipped.delete(playerId);
  } catch (err) {
    console.warn("unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (typeof ctx.remove === "function") return ctx.remove(playerId);

  // Best-effort fallback: remove participant records and references
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