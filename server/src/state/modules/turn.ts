// server/src/state/modules/turn.ts
// Turn / priority helpers used by server state. Full-file defensive implementation.
// Exports:
//  - passPriority(ctx, playerId)
//  - setTurnDirection(ctx, dir)
//  - nextTurn(ctx)
//  - nextStep(ctx)
//  - scheduleStepsAfterCurrent(ctx, steps)
//  - scheduleStepsAtEndOfTurn(ctx, steps)
//  - clearScheduledSteps(ctx)
//  - getScheduledSteps(ctx)
//  - removeScheduledSteps(ctx, steps)
//
// This implementation is intentionally defensive: it tolerates missing ctx fields,
// ensures ctx.seq exists, and avoids throwing when replaying older event streams.

import type { GameContext } from "../context";
import type { PlayerID } from "../../shared/src/types";
import { drawCards } from "./zones";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Ensure seq helper object present on ctx
 */
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
 * Bump sequence safely
 */
function safeBumpSeq(ctx: any) {
  try {
    ensureSeq(ctx);
    if (ctx.seq && typeof ctx.seq === "object") ctx.seq.value++;
    else if (typeof ctx.seq === "number") ctx.seq++;
  } catch {
    // ignore
  }
}

/**
 * Utility: get ordered active players (non-inactive) from ctx.state.players
 */
function activePlayers(ctx: GameContext): string[] {
  try {
    const players = Array.isArray(ctx.state.players) ? (ctx.state.players as any[]) : [];
    return players
      .filter(
        (p) =>
          !(
            (ctx as any).inactive &&
            (ctx as any).inactive.has &&
            (ctx as any).inactive.has(p.id)
          )
      )
      .map((p) => p.id);
  } catch {
    return [];
  }
}

/**
 * Find next player id in turn order after given player
 */
function nextPlayerInOrder(ctx: GameContext, fromId?: PlayerID) {
  const players = Array.isArray(ctx.state.players) ? (ctx.state.players as any[]) : [];
  if (!players.length) return undefined;
  const ids = players.map((p) => p.id);
  if (!fromId) return ids[0];
  const idx = ids.indexOf(fromId);
  if (idx === -1) return ids[0];
  return ids[(idx + 1) % ids.length];
}

/**
 * Pass priority: called when a player passes priority.
 * Returns { changed: boolean, resolvedNow?: boolean }
 *
 * This implementation is a defensive, simple rotation:
 * - If ctx.state.priority is not set, set to first active player and return changed=true.
 * - Otherwise move to next active player. If nothing changes, return changed=false.
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
      return { changed: false, resolvedNow: false };
    }

    // If no priority set, give to first active
    if (!state.priority) {
      state.priority = active[0];
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false };
    }

    // If playerId provided but doesn't match current priority, ignore (no change)
    if (playerId && state.priority !== playerId) {
      // allow a replayed passPriority by other actor to still advance if desired:
      // treat as no-op to be conservative
      return { changed: false, resolvedNow: false };
    }

    // Find index of current priority in active array
    const curIndex = active.indexOf(state.priority);
    let nextIndex = 0;
    if (curIndex === -1) {
      nextIndex = 0;
    } else {
      nextIndex = (curIndex + 1) % active.length;
    }

    const nextId = active[nextIndex];

    // If priority stays the same (single active), nothing changed
    if (nextId === state.priority) {
      return { changed: false, resolvedNow: false };
    }

    state.priority = nextId;
    ctx.bumpSeq();

    // Basic heuristic: if stack empty and we cycled back to the turn player, no resolution happens here.
    const stackLen = Array.isArray(state.stack) ? state.stack.length : 0;
    const resolvedNow = false;

    return { changed: true, resolvedNow };
  } catch (err) {
    console.warn(`${ts()} passPriority stub failed:`, err);
    return { changed: false, resolvedNow: false };
  }
}

/**
 * Set turn direction (+1 or -1)
 */
export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    (ctx as any).state.turnDirection = dir;
    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} setTurnDirection failed:`, err);
  }
}

/**
 * nextTurn: advance to next player's turn
 * - Updates turnPlayer to the next player in order
 * - Resets phase to "beginning" (start of turn)
 * - Sets step to "untap" 
 * - Gives priority to the active player
 */
export function nextTurn(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const players = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];
    if (!players.length) return;
    const current = (ctx as any).state.turnPlayer;
    const idx = players.indexOf(current);
    const next = idx === -1 ? players[0] : players[(idx + 1) % players.length];
    (ctx as any).state.turnPlayer = next;

    // Reset to beginning of turn (using lowercase enum values)
    (ctx as any).state.phase = "beginning";
    (ctx as any).state.step = "untap";

    // Reset lands played this turn for all players
    if ((ctx as any).state.landsPlayedThisTurn) {
      for (const pid of players) {
        (ctx as any).state.landsPlayedThisTurn[pid] = 0;
      }
    }

    // give priority to the active player at the start of turn
    (ctx as any).state.priority = next;

    console.log(
      `${ts()} [nextTurn] Advanced to player ${next}, phase=${(ctx as any).state.phase}, step=${(ctx as any).state.step}`
    );
    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} nextTurn failed:`, err);
  }
}

/**
 * nextStep: advance to next step within the current turn
 * Simple progression through main phases and steps.
 * Full step/phase automation would be more complex, but this provides basic progression.
 */
