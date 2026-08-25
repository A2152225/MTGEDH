// rules-engine/src/oracleIRExecutorModifyPtStepHandlers-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRExecutorModifyPtStepHandlers.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRExecutorModifyPtStepHandlers.ts.
// Never create oracleIRExecutorModifyPtStepHandlers/ beside the .ts.
// Leaves must not import oracleIRExecutorModifyPtStepHandlers.ts or this index.

// Shared runtime type used by modify-P/T step handlers and where-X evaluators.
export type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepTypes';

// Reference scaler for modify_pt "for each ..." amounts.
export { resolveReferenceScalerScale } from './oracleIRExecutorModifyPtReferenceScaler';

// Battlefield scaler counts used by resolveReferenceScalerScale and applyModifyPtStep.
export {
  countAttackingCreaturesMatching,
  countCreaturesBlockedByTarget,
  countCreaturesBlockingTarget,
  countBasicLandTypesAmongLandsYouControl,
  countArtifactsYouControl,
  countOtherAttackingAurochs,
  countControlledCreaturesWithSubtype,
  countPartyCreatures,
  countBloodTokensForPlayer,
} from './oracleIRExecutorModifyPtScalerCountHelpers';
