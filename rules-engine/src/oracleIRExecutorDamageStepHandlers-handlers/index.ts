// rules-engine/src/oracleIRExecutorDamageStepHandlers-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRExecutorDamageStepHandlers.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRExecutorDamageStepHandlers.ts.
// Never create oracleIRExecutorDamageStepHandlers/ beside the .ts.
// Leaves must not import oracleIRExecutorDamageStepHandlers.ts or this index.

// Prevention apply/skip result types.
export type { PreventDamageStepHandlerResult } from './oracleIRExecutorDamagePreventionStepTypes';

// Shared any-target / target permanent id resolution.
export { resolveSinglePermanentDamageTargetId } from './oracleIRExecutorDamagePermanentTarget';

// Prevention recipient/source ids plus battlefield/stack source lookup.
export {
  findSourceObject,
  resolvePreventionRecipientPermanentId,
  resolvePreventionTargetSourceId,
} from './oracleIRExecutorDamagePreventionLookups';

// Prevent-damage apply (all-but / source / recipient / combat / color).
export { applyPreventDamageStep } from './oracleIRExecutorPreventDamageStep';
