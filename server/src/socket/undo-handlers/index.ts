// server/src/socket/undo-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of server/src/socket/undo.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/socket/undo.ts ("./undo.js").

// Boundary keys/snapshots, boundary history (persisted metadata or replay probe),
// semantic action counting, and step/phase/previousPhase/turn smart undo counts.
export {
  countSemanticActions,
  sliceEventsForBoundaryPlan,
  phaseOrderRank,
  stepOrderRank,
  normalizePhaseToken,
  normalizeStepToken,
  getBoundaryKey,
  snapshotBoundaryState,
  humanizeBoundaryToken,
  buildUndoBoundaryPreview,
  buildBoundaryHistoryFromPersistedMetadata,
  boundaryHistoryHasKey,
  buildBoundaryHistoryFromReplay,
  calculateBoundaryUndoCount,
  calculateSmartUndoCounts,
  resolveBoundaryHistoryForUndo,
} from "./undoBoundaryPlanning.js";
export type {
  PersistedEvent,
  BoundaryStateSnapshot,
  UndoBoundaryPreview,
  UndoBoundaryPlan,
  SmartUndoCounts,
  BoundaryKind,
  BoundaryHistoryEntry,
} from "./undoBoundaryPlanning.js";

// Earlier turn/phase/step jump targets for the undo picker, plus the count resolver.
export {
  listUndoTurnPhaseTargets,
  resolveUndoToTurnPhaseCount,
  buildPlayerNameMap,
} from "./undoTurnPhaseTargets.js";
export type { UndoTurnPhaseTarget } from "./undoTurnPhaseTargets.js";

// Truncate + reset + replay remaining events; emits gameResumeProgress during rebuild.
export { performUndo } from "./undoPerformReplay.js";
