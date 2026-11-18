// server/src/state/modules/turn-handlers/turnStepArchenemySchemeInMotion.ts
// Origin parent: server/src/state/modules/turn.ts (via turnStepMain1.ts, the MAIN1 step-entry body).
// Cluster moved: new turn-based action, nothing was moved out of the parent.
// Public entry symbols: runArchenemySchemeInMotionTurnAction.
// CR 904.9: immediately after the archenemy's precombat main phase begins, that player moves the
// top card of their scheme deck off it and turns it face up ("sets it in motion"). This turn-based
// action doesn't use the stack; "When you set this scheme in motion" abilities trigger.
//
// Replay: skipped while ctx.isReplaying. setSchemeInMotion() saves its own snapshot event
// (`setSchemeInMotion`, tagged oracleIrReplayMutation) and its trigger is saved by
// `pushTriggeredAbility`, so replaying the step must not set a second scheme in motion.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { getArchenemyPlayerId, isArchenemyEnabled, setSchemeInMotion } from "../archenemyRuntime.js";
import { debug } from "../../../utils/debug.js";

export function runArchenemySchemeInMotionTurnAction(ctx: GameContext, turnPlayer: string): void {
  if ((ctx as any).isReplaying) return;
  const state = (ctx as any).state;
  if (!state || !isArchenemyEnabled(state)) return;
  if (String(getArchenemyPlayerId(state) || "") !== String(turnPlayer || "")) return;
  if (!Array.isArray(state.schemeDeck) || state.schemeDeck.length === 0) return;

  const result = setSchemeInMotion(ctx, String(turnPlayer));
  if (!result.ok) {
    debug(2, `[nextStep] Archenemy set-in-motion skipped: ${result.reason || "unknown"}`);
    return;
  }

  const gameId = String((ctx as any).gameId || "").trim();
  if (gameId && (ctx as any).io) {
    (ctx as any).io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Archenemy: ${result.scheme?.name || "a scheme"} is set in motion.`,
      ts: Date.now(),
    });
  }
}
