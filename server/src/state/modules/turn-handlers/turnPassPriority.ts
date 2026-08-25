// server/src/state/modules/turn-handlers/turnPassPriority.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: passPriority.
// Public entry symbols: passPriority.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function ensureSeq(ctx: any) {
  if (!ctx) return;
  if (!ctx.seq) {
    ctx.seq = { value: 0 };
  } else if (typeof ctx.seq === "number") {
    ctx.seq = { value: ctx.seq };
  } else if (typeof ctx.seq === "object" && !("value" in ctx.seq)) {
    (ctx.seq as any).value = 0;
  }
}

/**
 * Pass priority: called when a player passes priority.
 * Returns { changed: boolean, resolvedNow?: boolean, advanceStep?: boolean }
 *
 * This implementation is a defensive, simple rotation:
 * - If ctx.state.priority is not set, set to first active player and return changed=true.
 * - Otherwise move to next active player. If nothing changes, return changed=false.
 * - If all players pass priority with empty stack, returns advanceStep=true.
 * - If all players pass priority with non-empty stack, returns resolvedNow=true.
 *
 * Note: This is a simplified behavior suitable for replay and initial server runs.
 * More advanced rule handling (stack resolution, automatic passes) belongs in rules engine.
 */
export function passPriority(ctx: GameContext, playerId?: PlayerID) {
  try {
    ensureSeq(ctx);
    const state: any = (ctx as any).state || {};
    const players = Array.isArray(state.players) ? state.players.map((p: any) => p.id) : [];

    // Ensure active set exists
    const inactiveSet: Set<string> =
      (ctx as any).inactive instanceof Set ? (ctx as any).inactive : new Set<string>();

    const active = players.filter((id: string) => !inactiveSet.has(id));
    if (!active.length) {
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    // If no priority set, give to first active
    if (!state.priority) {
      state.priority = active[0];
      // Reset priority pass tracking
      state.priorityPassedBy = new Set<string>();
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false, advanceStep: false };
    }

    // If playerId provided but doesn't match current priority, ignore (no change)
    if (playerId && state.priority !== playerId) {
      // allow a replayed passPriority by other actor to still advance if desired:
      // treat as no-op to be conservative
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    // Track that this player passed priority
    // Initialize priorityPassedBy set if it doesn't exist
    if (!state.priorityPassedBy || !(state.priorityPassedBy instanceof Set)) {
      state.priorityPassedBy = new Set<string>();
    }
    state.priorityPassedBy.add(playerId || state.priority);

    // Check if there's something on the stack
    const stackLen = Array.isArray(state.stack) ? state.stack.length : 0;

    // For single-player games, passing priority should resolve/advance immediately
    if (active.length === 1) {
      if (stackLen > 0) {
        // Single player passed priority with stack items - resolve immediately
        state.priorityPassedBy = new Set<string>(); // Reset tracking
        ctx.bumpSeq();
        return { changed: true, resolvedNow: true, advanceStep: false };
      }
      // Single player, empty stack - advance to next step
      state.priorityPassedBy = new Set<string>(); // Reset tracking
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false, advanceStep: true };
    }

    // Multi-player: find index of current priority in active array
    const curIndex = active.indexOf(state.priority);
    let nextIndex = 0;
    if (curIndex === -1) {
      nextIndex = 0;
    } else {
      nextIndex = (curIndex + 1) % active.length;
    }

    const nextId = active[nextIndex];

    // Check if all active players have passed priority
    const allPassed = active.every(id => state.priorityPassedBy.has(id));

    if (allPassed) {
      // All players have passed priority
      state.priorityPassedBy = new Set<string>(); // Reset tracking for next round

      if (stackLen > 0) {
        // Resolve the top of the stack
        state.priority = state.turnPlayer; // Give priority back to turn player after resolution
        ctx.bumpSeq();
        return { changed: true, resolvedNow: true, advanceStep: false };
      } else {
        // Empty stack - advance to next step
        state.priority = state.turnPlayer; // Give priority back to turn player
        ctx.bumpSeq();
        return { changed: true, resolvedNow: false, advanceStep: true };
      }
    }

    // If priority stays the same (shouldn't happen with >1 active), no change
    if (nextId === state.priority) {
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    state.priority = nextId;
    ctx.bumpSeq();

    return { changed: true, resolvedNow: false, advanceStep: false };
  } catch (err) {
    debugWarn(1, `${ts()} passPriority stub failed:`, err);
    return { changed: false, resolvedNow: false, advanceStep: false };
  }
}
