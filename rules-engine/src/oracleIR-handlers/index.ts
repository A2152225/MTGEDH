// rules-engine/src/oracleIR-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIR.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIR.ts.
// Never create oracleIR/ beside the .ts.
// Leaves must not import oracleIR.ts or this index.

// Shared quantity / player / object / zone selectors used by effect-step members.
export type {
  OracleQuantity,
  OraclePlayerSelector,
  OracleObjectSelector,
  OracleScaler,
  OracleClauseCondition,
  OracleGraveyardAdditionalCost,
  OracleBattlefieldObjectCondition,
  OracleZone,
} from './oracleIRSharedTypes.js';

// OracleEffectStep union members: grant_next_spell_cost_reduction … fateseal.
export type { OracleEffectStepA } from './oracleIREffectStepA.js';

// OracleEffectStep union members: learn … prevent_damage.
export type { OracleEffectStepB } from './oracleIREffectStepB.js';

// OracleEffectStep union members: damage_cant_be_prevented … unknown.
export type { OracleEffectStepC } from './oracleIREffectStepC.js';

// Public OracleEffectStep alias (A | B | C).
export type { OracleEffectStep } from './oracleIREffectStep.js';
