// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: declarative ReplacementEffectSpec types and per-event match interfaces.
// Public entry symbols: ReplacementEffectSpecEvent, ReplacementModifyMode,
//   ReplacementZoneChangeMatch, ReplacementMillMatch, ReplacementLibrarySearchMatch,
//   ReplacementCounterMatch, ReplacementDrawMatch, ReplacementLifeGainMatch,
//   ReplacementLifeLossMatch,
//   ReplacementTokenMatch, ReplacementDamageMatch, ReplacementLoseGameMatch,
//   ReplacementLoseGameInstead, ReplacementEffectSpec.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type {
  ReplacementEvent,
  ReplacementZone,
} from '../replacement-effects.js';

/** Declarative replacement spec (Phase 5.1). See docs/oracle-ir-phase5-continuous-effects-design.md */
export type ReplacementEffectSpecEvent = ReplacementEvent['type'] | 'lose-game';

export type ReplacementModifyMode = 'double' | 'triple' | 'add_flat' | 'halve' | 'cap';

export interface ReplacementZoneChangeMatch {
  sourceZone?: ReplacementZone;
  destinationZone?: ReplacementZone;
  /** Destination must be one of these zones (e.g. commander replacement). */
  destinationZoneIn?: ReplacementZone[];
  /** Object is a commander (`isCommander` flag or `metadata.commanderIds`). */
  objectIsCommander?: boolean;
  /** Stack item `castWithAbility` / alternative-cost marker must be one of these (lowercase). */
  castWithAbilityIn?: string[];
  /** Stack item has `exileAfterResolution` metadata. */
  exileAfterResolution?: boolean;
  /** Permanent metadata requests exile instead of leaving the battlefield. */
  leaveBattlefieldExileInstead?: boolean;
  /** Object is a token (`isToken` on permanent or card). */
  objectIsToken?: boolean;
  /** Object has a positive counter of this type (e.g. `finality`). */
  objectHasCounter?: string;
  /** Object type line must include this substring (lowercase). */
  objectTypeLineIncludes?: string;
  /** Destination must not be this zone. */
  destinationZoneNot?: ReplacementZone;
}

export interface ReplacementMillMatch {
  millingPlayerIsSourceController?: boolean;
  targetIsOpponent?: boolean;
}

export interface ReplacementLibrarySearchMatch {
  /** Searching player must be an opponent of the spec source controller. */
  searchingPlayerIsOpponentOfSource?: boolean;
  /** Searching player must be the spec source controller. */
  searchingPlayerIsSourceController?: boolean;
}

export interface ReplacementCounterMatch {
  counterTypeIncludes?: string;
  targetControllerIsSourceController?: boolean;
}

export interface ReplacementDrawMatch {
  /** Drawing player must be an opponent of the spec source controller. */
  drawingPlayerIsOpponentOfSource?: boolean;
  /** Drawing player must be the spec source controller (Thought Reflection family). */
  drawingPlayerIsSourceController?: boolean;
  /** Skip when `event.metadata[key] === true`. */
  skipWhenEventMetadataTrue?: string;
  /** Require `event.metadata[key] === true` (Island Sanctuary draw-step skip). */
  requireEventMetadataTrue?: string;
  /** Exact draw count on the event (per-card replacements use 1). */
  exactDrawCount?: number;
  /** Minimum draw count on the event (e.g. Alms Collector). */
  minimumDrawCount?: number;
}

export interface ReplacementLifeGainMatch {
  /** Gaining player must be an opponent of the spec source controller. */
  gainingPlayerIsOpponentOfSource?: boolean;
  /** Gaining player must be the spec source controller (Boon Reflection family). */
  gainingPlayerIsSourceController?: boolean;
  /** Gaining player must be the player this aura (spec source) is attached to. */
  gainingPlayerIsEnchantedBySource?: boolean;
  /** Gaining player's current life must be at least this (Angel of Vitality). */
  gainingPlayerLifeGte?: number;
}

export interface ReplacementLifeLossMatch {
  /** Losing player must be an opponent of the spec source controller. */
  losingPlayerIsOpponentOfSource?: boolean;
  /** Losing player must be the spec source controller. */
  losingPlayerIsSourceController?: boolean;
  /** Losing player must be the player this aura (spec source) is attached to. */
  losingPlayerIsEnchantedBySource?: boolean;
  /** Only apply while it is the spec source controller's turn. */
  duringSourceControllerTurn?: boolean;
}

export interface ReplacementTokenMatch {
  /** Creating player must be the spec source controller (Anointed Procession family). */
  creatingPlayerIsSourceController?: boolean;
  /** Token being created must be a creature (Ojer Taq). */
  tokenIsCreature?: boolean;
}