export function nextStep(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const currentPhase = String((ctx as any).state.phase || "beginning");
    const currentStep = String((ctx as any).state.step || "");

    // Simple step progression logic (using camelCase enum values to match GamePhase/GameStep enums)
    // beginning phase: untap -> upkeep -> draw
    // precombatMain phase: just main (no substeps)
    // combat phase: beginCombat -> declareAttackers -> declareBlockers -> combatDamage -> endCombat
    // postcombatMain phase: just main (no substeps)
    // ending phase: endStep -> cleanup

    let nextPhase = currentPhase;
    let nextStep = currentStep;
    let shouldDraw = false;
    let shouldAdvanceTurn = false;

    if (currentPhase === "beginning" || currentPhase === "PRE_GAME" || currentPhase === "") {
      if (currentStep === "" || currentStep === "untap") {
        nextPhase = "beginning";
        nextStep = "upkeep";
      } else if (currentStep === "upkeep") {
        nextPhase = "beginning";
        nextStep = "draw";
        shouldDraw = true; // Draw a card when entering draw step
      } else {
        // After draw, go to precombatMain
        nextPhase = "precombatMain";
        nextStep = "main";
      }
    } else if (currentPhase === "precombatMain" || currentPhase === "main1") {
      nextPhase = "combat";
      nextStep = "beginCombat";
    } else if (currentPhase === "combat") {
      if (currentStep === "beginCombat") {
        nextStep = "declareAttackers";
      } else if (currentStep === "declareAttackers") {
        nextStep = "declareBlockers";
      } else if (currentStep === "declareBlockers") {
        nextStep = "combatDamage";
      } else if (currentStep === "combatDamage") {
        nextStep = "endCombat";
      } else {
        // After endCombat, go to postcombatMain
        nextPhase = "postcombatMain";
        nextStep = "main";
      }
    } else if (currentPhase === "postcombatMain" || currentPhase === "main2") {
      nextPhase = "ending";
      nextStep = "endStep";
    } else if (currentPhase === "ending") {
      if (currentStep === "endStep" || currentStep === "end") {
        nextStep = "cleanup";
      } else if (currentStep === "cleanup") {
        // After cleanup, advance to next turn
        shouldAdvanceTurn = true;
      } else {
        // Stay at cleanup if unknown step
        nextStep = "cleanup";
      }
    } else {
      // Unknown phase, move to precombatMain as a safe default
      nextPhase = "precombatMain";
      nextStep = "main";
    }

    // Update phase and step
    (ctx as any).state.phase = nextPhase;
    (ctx as any).state.step = nextStep;

    console.log(
      `${ts()} [nextStep] Advanced to phase=${nextPhase}, step=${nextStep}`
    );

    // If we should advance to next turn, call nextTurn instead
    if (shouldAdvanceTurn) {
      console.log(`${ts()} [nextStep] Cleanup complete, advancing to next turn`);
      ctx.bumpSeq();
      nextTurn(ctx);
      return;
    }

    // If we're entering the draw step, draw a card for the active player
    if (shouldDraw) {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          const drawn = drawCards(ctx, turnPlayer, 1);
          console.log(
            `${ts()} [nextStep] Drew ${drawn.length} card(s) for ${turnPlayer} at draw step`
          );
        } else {
          console.warn(`${ts()} [nextStep] No turnPlayer set, cannot draw card`);
        }
      } catch (err) {
        console.warn(`${ts()} [nextStep] Failed to draw card:`, err);
      }
    }

    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} nextStep failed:`, err);
  }
}

/* Simple scheduled-steps support (lightweight queue stored on ctx) */
export function scheduleStepsAfterCurrent(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = ctx._scheduledSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledSteps.push(...steps);
  } catch (err) {
    console.warn(`${ts()} scheduleStepsAfterCurrent failed:`, err);
  }
}

export function scheduleStepsAtEndOfTurn(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledEndOfTurnSteps = ctx._scheduledEndOfTurnSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledEndOfTurnSteps.push(...steps);
  } catch (err) {
    console.warn(`${ts()} scheduleStepsAtEndOfTurn failed:`, err);
  }
}

export function clearScheduledSteps(ctx: any) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = [];
    ctx._scheduledEndOfTurnSteps = [];
  } catch (err) {
    console.warn(`${ts()} clearScheduledSteps failed:`, err);
  }
}

export function getScheduledSteps(ctx: any) {
  try {
    return {
      afterCurrent: Array.isArray(ctx._scheduledSteps)
        ? ctx._scheduledSteps.slice()
        : [],
      endOfTurn: Array.isArray(ctx._scheduledEndOfTurnSteps)
        ? ctx._scheduledEndOfTurnSteps.slice()
        : [],
    };
  } catch (err) {
    return { afterCurrent: [], endOfTurn: [] };
  }
}

export function removeScheduledSteps(ctx: any, steps: any[]) {
  try {
    if (!ctx || !Array.isArray(steps)) return;
    ctx._scheduledSteps = (ctx._scheduledSteps || []).filter(
      (s: any) => !steps.includes(s)
    );
    ctx._scheduledEndOfTurnSteps = (
      ctx._scheduledEndOfTurnSteps || []
    ).filter((s: any) => !steps.includes(s));
  } catch (err) {
    console.warn(`${ts()} removeScheduledSteps failed:`, err);
  }
}

export default {
  passPriority,
  setTurnDirection,
  nextTurn,
  nextStep,
  scheduleStepsAfterCurrent,
  scheduleStepsAtEndOfTurn,
  clearScheduledSteps,
  getScheduledSteps,
  removeScheduledSteps,
};