/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applySecretOpponentChoiceDamageStep — halt for secret opponent
 *   silence/snitch-style choices (Prisoner's Dilemma family). Server queues
 *   existing OPTION_CHOICE with prisonersDilemmaChoice resume.
 * Public: applySecretOpponentChoiceDamageStep
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import type { GameState } from '../../shared/src';

export function applySecretOpponentChoiceDamageStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'secret_opponent_choice_damage' }>,
  _ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const labels = (Array.isArray(step.choices) ? step.choices : []).join(' or ') || 'a secret option';
  return {
    applied: false,
    message: `Each opponent must secretly choose ${labels} before damage is applied: ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
