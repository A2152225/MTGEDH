// server/src/state/modules/upkeep-triggers-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/upkeep-triggers.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/upkeep-triggers.ts.
// Leaves must not import upkeep-triggers.ts or this index.
// Never create upkeep-triggers/ beside upkeep-triggers.ts.

// Shared UpkeepTrigger type plus exclusive detect helpers (normalize / dedupe / sacrifice-or-self).
export type { UpkeepTrigger } from "./upkeepTriggerDetectHelpers.js";
export {
  normalizeUpkeepEffectText,
  hasMatchingUpkeepEffect,
  isSacrificeCreatureOrSelfOracle,
} from "./upkeepTriggerDetectHelpers.js";

// Echo/control upkeep marker lookup used by leftover stampPermanentControlEntryForEcho.
export { getLastUpkeepMarker } from "./upkeepMarkerHelpers.js";

// Echo cost fires on the control-change upkeep.
export { shouldTriggerEcho } from "./upkeepEchoHelpers.js";

// Oracle-text upkeep trigger detection.
export { detectUpkeepTriggers } from "./upkeepTriggerDetect.js";
