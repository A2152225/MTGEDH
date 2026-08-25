// server/src/state/modules/dungeon-effects-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/dungeon-effects.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/dungeon-effects.ts.
// Leaves must not import dungeon-effects.ts or this index.

// Room-effect payload type plus library / pending-card / shuffle helpers.
export type { DungeonRoomExecuteEffectPayload } from "./dungeonRoomCardHelpers.js";
export {
  cloneZoneCards,
  getLibraryCards,
  getTopLibraryCards,
  getPendingDungeonRoomCardChoiceKey,
  setPendingDungeonRoomCardIds,
  getPendingDungeonRoomCardIds,
  getLibraryCardChoiceEntries,
  shuffleCardsInPlace,
} from "./dungeonRoomCardHelpers.js";

// Automatic dungeon room token/exile/draw/shuffle effects.
export { applyAutomaticDungeonRoomTokenEffects } from "./dungeonRoomTokenEffects.js";
