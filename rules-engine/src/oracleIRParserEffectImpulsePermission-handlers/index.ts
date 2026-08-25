// rules-engine/src/oracleIRParserEffectImpulsePermission-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRParserEffectImpulsePermission.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRParserEffectImpulsePermission.ts.
// Never create oracleIRParserEffectImpulsePermission/ beside the .ts.
// Leaves must not import oracleIRParserEffectImpulsePermission.ts or this index.

// Late next-turn / until-end / remains-exiled if-chain of parseEffectLevelImpulsePermissionClause.
export { tryParseImpulsePermissionLateDurationClauses } from './oracleIRParserEffectImpulsePermissionLateDurations.js';
