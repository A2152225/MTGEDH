// rules-engine/src/oracleIRParserUtils-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRParserUtils.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRParserUtils.ts.
// Never create oracleIRParserUtils/ beside the .ts.
// Leaves must not import oracleIRParserUtils.ts or this index.

// Early reference-amount / object-stat / phrase if-chain for parseQuantity.
export { tryParseQuantityEarlyReferences } from './oracleIRParserUtilsQuantityEarlyReferences.js';
