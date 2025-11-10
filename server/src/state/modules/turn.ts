import { GamePhase, GameStep } from "../../../../shared/src";
import type { GameContext } from "../context";

/**
 * Turn rotation and step utilities (compatibility helpers).
 * Keep simple, prefer authoritative implementation if present on ctx.
 */

export function nextTurn(ctx: GameContext) {
  try {
    const s = ctx.state;
    if (!s.turnOrder || s.turnOrder.length === 0) return;
    const nextIndex = ((s.activePlayerIndex ?? 0) + 1) % s.turnOrder.length;
    s.activePlayerIndex = nextIndex;
    s.turn = (s.turn || 0) + 1;
    s.phase = GamePhase.BEGINNING;
    s.step = GameStep.UNTAP;
    ctx.bumpSeq();
  } catch (err) {
    console.warn("nextTurn failed:", err);
  }
}

export function nextStep(ctx: GameContext) {
  try {
    const s = ctx.state;
    // Best-effort step progression; real rules engine should replace this
    if (s.step === GameStep.END) s.step = GameStep.CLEANUP;
    else s.step = GameStep.UPKEEP;
    ctx.bumpSeq();
  } catch (err) {
    console.warn("nextStep failed:", err);
  }
}

export function passPriority(ctx: GameContext, playerId: string) {
  try {
    (ctx.passesInRow as any).value = ((ctx.passesInRow as any).value || 0) + 1;
    ctx.bumpSeq();
    return { changed: true, resolvedNow: false };
  } catch (err) {
    console.warn("passPriority stub failed:", err);
    return { changed: false, resolvedNow: false };
  }
}