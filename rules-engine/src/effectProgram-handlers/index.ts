// rules-engine/src/effectProgram-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/effectProgram.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/effectProgram.ts.
// Never create effectProgram/ beside effectProgram.ts.
// Leaves must not import effectProgram.ts or this index.

// Public Effect Program types plus ORACLE_CHOICE_STEP_KINDS / BASIC_LAND_TYPE_OPTIONS.
export type {
  EffectProgramStepKind,
  EffectProgramClauseRef,
  EffectProgramStepGuard,
  BaseEffectProgramStep,
  EffectProgramConditionStep,
  EffectProgramCommand,
  EffectProgramCommandStep,
  EffectProgramChoiceRequest,
  EffectProgramChoiceEventInput,
  EffectProgramChoiceStep,
  EffectProgramKeywordStep,
  EffectProgramNoteStep,
  EffectProgramStep,
  EffectProgram,
  EffectProgramRuntime,
  EffectProgramTraceEntry,
  EffectProgramConditionEvaluation,
  EffectProgramHandlerArgs,
  EffectProgramCommandResult,
  EffectProgramHandlers,
  EffectProgramChoicePause,
  EffectProgramRunStatus,
  EffectProgramRunResult,
  BuildEffectProgramFromOracleIRInput,
} from "./effectProgramTypes.js";
export {
  ORACLE_CHOICE_STEP_KINDS,
  BASIC_LAND_TYPE_OPTIONS,
} from "./effectProgramTypes.js";

// Build an Effect Program from Oracle IR steps, including append + exclusive choice helpers.
export { buildEffectProgramFromOracleIR } from "./effectProgramAppendOracleStep.js";