export interface ReplacementDamageMatch {
  /** Damage dealer must be the spec source controller (Angrath's Marauders). */
  dealingPlayerIsSourceController?: boolean;
  /** Receiving player must be an opponent of the spec source controller (Gisela double). */
  receivingPlayerIsOpponentOfSource?: boolean;
  /** Receiving player must be the spec source controller (Gisela prevent-half). */
  receivingPlayerIsSourceController?: boolean;
  /** Damage source permanent must be the creature this aura (spec source) is attached to. */
  damageSourceIsEnchantedBySource?: boolean;
  /** Only apply when the damage event is combat damage. */
  combatDamageOnly?: boolean;
  /** Receiving permanent's controller must be the spec source controller. */
  receivingPermanentControllerIsSourceController?: boolean;
  /** Receiving permanent must not be the spec source ("another"). */
  receivingPermanentIsNotSource?: boolean;
  /** Receiving permanent type line / creature types must include each token. */
  receivingPermanentTypeIncludesAll?: readonly string[];
  /**
   * Damage is to the source controller (no target permanent) or to a matching
   * permanent they control, including the source (Hyperion / Ajani emblem).
   */
  receivingIsYouOrMatchingPermanentYouControl?: boolean;
  /** Worship: apply only while the source controller controls a creature. */
  requiresSourceControllerControlsCreature?: boolean;
}

export interface ReplacementLoseGameMatch {
  /** The queried player must be the spec source controller. */
  affectedPlayerIsSourceController?: boolean;
  /** The queried player must be an opponent of the spec source controller. */
  affectedPlayerIsOpponentOfSource?: boolean;
  /** Applies to every player (Platinum Persecutor family). */
  affectedPlayerIsAny?: boolean;
  /** "As long as you control a Gideon planeswalker" — type_line substring. */
  requiresControlledTypeIncludes?: string;
  /** Pact Weapon family: source must be attached to a creature. */
  requiresAttachedToCreature?: boolean;
}

export interface ReplacementLoseGameInstead {
  controllerCantLose?: boolean;
  controllerCantWin?: boolean;
  opponentsCantLose?: boolean;
  opponentsCantWin?: boolean;
  allPlayersCantLose?: boolean;
  allPlayersCantWin?: boolean;
  /** Transcendence / Phyrexian Unlife — only SBAs for 0 or less life. */
  onlyZeroOrLessLife?: boolean;
  /** Mine, Mine, Mine! family — only empty-library draw loss. */
  onlyEmptyLibrary?: boolean;
}

export interface ReplacementEffectSpec {
  id: string;
  event: ReplacementEffectSpecEvent;
  match?: ReplacementZoneChangeMatch & ReplacementMillMatch & ReplacementLibrarySearchMatch & ReplacementCounterMatch & ReplacementDrawMatch & ReplacementLifeGainMatch & ReplacementLifeLossMatch & ReplacementDamageMatch & ReplacementTokenMatch & ReplacementLoseGameMatch;
  instead: {
    redirectZone?: ReplacementZone;
    choiceRequired?: boolean;
    replacementOptions?: ReplacementZone[];
    modify?: ReplacementModifyMode;
    value?: number;
    /** Can't-lose / can't-win polarity (Platinum Angel / Abyssal Persecutor). */
    loseGame?: ReplacementLoseGameInstead;
    /** Laboratory Maniac / Jace: win instead of losing to an empty-library draw. */
    winInsteadOfLose?: boolean;
    /** Worship / Fortune Thief: leave life at this floor (damage to you). */
    floorLifeAt?: number;
    /** Redirect the draw to the source permanent's controller (Notion Thief). */
    redirectDrawTo?: 'source_controller';
    /** Each affected player draws this many instead (Alms Collector). */
    sharedDrawCount?: number;
    /** Prevent life gain (0) or replace with life loss (negative amount). */
    replaceLifeGainWith?: 'none' | 'loss';
    /** Players matching the spec cannot search libraries. */
    preventSearch?: boolean;
    /** Paying this mana lets the searching player ignore the restriction (Leonin Arbiter). */
    paymentToIgnore?: string;
    /** Replace a full-library search with the top N cards (Aven Mindcensor). */
    limitToTop?: number;
    /** The spec source controller controls the searching player during the search. */
    controlSearch?: boolean;
    /** Triggered consequence when an opponent searches (Ob Nixilis family). */
    triggerEffect?: string;
  };
  effectId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  sourcePermanentId?: string;
  sourceController?: string;
  sourceName?: string;
}

