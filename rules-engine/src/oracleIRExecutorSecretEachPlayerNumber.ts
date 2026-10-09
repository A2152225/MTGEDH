/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applySecretEachPlayerNumberStep — halt so the server can queue a
 *   secret number for every player (Wheel of Misfortune family).
 * Public: applySecretEachPlayerNumberStep
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import type { GameState } from '../../shared/src';

export function applySecretEachPlayerNumberStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'secret_each_player_number' }>,
  _ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  return {
    applied: false,
    message: `Each player must secretly choose a number before damage, discard, and draw are applied: ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
