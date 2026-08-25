/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applyOracleIRStepsToGameStateImpl switch cases for Phase 4
 *   leftover choice families (each-player choose-then-destroy-rest, secret
 *   opponent damage matrix, mill-from-among may-cast, may-reveal four-zone
 *   named-copy win).
 * Public: tryApplyMainLoopChoiceFamilySteps
 */

import type { OracleEffectStep } from './oracleIR';
import { applyEachPlayerChooseThenDestroyRestStep } from './oracleIRExecutorEachPlayerChooseDestroyRest';
import { applyMayCastFromAmongStep } from './oracleIRExecutorMayCastFromAmong';
import { applyMayRevealHandWinIfOwnNamedStep } from './oracleIRExecutorMayRevealHandWinIfOwnNamed';
import type { MainLoopStepFamilyCtx } from './oracleIRExecutorMainLoopStepTypes';
import { applySecretOpponentChoiceDamageStep } from './oracleIRExecutorSecretOpponentChoiceDamage';

export function tryApplyMainLoopChoiceFamilySteps(
  ctx: MainLoopStepFamilyCtx,
  step: OracleEffectStep,
): true | undefined {
  switch (step.kind) {
    case 'each_player_choose_then_destroy_rest': {
      const result = applyEachPlayerChooseThenDestroyRestStep(ctx.nextState, step, ctx.currentCtx);
      ctx.applyHandledStepResult(step, result);
      return true;
    }
    case 'secret_opponent_choice_damage': {
      const result = applySecretOpponentChoiceDamageStep(ctx.nextState, step, ctx.currentCtx);
      ctx.applyHandledStepResult(step, result);
      return true;
    }
    case 'may_cast_from_among': {
      const result = applyMayCastFromAmongStep(ctx.nextState, step, ctx.currentCtx);
      ctx.applyHandledStepResult(step, result);
      return true;
    }
    case 'may_reveal_hand_then_win_if_own_named_in_zones': {
      const result = applyMayRevealHandWinIfOwnNamedStep(ctx.nextState, step, ctx.currentCtx);
      ctx.applyHandledStepResult(step, result);
      return true;
    }
    default:
      return undefined;
  }
}
