import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { buildOracleIRExecutionContext } from './oracleIRExecutorExecutionContext';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';
import { applyOracleIRStepsToGameStateImpl } from './oracleIRExecutorMainLoop';

export type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';
export { buildOracleIRExecutionContext } from './oracleIRExecutorExecutionContext';

/**
 * Best-effort executor for Oracle Effect IR.
 *
 * Purposefully conservative:
 * - Only applies steps that can be executed without player choices.
 * - Skips optional ("You may") steps unless allowOptional=true.
 * - Skips targeting-dependent steps for now.
 */
export function applyOracleIRStepsToGameState(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  return applyOracleIRStepsToGameStateImpl(
    state,
    steps,
    ctx,
    options,
    applyOracleIRStepsToGameState
  );
}
