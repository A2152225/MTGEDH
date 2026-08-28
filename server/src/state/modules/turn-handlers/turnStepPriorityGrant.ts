// server/src/state/modules/turn-handlers/turnStepPriorityGrant.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: nextStep() active-player priority grant / no-priority
// branches, including auto-pass after grant.
// Public entry symbols: grantTurnStepPriority.
// nextStep remains the dispatcher. Leaf must not import turn.ts or
// turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { canAct, canRespond } from "../can-respond.js";
import { tryAutoPass } from "../priority.js";
import { reassignPriorityIfHolderCannotReceive } from "../priorityEligibility.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Grant or withhold priority after step-entry triggers (Rules 116.3a / 502.1 / 514.1).
 */
export function grantTurnStepPriority(
  ctx: GameContext,
  turnPlayer: string,
  nextStep: string,
  isReplaying: boolean,
): void {
        // Give priority to active player based on step type
        // Per Rule 116.3a: Active player receives priority at the beginning of most steps
        // Per Rule 502.1: No player receives priority during untap step
        // Per Rule 514.1: Cleanup step normally doesn't grant priority (handled elsewhere)
        const stepUpper = (nextStep ?? '').toUpperCase();
        const isUntapStep = stepUpper === "UNTAP";
        const isCleanupStep = stepUpper === "CLEANUP";
        const stackLen = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack.length : 0;
        
        // Grant priority in all steps except UNTAP.
        // Cleanup normally doesn't grant priority, but if the stack is non-empty we must grant priority
        // so players can respond/resolve (Rule 514.3 style behavior).
        const shouldGrantPriority = !isUntapStep && (!isCleanupStep || stackLen > 0);
        
        if (shouldGrantPriority) {
          // Always grant priority to the active player first
          // The auto-pass system will handle passing priority if they can't act
          (ctx as any).state.priority = turnPlayer;
          
          // CRITICAL: Reset priorityPassedBy when granting priority in a new step
          // This ensures players who passed in the previous step get a fresh chance to act
          // Without this, auto-pass can cause steps to be skipped incorrectly
          (ctx as any).state.priorityPassedBy = new Set<string>();
          
          // Also clear priorityClaimed set - players need to claim priority again each step
          (ctx as any).state.priorityClaimed = new Set<string>();
          reassignPriorityIfHolderCannotReceive(ctx as any);
          
          debug(2, `${ts()} [nextStep] Granting priority to active player ${turnPlayer} (step: ${nextStep ?? 'unknown'}, stack size: ${stackLen})`);
          
          if (!isReplaying) {
            // DEBUG: Log turn player's hand and ability to act
            try {
              const zones = (ctx as any).state?.zones?.[turnPlayer];
              const hand = zones?.hand || [];
              const handNames = hand.map((card: any) => card?.name || 'Unknown').join(', ');
              const handCount = hand.length || zones?.handCount || 0;
              
              const playerCanAct = canAct(ctx, turnPlayer);
              const playerCanRespond = canRespond(ctx, turnPlayer);
              
              debug(2, `${ts()} [nextStep] DEBUG - Turn Player ${turnPlayer}:`);
              debug(2, `${ts()} [nextStep]   Hand (${handCount}): ${handNames || '(empty)'}`);
              debug(2, `${ts()} [nextStep]   canAct: ${playerCanAct}, canRespond: ${playerCanRespond}`);
            } catch (err) {
              debugWarn(1, `${ts()} [nextStep] Failed to log debug info:`, err);
            }
            
            // After granting priority, check if we should auto-pass for players who cannot act
            // This ensures that auto-pass works immediately when entering a new step,
            // not just when someone manually passes priority.
            try {
              debug(2, `${ts()} [nextStep] Checking if auto-pass should apply after granting priority`);
              const autoPassResult = tryAutoPass(ctx);
              
              // Store the auto-pass result in the state so the caller can check it
              // This allows the caller (socket handler or AI) to handle step advancement
              // and broadcasting properly without breaking the control flow
              (ctx as any).state._autoPassResult = autoPassResult;
              
              if (autoPassResult.allPassed && autoPassResult.advanceStep) {
                // All players auto-passed with empty stack - mark flag for caller to handle
                debug(2, `${ts()} [nextStep] All players auto-passed after granting priority - caller should advance step`);
              } else if (autoPassResult.allPassed && autoPassResult.resolved) {
                // All players auto-passed and stack item resolved
                debug(2, `${ts()} [nextStep] All players auto-passed and stack item resolved`);
              } else {
                // Auto-pass stopped at a player who can act, or auto-pass is not enabled
                debug(2, `${ts()} [nextStep] Auto-pass stopped, player ${(ctx as any).state.priority} has priority`);
              }
            } catch (err) {
              debugWarn(1, `${ts()} [nextStep] Failed to run auto-pass check:`, err);
            }
          } else if ((ctx as any).state._autoPassResult) {
            delete (ctx as any).state._autoPassResult;
          }
        } else {
          // UNTAP (and cleanups with an empty stack) don't grant priority normally.
          (ctx as any).state.priority = null;
          debug(2, `${ts()} [nextStep] Step ${nextStep ?? 'unknown'} does not grant priority (Rule 502.1/514.1)`);
        }
}
