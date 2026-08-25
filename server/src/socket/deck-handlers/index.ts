/**
 * socket/deck-handlers/index.ts
 *
 * Internal table of contents for clusters extracted out of
 * server/src/socket/deck.ts. Named re-exports only - no implementations,
 * no `export *`. Leaves must never import deck.ts or this index.
 *
 * The public/compatibility barrel stays socket/deck.ts.
 */

// Pending import-wipe confirm state, buffer mapping, room/saved-deck guards.
export {
  canModifySavedDeck,
  cancelImportWipeConfirmResolutionSteps,
  isSocketInGameRoom,
  makeImportConfirmId,
  pendingImportConfirmations,
  toImportBufferCard,
} from "./deckImportConfirmState.js";
export type { PendingConfirm } from "./deckImportConfirmState.js";

// Confirm broadcast/cancel, initial-draw flags, snapshot restore, commander names.
export {
  addPendingInitialDrawFlag,
  broadcastConfirmUpdate,
  cancelConfirmation,
  clearPlayerTransientZonesForImport,
  getActivePlayerIds,
  removePendingInitialDrawFlag,
  restoreSnapshotIfPresent,
  suggestCommanderNames,
} from "./deckImportConfirmHelpers.js";

// Confirmed-import apply (reset/wipe or importer-only).
export { applyConfirmedImport } from "./deckApplyConfirmedImport.js";

// Unique instance ids, resolution-status reporter, wipe-confirm RQ enqueue.
export {
  createDeckResolutionStatusReporter,
  enqueueImportWipeConfirmToResolutionQueue,
  generateUniqueCardInstanceId,
  MIN_PRECON_DECK_SIZE,
} from "./deckImportResolutionSupport.js";

// importDeck socket registration.
export { registerImportDeckHandler } from "./deckImportDeckSocketHandlers.js";

// useSavedDeck socket registration.
export { registerUseSavedDeckHandler } from "./deckUseSavedDeckSocketHandlers.js";

// importPreconDeck socket registration.
export { registerImportPreconDeckHandler } from "./deckImportPreconDeckSocketHandlers.js";

// importDeckFromUrl socket registration.
export { registerImportDeckFromUrlHandler } from "./deckImportDeckFromUrlSocketHandlers.js";
