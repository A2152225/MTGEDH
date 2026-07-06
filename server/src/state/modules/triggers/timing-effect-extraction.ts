/**
 * Shared helper for extracting full multi-sentence triggered-ability effect text
 * after a timing-prefix regex match (avoids first-period truncation).
 */
export { extractTriggeredEffectFromTimingMatch as timingTriggerEffect } from '../../../../../rules-engine/src/triggerEffectTextExtraction.js';
export {
  findFirstRegexMatchAcrossOracleLines,
  findRegexMatchAcrossOracleLines,
  getOracleLines,
  globalizeLineRegexMatch,
  resolveGlobalTimingMatchIndex,
} from '../../../../../rules-engine/src/oracleLineRegexMatch.js';
