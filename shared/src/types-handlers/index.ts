/**
 * Internal agent TOC for clusters extracted from shared/src/types.ts.
 *
 * Named re-exports only - no implementations, no `export *`. The public
 * compatibility barrel stays `shared/src/types.ts`; leaves in this folder
 * must never import it (nor this index).
 */

// Identity aliases used across shared game types.
export type { GameID, PlayerID, SeatIndex, GameFormat } from './identityTypes.js';

// Card-ref shapes used by zones, stack items, and battlefield permanents.
export type { ImageUris, CardFace, KnownCardRef, HiddenCardRef, CardRef } from './cardRefTypes.js';

// Restricted-mana entries and the per-player mana pool.
export type { ManaRestrictionType, RestrictedManaEntry, ManaPool } from './manaPoolTypes.js';

// Client-visible player seat/ref (not the unused types/Player.ts copy).
export type { PlayerRef } from './playerRef.js';

// Battlefield permanent plus exclusive modifier / mutate / temp-effect types.
export type {
  PermanentModifier,
  PTBonusSource,
  BattlefieldPermanent,
  MutatedCardInStack,
  MutatedCardStack,
  TemporaryEffect,
} from './battlefieldPermanent.js';
