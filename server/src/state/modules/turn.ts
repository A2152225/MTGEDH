import { GamePhase, GameStep } from "../../../../shared/src";
import type { GameContext } from "../context";
import { reconcileZonesConsistency, drawCards } from "./zones";

/**
 * Robust turn/step progression with scheduling support for extra/inserted steps.
 *
 * - nextStep respects a runtime step queue (ctx.stepQueue) which modules can push extra steps into.
 * - scheduleStepsAfterCurrent, scheduleStepsAtEndOfTurn, removeScheduledSteps are helpers.
 * - If CLEANUP is reached and there's nothing queued, nextStep rolls to nextTurn().
 */

/* Canonical step order used when no queued steps are pending */
const STEP_ORDER: GameStep[] = [
  GameStep.UNTAP,
  GameStep.UPKEEP,
  GameStep.DRAW,
  GameStep.MAIN1,
  GameStep.BEGIN_COMBAT,
  GameStep.DECLARE_ATTACKERS,
  GameStep.DECLARE_BLOCKERS,
  GameStep.DAMAGE,
  GameStep.END_COMBAT,
  GameStep.MAIN2,
  GameStep.END_STEP,
  GameStep.CLEANUP,
];

function getStepQueue(ctx: GameContext): GameStep[] {
  const anyCtx = ctx as any;
  if (!Array.isArray(anyCtx.stepQueue)) anyCtx.stepQueue = [];
  return anyCtx.stepQueue as GameStep[];
}

/* Scheduling helpers ----------------------------------------------------- */

/**
 * Schedule steps to run immediately after the current step (i.e., become the next steps).
 * The provided steps array is placed at the front of the queue in the same order.
 */
export function scheduleStepsAfterCurrent(ctx: GameContext, steps: GameStep[]) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  const q = getStepQueue(ctx);
  for (let i = steps.length - 1; i >= 0; i--) q.unshift(steps[i]);
}

/**
 * Schedule steps to run at the end of the turn (i.e., after the normal step order completes).
 * These are appended to the queue.
 */
export function scheduleStepsAtEndOfTurn(ctx: GameContext, steps: GameStep[]) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  const q = getStepQueue(ctx);
  for (const s of steps) q.push(s);
}

/**
 * Remove specified steps from the queue (by matching enum value). Returns number removed.
 */
export function removeScheduledSteps(ctx: GameContext, stepsToRemove: Array<GameStep | string>) {
  if (!Array.isArray(stepsToRemove) || stepsToRemove.length === 0) return 0;
  const q = getStepQueue(ctx);
  const normalized = new Set(
    stepsToRemove.map((s) => {
      if (typeof s === "string") {
        // accept either key or value; normalize to enum value string from GameStep
        const key = String(s).trim();
        // try to find matching enum value (case-insensitive)
        for (const v of Object.values(GameStep)) {
          if (String(v).toLowerCase() === key.toLowerCase() || String((GameStep as any)[key]) === v) return v;
        }
        return key;
      }
      return s;
    })
  );
  const before = q.length;
  (ctx as any).stepQueue = q.filter((s: GameStep) => !normalized.has(s));
  return before - ((ctx as any).stepQueue as GameStep[]).length;
}

/**
 * Clear any scheduled (queued) steps.
 */
export function clearScheduledSteps(ctx: GameContext) {
  (ctx as any).stepQueue = [];
}

/**
 * Peek scheduled steps (for debug / UI).
 */
export function getScheduledSteps(ctx: GameContext): GameStep[] {
  return [...getStepQueue(ctx)];
}

/* Turn/step core logic -------------------------------------------------- */

export function nextTurn(ctx: GameContext) {
  try {
    const s = ctx.state;
    if (!s.turnOrder || s.turnOrder.length === 0) return;
    const nextIndex = ((s.activePlayerIndex ?? 0) + 1) % s.turnOrder.length;
    s.activePlayerIndex = nextIndex;
    s.turn = (s.turn || 0) + 1;
    s.turnPlayer = (s.turnOrder && s.turnOrder[s.activePlayerIndex]) || s.turnPlayer;
    s.phase = GamePhase.BEGINNING;
    s.step = GameStep.UNTAP;
    reconcileZonesConsistency(ctx, s.turnPlayer);
    ctx.bumpSeq();
  } catch (err) {
    console.warn("nextTurn failed:", err);
  }
}

function untapControllerPermanents(ctx: GameContext, playerId?: string) {
  try {
    if (!playerId) return;
    const bf = ctx.state.battlefield || [];
    for (const perm of bf) {
      if (perm.controller === playerId && perm.tapped) perm.tapped = false;
    }
  } catch (err) {
    console.warn("untapControllerPermanents failed:", err);
  }
}

export function nextStep(ctx: GameContext) {
  try {
    const s = ctx.state;
    const q = getStepQueue(ctx);

    if (!s.step) {
      s.step = GameStep.UNTAP;
      s.phase = GamePhase.BEGINNING;
      ctx.bumpSeq();
      return;
    }

    if (s.step === GameStep.CLEANUP && q.length === 0) {
      nextTurn(ctx);
      return;
    }

    if (q.length > 0) {
      const nextQueued = q.shift()!;
      s.step = nextQueued;
    } else {
      const idx = STEP_ORDER.indexOf(s.step as GameStep);
      const nextIdx = idx === -1 ? 0 : (idx + 1) % STEP_ORDER.length;
      const nextStep = STEP_ORDER[nextIdx];
      if (s.step === GameStep.CLEANUP) {
        nextTurn(ctx);
        return;
      }
      s.step = nextStep;
    }

    // Map step -> phase
    if (s.step === GameStep.MAIN1) s.phase = GamePhase.PRECOMBAT_MAIN;
    else if (s.step === GameStep.MAIN2) s.phase = GamePhase.POSTCOMBAT_MAIN;
    else if (
      s.step === GameStep.UNTAP ||
      s.step === GameStep.UPKEEP ||
      s.step === GameStep.DRAW
    ) {
      s.phase = GamePhase.BEGINNING;
    } else if (
      s.step === GameStep.BEGIN_COMBAT ||
      s.step === GameStep.DECLARE_ATTACKERS ||
      s.step === GameStep.DECLARE_BLOCKERS ||
      s.step === GameStep.DAMAGE ||
      s.step === GameStep.END_COMBAT
    ) {
      s.phase = GamePhase.COMBAT;
    } else if (s.step === GameStep.END_STEP || s.step === GameStep.CLEANUP) {
      s.phase = GamePhase.ENDING;
    }

    // Automations
    const activePlayer = s.turnPlayer;
    if (s.step === GameStep.UNTAP) {
      untapControllerPermanents(ctx, activePlayer);
    } else if (s.step === GameStep.DRAW) {
      try {
        drawCards(ctx, activePlayer, 1);
      } catch (err) {
        console.warn("nextStep DRAW failed to draw for", activePlayer, err);
      }
    }

    ctx.bumpSeq();
  } catch (err) {
    console.warn("nextStep failed:", err);
  }
}

/* passPriority placeholder */
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