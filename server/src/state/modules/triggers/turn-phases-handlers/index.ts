// server/src/state/modules/triggers/turn-phases-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/triggers/turn-phases.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/triggers/turn-phases.ts.
// Leaves must not import turn-phases.ts or this index.
// Never create turn-phases/ beside turn-phases.ts.

// End-step trigger wire type (whose-turn + choice/all-players flags).
export type { EndStepTrigger } from "./turnPhaseTriggerTypes.js";

// Active face name/oracle for transform permanents (shared by phase detectors).
export { getActivePermanentCardFace } from "./turnPhaseActivePermanentFace.js";

// Oracle-text heuristics for choice and all-players flags on phase triggers.
export { detectRequiresChoice, detectAffectsAllPlayers } from "./turnPhaseEffectChoiceHelpers.js";

// Beginning-of-end-step detector (known table + generic oracle patterns).
export { detectEndStepTriggers } from "./turnPhaseEndStepTriggers.js";
