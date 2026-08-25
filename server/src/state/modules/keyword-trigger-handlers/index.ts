// server/src/state/modules/keyword-trigger-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/keyword-handlers.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/keyword-handlers.ts.
// Leaves must not import keyword-handlers.ts or this index.
// Never create keyword-handlers/ beside keyword-handlers.ts.

// Keyword trigger result and context types.
export type { KeywordTriggerResult, KeywordTriggerContext } from "./keywordTriggerTypes.js";

// 2-arg oracle-text keyword lookup (distinct from 4-arg gameActionsPermanentKeywordGrants).
export { permanentHasKeyword, getPermanentKeywords } from "./keywordTriggerPermanentLookup.js";

// Attack-trigger handle family (prowess through enlist) plus combat lookup helpers.
export {
  handleProwess,
  handleDethrone,
  handleEvolve,
  handleMelee,
  handleMyriad,
  handleExalted,
  handleBattleCry,
  handleMentor,
  handleTraining,
  handleAnnihilator,
  handleAfflict,
  handleFlanking,
  handleBushido,
  handleRampage,
  handleEnlist,
} from "./keywordTriggerAttackHandlers.js";
