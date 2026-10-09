/**
 * Origin parent: shared/src/types.ts
 *
 * Cluster moved: BattlefieldPermanent plus exclusive modifier/mutate/temp-effect types.
 *
 * Public entry symbols: PermanentModifier, PTBonusSource, BattlefieldPermanent,
 * MutatedCardInStack, MutatedCardStack, TemporaryEffect.
 */

import type { PlayerID } from './identityTypes.js';
import type { CardRef } from './cardRefTypes.js';

/* Modifier applied to a permanent (power/toughness, abilities, etc.) */
export interface PermanentModifier {
  readonly type: 'powerToughness' | 'POWER_TOUGHNESS' | 'ability' | 'ABILITY' | string;
  readonly power?: number;
  readonly toughness?: number;
  readonly setPower?: number;
  readonly setToughness?: number;
  readonly ability?: string;
  readonly sourceId?: string;
  readonly duration?: 'permanent' | 'static' | 'end_of_turn' | 'end_of_combat' | 'until_next_turn' | 'this_turn';
  /** Turn number the modifier was created on (long-lived durations expire by turn). */
  readonly turnApplied?: number;
  /** "Until your next turn": expires when this player's next turn begins. */
  readonly expiresOnControllerTurn?: string;
  /**
   * Layer 7b ordering for setPowerToughness ("becomes an X/Y"): higher timestamp wins.
   * `battlefieldPosition` is the battlefield length when the effect was created, used to
   * interleave with Aura / static set-base effects (whose timestamp is their battlefield index).
   */
  readonly timestamp?: number;
  readonly battlefieldPosition?: number;
  readonly battlefieldAnchorId?: string;
  /**
   * "For as long as <condition>" pumps: counted only while the condition holds (evaluated against `sourceId`),
   * removed once it stops. `linkControllerId` is the controller of the source when the effect resolved.
   */
  readonly linkCondition?: {
    readonly kind: 'source_tapped' | 'source_attached' | 'controller_controls_source' | 'controller_controls_matching';
    readonly matching?: string;
  };
  readonly linkControllerId?: string;
  /** True when `timestamp` was drawn from the game-wide permanent timestamp counter (exact layer 7b ordering). */
  readonly globalTimestamp?: boolean;
}

/**
 * Source of a P/T bonus for display in tooltips.
 * Used to show players where their creature's stats come from.
 */
export interface PTBonusSource {
  name: string;           // Name of the source (card name, "Counters", etc.)
  power: number;          // Power bonus from this source
  toughness: number;      // Toughness bonus from this source
  type: 'equipment' | 'aura' | 'enchantment' | 'creature' | 'artifact' | 'counter' | 'modifier' | 'emblem' | 'other';
}

