/**
 * Apply a collapsed run of identical counter-placement trigger instances
 * (event "resolveIdenticalCounterRun", see socket/identicalTriggerCollapsedCounterRun.ts).
 *
 * The live path appends this event through appendGameEvent, so live play and replay run
 * exactly this code: remove the listed stack items, add the summed per-permanent counter
 * deltas (already final: replacement effects and counter-placed watchers were verified
 * absent before collapsing), one SBA pass, then priority returns to the active player as
 * after any resolution (CR 117.3b).
 *
 * Public entry symbols: applyResolveIdenticalCounterRun.
 */
import type { GameContext } from "../context.js";
import { updateCounters } from "./counters_tokens.js";
import { runSBA } from "./counters_tokens-handlers/countersTokensStateBasedActions.js";
import { debugWarn } from "../../utils/debug.js";

export type IdenticalCounterRunUpdate = { permanentId: string; deltas: Record<string, number> };

export function applyResolveIdenticalCounterRun(ctx: GameContext, e: any): void {
  try {
    const state = ctx.state as any;
    const ids = new Set<string>(
      (Array.isArray(e?.stackItemIds) ? e.stackItemIds : []).map((id: unknown) => String(id || "")).filter(Boolean),
    );
    if (Array.isArray(state.stack) && ids.size > 0) {
      state.stack = state.stack.filter((item: any) => !ids.has(String(item?.id || "")));
    }

    const updates: IdenticalCounterRunUpdate[] = Array.isArray(e?.updates) ? e.updates : [];
    for (const update of updates) {
      if (!update?.permanentId) continue;
      updateCounters(ctx, String(update.permanentId), update.deltas || {}, {
        skipEventPersistence: true,
        skipCounterModifications: true,
        skipCounterPlacedTriggers: true,
        deferRunSBA: true,
      });
    }
    runSBA(ctx);

    state.priorityPassedBy = new Set<string>();
    if (state.turnPlayer) state.priority = state.turnPlayer;
    if ((ctx as any).passesInRow && typeof (ctx as any).passesInRow === "object") {
      (ctx as any).passesInRow.value = 0;
    }
    if (typeof (ctx as any).bumpSeq === "function") (ctx as any).bumpSeq();
  } catch (err) {
    debugWarn(1, "applyEvent(resolveIdenticalCounterRun): failed", err);
  }
}