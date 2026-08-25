// rules-engine/src/oracleTextParser-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleTextParser.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleTextParser.ts.
// Never create oracleTextParser/ beside the .ts.
// Leaves must not import oracleTextParser.ts or this index.

// Public parse-result types and AbilityType enum.
export type {
  ParsedAbility,
  ChoiceRequirement,
  ParsedKeywordAction,
  OracleTextParseResult,
} from './oracleTextParserTypes.js';
export { AbilityType } from './oracleTextParserTypes.js';

// Trigger-line split helpers used by parseOracleText and parseTriggeredAbility.
export {
  stripLeadingTriggeredAbilityLabel,
  looksLikeCompleteTriggerCondition,
  splitMixedStandaloneAndTriggeredLine,
  splitRepeatedTriggeredLead,
} from './oracleTextParserTriggeredLineSplit.js';

// Runtime seam for parse helpers still living in the parent.
export {
  setOracleTextParserHandlerDeps,
  getOracleTextParserHandlerDeps,
} from './oracleTextParserHandlerDeps.js';
export type { OracleTextParserHandlerDeps } from './oracleTextParserHandlerDeps.js';

// Activated-ability parse plus keyword-cost / quoted-grant helpers.
export {
  KEYWORD_COST_PATTERN,
  isGrantedQuotedActivatedAbilityLine,
  parseActivatedAbility,
} from './oracleTextParserParseActivatedAbility.js';

// Main oracle-text parse plus parseKeywords wrapper.
export { parseKeywords, parseOracleText } from './oracleTextParserParseOracleText.js';
