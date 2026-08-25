// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: sacrificeStepResult.
// Public entry: sacrificeStepResult.

import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { StepApplyResult } from './oracleIRExecutorBattlefieldStepTypes';
import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';

export function sacrificeStepResult(
  ctx: OracleIRExecutionContext,
  result: StepApplyResult,
): StepApplyResult {
  return bridgedZoneStepResult(ctx, result);
}