/* Battlefield permanent shape */
export interface BattlefieldPermanent {
  id: string;
  controller: PlayerID;
  owner: PlayerID;
  leaveBattlefieldReplacement?: 'exile';
  tapped?: boolean;
  /** CR 701.64b designation. It is not copiable and clears when this object leaves the battlefield. */
  harnessed?: boolean;
  counters?: Readonly<Record<string, number>>;
  basePower?: number;
  baseToughness?: number;
  attachedTo?: string;
  /** Game-wide entry timestamp (CR 613.7); also the timestamp of this permanent's static abilities. */
  timestamp?: number;
  /** Timestamp of when this Aura/Equipment became attached to `attachedTimestampFor` (CR 613.7e). */
  attachedTimestamp?: number;
  attachedTimestampFor?: string;
  attachments?: string[];           // IDs of permanents attached to this one (auras, equipment)
  modifiers?: readonly PermanentModifier[]; // Power/toughness and other modifiers from effects
  effectivePower?: number;
  effectiveToughness?: number;
  trepanationBonus?: number;
  lastTrepanationBonus?: number;
  /** Sources contributing to P/T bonuses, for tooltip display */
  ptSources?: PTBonusSource[];
  isCommander?: boolean;
  grantedAbilities?: string[];
  posX?: number;
  posY?: number;
  posZ?: number;
  /** Text-changing effects may override oracle text on the permanent */
  oracle_text?: string;
  card: CardRef;
  // Combat state
  attacking?: PlayerID | string;  // Player ID being attacked, or permanent ID if attacking a planeswalker
  blocking?: string[];            // Array of creature IDs this creature is blocking
  blockedBy?: string[];           // Array of creature IDs blocking this creature
  // Planeswalker fields
  baseLoyalty?: number;           // Starting loyalty
  loyalty?: number;               // Current loyalty counter value
  // Targeting state (for visual indicators)
  targetedBy?: string[];          // IDs of spells/abilities targeting this permanent
  // Temporary effects applied to this permanent (e.g., "exile if dies this turn", "gains +1/+1 until end of turn")
  temporaryEffects?: readonly TemporaryEffect[];
  // Creature type choice for changeling/tribal effects (e.g., Mistform Ultimus)
  chosenCreatureType?: string;
  /** Color chosen as this permanent entered (Thriving lands, Painter's Servant, Utopia Sprawl). */
  chosenColor?: string;
  chosenMana?: string;
  // Class cards use battlefield state to track their current level designation
  level?: number;
  // Phasing support
  phasedOut?: boolean;
  phaseOutController?: PlayerID;
  // Teferi's Protection and similar effects
  teferisProtection?: boolean;
  // Echo paid tracking
  echoPaid?: boolean;
  // Token flag
  isToken?: boolean;
  /**
   * True when a characteristic-defining ability currently says this isn't a creature
   * (Theros gods below devotion, impending with time counters).
   */
  notCreature?: boolean;
  // Provenance for token-linked delayed cleanup/reference effects
  createdBySourceId?: string;
  createdBySourceName?: string;
  // Summoning sickness
  summoningSickness?: boolean;
  // Track if this permanent entered this turn (combat/trigger helpers)
  enteredThisTurn?: boolean;
  // Damage marked for state-based actions
  damageMarked?: number;
  // Mobilize tokens - sacrifice at end step
  sacrificeAtEndStep?: boolean;
  // Is currently attacking (for tokens created attacking)
  isAttacking?: boolean;
  // Equipment tracking
  attachedEquipment?: string[];     // IDs of equipment attached to this creature
  isEquipped?: boolean;             // True if this creature has equipment attached
  // Goad mechanic (Rule 701.15)
  goadedBy?: string[];              // Player IDs who have goaded this creature
  goadedUntil?: Readonly<Record<string, number>>; // Map of player ID -> turn number when goad expires
  // Soulbond pairing (Rule 702.95) — bilateral partner permanent id
  pairedWith?: string;
  // Mutate support (Rule 702.140)
  mutatedStack?: MutatedCardStack;  // Stack of cards in a mutated creature (presence indicates mutation)
  mutationCount?: number;           // Number of times this creature has been mutated
  // Monstrosity support (Rule 701.37)
  isMonstrous?: boolean;
  monstrosityX?: number;
  // Control change mechanics (Xantcha, Vislor Turlough, Akroan Horse)
  mustAttackEachCombat?: boolean;   // Xantcha-style: creature must attack each combat if able
  cantAttackOwner?: boolean;        // Xantcha-style: creature can't attack its owner
  ownerId?: PlayerID;               // Original owner for cantAttackOwner restriction
  pendingControlChange?: {          // ETB control change pending opponent selection
    type: 'enters_under_opponent_control' | 'may_give_opponent' | 'opponent_gains';
    originalOwner: PlayerID;
    isOptional?: boolean;
    goadsOnChange?: boolean;
    mustAttackEachCombat?: boolean;
    cantAttackOwner?: boolean;
  };
  // Token grouping optimization - when many identical tokens exist, server groups them
  isGroupedTokens?: boolean;        // True if this represents multiple identical tokens
  tokenCount?: number;              // Number of tokens in this group (only if isGroupedTokens)
  groupedTokenIds?: string[];       // Original IDs of all tokens in this group
  originalId?: string;              // First token's ID (for consistent group identification)
}

/**
 * Represents a card in a mutated permanent's stack
 * Rule 702.140e: Mutated permanents are represented by multiple cards
 */
export interface MutatedCardInStack {
  id: string;
  name: string;
  typeLine: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  manaCost?: string;
  isOriginal: boolean;    // True if this was the original creature (not from mutating)
  isCommander?: boolean;  // True if this card is a commander
  imageUrl?: string;
}

/**
 * The stack of cards that make up a mutated permanent
 * Rule 702.140e: Top card determines characteristics, all cards provide abilities
 */
export type MutatedCardStack = readonly MutatedCardInStack[];

/* Temporary effect applied to a permanent or player */
export interface TemporaryEffect {
  id: string;
  description: string;           // Human-readable description
  icon?: string;                 // Icon/emoji for the effect
  expiresAt?: 'end_of_turn' | 'end_of_combat' | 'next_upkeep' | 'leaves_battlefield';
  /** Effects like detain expire as the named player's next turn begins. */
  expiresOnControllerTurn?: PlayerID;
  sourceId?: string;             // ID of the permanent/spell that created this effect
  sourceName?: string;           // Name of the source
  /**
   * Optional keyword abilities granted while this effect remains active.
   * Used so cleanup can remove transient granted abilities cleanly.
   */
  grantedAbilities?: readonly string[];
}
