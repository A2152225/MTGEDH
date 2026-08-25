// rules-engine/src/oracleIRParserStaticAbilityClauses-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRParserStaticAbilityClauses.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRParserStaticAbilityClauses.ts.
// Never create oracleIRParserStaticAbilityClauses/ beside the .ts.
// Leaves must not import oracleIRParserStaticAbilityClauses.ts or this index.

// Keyword / P/T / graveyard grant parse helpers.
export type { WithMeta } from './oracleIRParserStaticAbilityGrantParseUtils.js';
export {
  STATIC_KEYWORD_ABILITIES,
  normalizeGraveyardGrantSelector,
  parseGraveyardKeywordAbilityCost,
  normalizeWardAbilityPart,
  parseKeywordAbilityList,
  extractQuotedAbilityText,
  parseSignedInt,
  isEphemeralGrantedAbilityTarget,
} from './oracleIRParserStaticAbilityGrantParseUtils.js';

// Early permission / P/T / quoted-grant if-chain.
export { tryParseStaticAbilityGrantEarlyClauses } from './oracleIRParserStaticAbilityGrantEarlyClauses.js';

// Full-card rules-text static / keyword clause parser.
export { tryParseRulesTextClause } from './oracleIRParserStaticAbilityRulesTextClause.js';
