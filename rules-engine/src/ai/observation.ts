/**
 * Public AI Observation types.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-1). Decision code should read Observation,
 * never raw game.state, so hidden zones cannot leak into scoring or planning.
 *
 * Public entry symbols: Observation, CardView, PermanentView, PermanentKeywordsView,
 * OpponentView, SelfView, StackItemView, CommanderView, BuildObservationOptions.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import type { ManaPool } from '../../../shared/src/types-handlers/manaPoolTypes.js';

/** Keywords the combat planners and evaluator need. Subset of CombatKeywords. */
export interface PermanentKeywordsView {
  flying: boolean;
  deathtouch: boolean;
  lifelink: boolean;
  trample: boolean;
  indestructible: boolean;
  doubleStrike: boolean;
  firstStrike: boolean;
  menace: boolean;
  haste: boolean;
  defender: boolean;
  vigilance: boolean;
}

/** A card the seat may know about (own hand, public zones, own decklist). */
export interface CardView {
  id: string;
  name?: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
  cmc?: number;
  faceDown?: boolean;
}

/**
 * A permanent as the AI seat sees it.
 * Field names follow the Phase 1 file map; summoningSick maps from the engine's summoningSickness.
 */
export interface PermanentView {
  id: string;
  controller: PlayerID;
  /** Absent when face down. */
  name?: string;
  typeLine: string;
  /** Lower-case permanent types: creature, land, artifact, enchantment, planeswalker, … */
  types: string[];
  /** Empty when face down. */
  oracleText: string;
  isToken: boolean;
  isCommander: boolean;
  /** Effective power from getCreaturePower; 0 for non-creatures. */
  power: number;
  /** Effective toughness from getCreatureToughness; 0 for non-creatures. */
  toughness: number;
  keywords: PermanentKeywordsView;
  tapped: boolean;
  /** True when the permanent has summoning sickness (engine field: summoningSickness). */
  summoningSick: boolean;
  counters: Record<string, number>;
  /** Planeswalkers only. */
  loyalty?: number;
  producesMana: boolean;
  faceDown: boolean;
}

export interface CommanderView {
  id: string;
  name?: string;
  typeLine?: string;
  inCommandZone: boolean;
  tax?: number;
}

export interface SelfView {
  life: number;
  hand: CardView[];
  /** Own deck composition still in library, unordered. Sorted by name in the builder. */
  deckList: CardView[];
  librarySize: number;
  graveyard: CardView[];
  exile: CardView[];
  battlefield: PermanentView[];
  commanders: CommanderView[];
  manaPool: ManaPool;
}

export interface OpponentView {
  id: PlayerID;
  life: number;
  handSize: number;
  librarySize: number;
  graveyard: CardView[];
  exile: CardView[];
  battlefield: PermanentView[];
  commanders: CommanderView[];
  eliminated: boolean;
}

export interface StackItemView {
  id: string;
  controller: PlayerID;
  name: string;
  /** Mana value when known; 0 when unknown. */
  cmc: number;
  type: string;
}

export interface Observation {
  seat: PlayerID;
  turn: number;
  phase: string;
  step?: string;
  activeSeat: PlayerID;
  priority: PlayerID;
  self: SelfView;
  opponents: OpponentView[];
  stack: StackItemView[];
  /**
   * Victim player id → commander card id → damage dealt.
   * Same keying as state.commanderDamage / readCommanderDamageTaken.
   */
  commanderDamage: Record<PlayerID, Record<string, number>>;
}

/**
 * Optional inputs that live outside game.state on the server (libraries Map).
 * When omitted, the builder falls back to zones.library / libraryCount.
 */
export interface BuildObservationOptions {
  /** Own library cards; order is discarded (sorted by name into deckList). */
  ownLibrary?: readonly any[];
  /** Library sizes keyed by player id when libraries live outside state. */
  librarySizes?: Readonly<Record<string, number>>;
}
