// server/src/state/modules/zones-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/zones.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/zones.ts.
// Leaves must not import zones.ts or this index.

// Prepared-state cleanup when a permanent leaves the battlefield.
export { clearPreparedStateOnBattlefieldExit } from "./zonesClearPreparedOnBattlefieldExit.js";

// Zur's Weirding draw-replacement opponent queue helpers.
export {
  getOpponentsForPlayer,
  queueZursWeirdingOpponentStep,
  queueZursWeirdingDrawReplacementStep,
} from "./zonesDrawReplacementZursQueue.js";

// Dredge draw-replacement option-choice queue helper.
export { queueDredgeDrawReplacementStep } from "./zonesDrawReplacementDredgeQueue.js";
export { queueSkipDrawReplacementStep } from "./zonesDrawReplacementSkipDrawQueue.js";
export { applySkipDrawReplacementChoice } from "./zonesDrawReplacementSkipDrawApply.js";

// Library draw, persist, draw-by-id, and "whenever you draw" trigger emission.
export {
  persistDrawCardsEvent,
  drawCards,
  drawCardsByIds,
  processDrawTriggers,
} from "./zonesDrawCards.js";
export type { DrawCardsOptions } from "./zonesDrawCards.js";

// Mill trigger emission after cards are put into a graveyard from library.
export { processMillTriggers } from "./zonesProcessMillTriggers.js";

// Battlefield-to-library move, including commander-zone choice.
export { movePermanentToLibrary } from "./zonesMovePermanentToLibrary.js";

// Battlefield-to-hand bounce, including commander-zone choice.
export { movePermanentToHand } from "./zonesMovePermanentToHand.js";

// Already-removed permanent into exile, including commander-zone choice.
export { moveRemovedPermanentToExile } from "./zonesMoveRemovedPermanentToExile.js";
