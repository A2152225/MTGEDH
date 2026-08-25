// server/src/state/modules/keyword-detection-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/keyword-detection.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/keyword-detection.ts.
// Leaves must not import keyword-detection.ts or this index.
// Never create keyword-detection/ beside keyword-detection.ts.

// Shared detection types (KeywordPattern is internal to the pattern tables).
export type {
  KeywordCategory,
  KeywordTiming,
  DetectedKeyword,
  KeywordDetectionResult,
  KeywordPattern,
} from "./keywordDetectionTypes.js";

// Triggered keyword regex table (prowess through myriad-style attack triggers).
export { TRIGGERED_KEYWORD_PATTERNS } from "./keywordDetectionTriggeredPatterns.js";
