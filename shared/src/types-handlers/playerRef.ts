/**
 * Origin parent: shared/src/types.ts
 *
 * Cluster moved: client-visible PlayerRef.
 *
 * Public entry symbols: PlayerRef.
 */

import type { PlayerID, SeatIndex } from './identityTypes.js';
import type { ManaPool } from './manaPoolTypes.js';

/* Player reference visible to clients */
export interface PlayerRef {
  id: PlayerID;
  name: string;
  seat: SeatIndex;
  isSpectator?: boolean;
  inactive?: boolean;
  eliminated?: boolean;
  // Optional server-side properties
  life?: number;
  // Additional optional properties used by rules-engine
  hand?: any[];
  library?: any[];
  graveyard?: any[];
  sideboard?: any[];
  attractionDeck?: any[];
  contraptionDeck?: any[];
  // battlefield removed - use state.battlefield filtered by controller
  exile?: any[];
  commandZone?: any[];
  counters?: Record<string, number>;
  hasLost?: boolean;
  lostReason?: string; // Reason why player lost (e.g., "Life total reached 0 or less")
  isAI?: boolean;
  deckName?: string;
  commanderDamage?: Record<string, number>;
  manaPool?: ManaPool;
}
