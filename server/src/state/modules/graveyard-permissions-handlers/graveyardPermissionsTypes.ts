// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: public graveyard-permission interfaces and type aliases.
// Public entry symbols: GrantedFlashbackInfo, GrantedUnearthInfo, GrantedGraveyardKeywordInfo,
//   PrintedSelfCastPermissionInfo, TemporaryGraveyardKeywordGrant,
//   TemporaryPlayableFromGraveyardPermission, GraveyardCastingPermissionKind,
//   GraveyardCastingPermissionDuration, GraveyardCastingPermissionCostMode,
//   GraveyardCastingPermissionCardFilter, GraveyardCastingPermissionUsageLimit,
//   GraveyardCastingPermissionReplacement, GraveyardCastingPermissionAdditionalCost,
//   GraveyardCastingPermission, GraveyardGrantKeyword.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

export interface GrantedFlashbackInfo {
  hasIt: boolean;
  cost?: string;
  sourceId?: string;
  sourceName?: string;
}

export interface GrantedUnearthInfo {
  hasIt: boolean;
  cost?: string;
  sourceId?: string;
  sourceName?: string;
}

export interface GrantedGraveyardKeywordInfo {
  hasIt: boolean;
  cost?: string;
  additionalExileCount?: number;
  sourceId?: string;
  sourceName?: string;
}

export interface PrintedSelfCastPermissionInfo {
  hasIt: boolean;
  cost?: string;
  fromExile?: boolean;
}

export interface TemporaryGraveyardKeywordGrant {
  playerId: string;
  cardId: string;
  keyword: GraveyardGrantKeyword;
  cost?: string;
  additionalExileCount?: number;
  sourceId?: string;
  sourceName?: string;
  expiresAt: 'end_of_turn' | 'this_turn';
  turnApplied?: number;
}

export interface TemporaryPlayableFromGraveyardPermission {
  playerId: string;
  permission: 'play' | 'cast';
  qualifier: string;
  sourceId?: string;
  sourceName?: string;
  expiresAt: 'end_of_turn' | 'this_turn';
  turnApplied?: number;
}

export type GraveyardCastingPermissionKind = 'play' | 'cast';
export type GraveyardCastingPermissionDuration = 'this_turn' | 'end_of_turn' | 'until_end_of_next_turn' | 'static';
export type GraveyardCastingPermissionCostMode = 'normal' | 'alternate' | 'without_paying_mana_cost';

export interface GraveyardCastingPermissionCardFilter {
  qualifier?: string;
  cardIds?: string[];
}

export interface GraveyardCastingPermissionUsageLimit {
  type: 'once' | 'once_per_turn' | 'one_per_permanent_type';
  maxUses?: number;
}

export interface GraveyardCastingPermissionReplacement {
  exileAfterResolution?: boolean;
  leaveBattlefieldDestination?: 'exile';
  leaveBattlefieldLifeGain?: number;
  sourceName?: string;
}

export interface GraveyardCastingPermissionAdditionalCost {
  type: 'discard' | 'sacrifice' | 'remove_counters' | 'exile_from_graveyard';
  amount: number;
  filter?: string;
  counterType?: string;
  distributed?: boolean;
}

export interface GraveyardCastingPermission {
  id: string;
  playerId: string;
  permission: GraveyardCastingPermissionKind;
  sourceZone: 'graveyard';
  cardFilter: GraveyardCastingPermissionCardFilter;
  costMode: GraveyardCastingPermissionCostMode;
  duration: GraveyardCastingPermissionDuration;
  turnApplied?: number;
  sourceId?: string;
  sourceName?: string;
  sourceText?: string;
  additionalCost?: GraveyardCastingPermissionAdditionalCost;
  usageLimit?: GraveyardCastingPermissionUsageLimit;
  replacement?: GraveyardCastingPermissionReplacement;
  /** Only the Adventure face may be cast (e.g. Mosswood Dreadknight dies trigger). */
  castAsAdventureOnly?: boolean;
}

export type GraveyardGrantKeyword = 'flashback' | 'unearth' | 'jump-start' | 'retrace' | 'escape' | 'harmonize' | 'embalm';
