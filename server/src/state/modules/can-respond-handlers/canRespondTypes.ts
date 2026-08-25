// server/src/state/modules/can-respond-handlers/canRespondTypes.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: shared spell / land / commander candidate types used by
// getCastableSpellCandidates and the rest of the can-respond surface.
// Public entry symbols: SharedSpellSourceZone, SharedSpellCandidateMode,
// SharedSpellCandidatePayability, SharedSpellCastMethod, SharedLandSourceZone,
// SharedSourceGrantedAdditionalCost, SharedSpellCastCandidate,
// SharedPlayableLandCandidate, SharedCommanderParsedCost,
// SharedCommanderBaseCandidate, SharedCommanderAvailabilityCandidate,
// SharedCommanderCastCandidate.

import type { GraveyardCastingPermissionCostMode } from '../graveyard-permissions.js';
import type { parseManaCost } from '../mana-check.js';

export type SharedSpellSourceZone = 'hand' | 'graveyard' | 'exile' | 'library';
export type SharedSpellCandidateMode = 'main' | 'response' | 'sorcery';
export type SharedSpellCandidatePayability = 'normal' | 'alternate' | 'assumed';
export type SharedSpellCastMethod = 'normal' | 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize' | 'mayhem' | 'foretell' | 'playable_from_exile' | 'adventure_creature' | 'graveyard_permanent' | 'graveyard_adventure';
export type SharedLandSourceZone = SharedSpellSourceZone;

export interface SharedSourceGrantedAdditionalCost {
  type: 'discard' | 'sacrifice' | 'remove_counters' | 'pay_life' | 'reveal';
  amount: number;
  filter?: string;
  counterType?: string;
  distributed?: boolean;
}

export interface SharedSpellCastCandidate {
  card: any;
  castCard: any;
  sourceZone: SharedSpellSourceZone;
  castMethod: SharedSpellCastMethod;
  payability: SharedSpellCandidatePayability;
  manaCost?: string;
  cost?: ReturnType<typeof parseManaCost>;
  payableCost?: ReturnType<typeof parseManaCost>;
  grantsFlash?: boolean;
  spendManaAsThoughAnyType?: boolean;
  exileAfterResolution?: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  sourceGrantedAdditionalCost?: SharedSourceGrantedAdditionalCost;
  /** Alias of DurablePermission.id / graveyardPermissionId for cast-intent requests. */
  castPermissionId?: string;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode?: GraveyardCastingPermissionCostMode;
  /** Mosswood-style: permission only allows casting the Adventure face. */
  castAsAdventureOnly?: boolean;
  libraryPermissionCostMode?: string;
  /** Payment intent when permission/cost mode grants a free cast (not a second candidate). */
  alternateCostId?: 'free';
  castWithoutPayingManaCost?: boolean;
}

export interface SharedPlayableLandCandidate {
  card: any;
  sourceZone: SharedLandSourceZone;
  selectedFaceIndex?: number;
  castPermissionId?: string;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
}

export type SharedCommanderParsedCost = ReturnType<typeof parseManaCost> & {
  cmc: number;
};

export interface SharedCommanderBaseCandidate {
  card: any;
  commanderId: string;
  manaCost: string;
  cost: SharedCommanderParsedCost;
  payableCost?: SharedCommanderParsedCost;
  grantsFlash: boolean;
  isBackground: boolean;
  commanderTax: number;
  costAdjustment: number;
  commandZonePermissionCostMode?: string;
  spendManaAsThoughAnyType?: boolean;
}

export interface SharedCommanderAvailabilityCandidate extends SharedCommanderBaseCandidate {
  canPayCost: boolean;
}

export type SharedCommanderCastCandidate = SharedCommanderBaseCandidate;
