// rules-engine/src/oracleIRParserLifeAndCombatClauses-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRParserLifeAndCombatClauses.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRParserLifeAndCombatClauses.ts.
// Never create oracleIRParserLifeAndCombatClauses/ beside the .ts.
// Leaves must not import oracleIRParserLifeAndCombatClauses.ts or this index.

// Damage / life amount parsers plus damage-clause normalize helpers.
export {
  parseDamageAmount,
  parseLifeChangeAmount,
  PLAYER_SUBJECT_PREFIX,
  SELF_DAMAGE_SOURCE_SUBJECT_PATTERN,
  NAMED_DAMAGE_SOURCE_PATTERN,
  DAMAGE_AMOUNT_PATTERN,
  isDamageAmountDescriptor,
  shouldSkipGenericDamageSource,
  normalizeDamageClauseForParse,
} from './oracleIRParserLifeAndCombatParseUtils.js';

// Life / combat / tap-or-untap clause parser (parent re-exports).
export { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClause.js';
