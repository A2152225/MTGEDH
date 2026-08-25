/**
 * Internal agent TOC for clusters extracted from client/src/utils/activatedAbilityParser.ts.
 *
 * Named re-exports only - no implementations, no `export *`. The public
 * compatibility barrel stays `client/src/utils/activatedAbilityParser.ts`; leaves
 * in this folder must never import it (nor this index).
 */

// Parsed ability / tap-other-permanents cost / activation context types.
export type {
  ActivationContext,
  ParsedActivatedAbility,
  TapOtherPermanentsCost,
} from './activatedAbilityParserTypes';

// Station threshold parse, threshold-gated ability lines, sentence normalize.
export {
  normalizeAbilitySentence,
  parseStationThreshold,
  parseThresholdGatedAbilityLine,
} from './parseStationAndThresholdHelpers';

// Activate-only-as-sorcery / upkeep / your-turn restriction parse.
export { parseTimingRestrictionFromText } from './parseTimingRestrictionFromText';

// Tap-mana production text parse (Add {W}, any color, chosen color).
export { parseManaProduction } from './parseManaProduction';

// Mill-effect parse plus activated-ability cost component parse.
export {
  isSelfTapCost,
  parseCostComponents,
  parseMillEffect,
} from './parseActivatedAbilityCostAndMill';

// Granted-ability text normalize and append onto parsed ability lists.
export {
  appendGrantedActivatedAbilities,
  buildParsedAbilityFromGrantedLine,
  normalizeGrantedActivatedAbilityText,
  pushUniqueParsedAbility,
} from './appendGrantedActivatedAbilities';

// Full printed + granted activated-ability parse.
export { parseActivatedAbilities } from './parseActivatedAbilities';
