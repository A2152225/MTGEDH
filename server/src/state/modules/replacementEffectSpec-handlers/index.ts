// server/src/state/modules/replacementEffectSpec-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/replacementEffectSpec.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/replacementEffectSpec.ts.
// Leaves must not import replacementEffectSpec.ts or this index.

// Declarative ReplacementEffectSpec types and per-event match interfaces.
export type {
  ReplacementEffectSpecEvent,
  ReplacementModifyMode,
  ReplacementZoneChangeMatch,
  ReplacementMillMatch,
  ReplacementLibrarySearchMatch,
  ReplacementCounterMatch,
  ReplacementDrawMatch,
  ReplacementLifeGainMatch,
  ReplacementLifeLossMatch,
  ReplacementTokenMatch,
  ReplacementDamageMatch,
  ReplacementLoseGameMatch,
  ReplacementLoseGameInstead,
  ReplacementEffectSpec,
} from "./replacementEffectSpecTypes.js";

// Shared oracle-pattern text helpers used by every template collect family.
export { normalizeOraclePatternText, readCardOracleText } from "./replacementEffectSpecOracleTextUtils.js";

// Oracle-pattern life-gain templates (Boon Reflection / Tainted Remedy family).
export { collectOraclePatternLifeGainReplacementSpecsFromState } from "./replacementEffectSpecLifeGainOracleTemplates.js";

// Life-gain overlay match (extracted so leftover aura/opponent templates can extend it).
export { overlaySpecsMatchLifeGain, matchesLifeGainSpec } from "./replacementEffectSpecLifeGainMatch.js";

// Oracle-pattern life-loss templates (Bloodletter family).
export {
  collectOraclePatternLifeLossReplacementSpecsFromState,
  overlaySpecsMatchLifeLoss,
  summarizeLifeLossAmountReplacements,
} from "./replacementEffectSpecLifeLossOracleTemplates.js";

// Oracle-pattern counter-placement templates (Doubling Season family).
export { collectOraclePatternCounterReplacementSpecsFromState } from "./replacementEffectSpecCounterOracleTemplates.js";

// Oracle-pattern library-search templates (Aven Mindcensor / Leonin Arbiter family).
export { collectOraclePatternLibrarySearchReplacementSpecsFromState } from "./replacementEffectSpecLibrarySearchOracleTemplates.js";

// Oracle-pattern damage templates, prevent-all-but parsers, and overlay match.
export { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from "./replacementEffectSpecDamageOracleTemplates.js";

// Oracle-pattern draw templates (Thought Reflection / Notion Thief / Alms Collector).
export { collectOraclePatternDrawReplacementSpecsFromState } from "./replacementEffectSpecDrawOracleTemplates.js";

// Oracle-pattern token-creation templates (Anointed Procession / Ojer Taq family).
export { collectOraclePatternTokenReplacementSpecsFromState } from "./replacementEffectSpecTokenOracleTemplates.js";

// Oracle-pattern mill templates (Bruvac / Water Crystal family).
export { collectOraclePatternMillReplacementSpecsFromState } from "./replacementEffectSpecMillOracleTemplates.js";

// Oracle-pattern zone-change templates (graveyard-to-exile from anywhere).
export { collectOraclePatternZoneChangeReplacementSpecsFromState } from "./replacementEffectSpecZoneChangeOracleTemplates.js";

// Oracle-pattern can't-lose / can't-win / empty-library-win (Platinum Angel family).
export {
  collectOraclePatternLoseGameReplacementSpecsFromState,
  loseGameSpecPreventsLoss,
  loseGameSpecPreventsWin,
  loseGameSpecExemptsZeroOrLessLife,
  loseGameSpecExemptsEmptyLibraryDraw,
  loseGameSpecWinsOnEmptyLibraryDraw,
} from "./replacementEffectSpecLoseGameOracleTemplates.js";

// Oracle-pattern Worship / Fortune Thief life-floor damage replacements.
export { collectOraclePatternLifeFloorDamageReplacementSpecsFromState } from "./replacementEffectSpecLifeFloorDamageOracleTemplates.js";
