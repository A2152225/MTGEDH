/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applyEachPlayerChooseThenDestroyRestStep — halt for APNAP survivor
 *   choices (Divine Reckoning family). Server queues existing TARGET_SELECTION.
 * Public: applyEachPlayerChooseThenDestroyRestStep
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import type { GameState } from '../../shared/src';

export function applyEachPlayerChooseThenDestroyRestStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'each_player_choose_then_destroy_rest' }>,
  _ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  return {
    applied: false,
    message: `Each player must choose a ${step.keepTypes.join('/')} they control before the rest are destroyed: ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
