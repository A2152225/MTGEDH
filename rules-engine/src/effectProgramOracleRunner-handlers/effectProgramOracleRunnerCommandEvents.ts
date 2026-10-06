// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: OracleIRCommandExecutionEvent, createOracleIRCommandExecutionEvent,
// createSingleOracleIRCommandExecutionEvent, createDirectOracleIRCommandExecutionEvent.
// Public entry symbols: the same four (the interface is re-exported by the parent).
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { OracleIRExecutionResult } from '../oracleIRExecutionTypes';

export interface OracleIRCommandExecutionEvent {
  readonly type: 'oracle_ir_execution';
  readonly stepId: string;
  readonly appliedStepKinds: readonly string[];
  readonly skippedStepKinds: readonly string[];
  readonly automationGapCount: number;
  readonly pendingOptionalStepCount: number;
  /** Full executor result so server bridges (e.g. deferred stack copies) after Effect Program commands. */
  readonly execution?: OracleIRExecutionResult;
}

export function createOracleIRCommandExecutionEvent(
  stepId: string,
  execution: OracleIRExecutionResult
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds: execution.appliedSteps.map(step => step.kind),
    skippedStepKinds: execution.skippedSteps.map(step => step.kind),
    automationGapCount: execution.automationGaps.length,
    pendingOptionalStepCount: execution.pendingOptionalSteps.length,
    execution,
  };
}

export function createSingleOracleIRCommandExecutionEvent(
  stepId: string,
  stepKind: string,
  applied: boolean
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds: applied ? [stepKind] : [],
    skippedStepKinds: applied ? [] : [stepKind],
    automationGapCount: applied ? 0 : 1,
    pendingOptionalStepCount: 0,
  };
}

export function createDirectOracleIRCommandExecutionEvent(
  stepId: string,
  appliedStepKinds: readonly string[],
  skippedStepKinds: readonly string[]
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds,
    skippedStepKinds,
    automationGapCount: 0,
    pendingOptionalStepCount: 0,
  };
}
