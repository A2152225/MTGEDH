// shared/src/types.ts
// Canonical shared types and enums used by client and server.
// Full expanded version, merged with PRE_GAME support.

import type { GameFormat, GameID, PlayerID } from './types-handlers/identityTypes.js';
import type { CardFace, CardRef, ImageUris, KnownCardRef } from './types-handlers/cardRefTypes.js';
import type { PlayerRef } from './types-handlers/playerRef.js';
import type { BattlefieldPermanent } from './types-handlers/battlefieldPermanent.js';
import type { ManaPool } from './types-handlers/manaPoolTypes.js';

export type { GameID, PlayerID, SeatIndex, GameFormat } from './types-handlers/identityTypes.js';


export type { ImageUris, CardFace, KnownCardRef, HiddenCardRef, CardRef } from './types-handlers/cardRefTypes.js';


export type { PlayerRef } from './types-handlers/playerRef.js';


/* Full server-side Player shape (subset exported for server) */
export interface Player {
  id: PlayerID;
  name: string;
  socketId?: string;
  connected?: boolean;

  life?: number;
  startingLife?: number;

  library?: string[];
  hand?: string[];
  graveyard?: string[];
  sideboard?: any[];
  attractionDeck?: any[];
  contraptionDeck?: any[];

  poisonCounters?: number;
  energyCounters?: number;
  experienceCounters?: number;
  commanderDamage?: Record<string, number>;
  commandZone?: any[];
  // battlefield removed - use state.battlefield filtered by controller
  exile?: any[];
  manaPool?: any;
}

/**
 * Player status for counter tracking and protection effects
 * 
 * Rule 122: Players can have counters placed on them, tracking various resources
 * and effects throughout the game.
 * 
 * @property poison - Poison counters (Rule 122.1a, Rule 104.3d - lose at 10)
 * @property experience - Experience counters for Commander experience abilities
 * @property energy - Energy counters (resource for Kaladesh-style effects)
 * @property hexproof - Player has hexproof (can't be targeted by opponents)
 * @property shroud - Player has shroud (can't be targeted)
 * @property lifeCannotChange - Player's life total can't change
 * @property protectionFromEverything - Teferi's Protection style effect
 */
export interface PlayerStatus {
  poison?: number;
  experience?: number;
  energy?: number;
  hexproof?: boolean;
  shroud?: boolean;
  lifeCannotChange?: boolean;
  protectionFromEverything?: boolean;
}

/* Player zones shape used in views */
export interface PlayerZones {
  hand: KnownCardRef[] | string[]; // sometimes only counts are present in views
  handCount: number;
  libraryCount: number;
  libraryTop?: KnownCardRef;
  graveyard: KnownCardRef[] | string[];
  graveyardCount: number;
  exile?: KnownCardRef[] | string[];
  exileCount?: number;
}

/* Commander info per player */
export interface CommanderInfo {
  commanderIds: readonly string[];
  commanderNames?: readonly string[];
  tax?: number;
  taxById?: Readonly<Record<string, number>>;
  commanderCards?: ReadonlyArray<{
    id: string;
    name: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: ImageUris;
    mana_cost?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    card_faces?: CardFace[];
    layout?: string;
  }>;
  /** Which commander IDs are currently in the command zone (not on stack/battlefield) */
  inCommandZone?: readonly string[];
}

export type {
  PermanentModifier,
  PTBonusSource,
  BattlefieldPermanent,
  MutatedCardInStack,
  MutatedCardStack,
  TemporaryEffect,
} from './types-handlers/battlefieldPermanent.js';


export interface DamagePreventionEffect {
  id: string;
  description: string;
  sourceId?: string;
  sourceName?: string;
  controllerId?: PlayerID;
  targetSourceId: string;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  remainingAmount?: number;
  consumeOnUse?: boolean;
  combatOnly?: boolean;
  /** Leave this much damage (Forcefield: prevent all but 1). */
  capTo?: number;
  /** Only apply if the damage source is an unblocked attacker. */
  unblockedOnly?: boolean;
  colors?: readonly string[];
  expiresAtTurn?: number;
}

export interface SkipNextDrawStepEffect {
  id: string;
  playerId: PlayerID;
  sourceId?: string;
  sourceName?: string;
  remainingSkips: number;
}

export interface ExtraTurnEffect {
  playerId: PlayerID;
  afterTurnNumber: number;
  source?: string;
  createdAt?: number;
}

export interface SkipNextTurnEffect {
  id: string;
  playerId: PlayerID;
  sourceId?: string;
  sourceName?: string;
  remainingSkips: number;
}

export interface FutureSpellEffect {
  id: string;
  controllerId: PlayerID;
  sourceId?: string;
  sourceName?: string;
  duration: 'this_turn';
  scope: 'all_qualifying_spells' | 'next_qualifying_spell';
  cardTypes?: readonly string[];
  timingPermission?: 'as_though_flash';
  counterImmunity?: {
    unconditional?: boolean;
    counterSourceColors?: readonly string[];
  };
  castedPermanentEntersWithCounters?: Record<string, number>;
}

/* Stack item */
export interface StackItem {
  id: string;
  type: 'spell' | 'ability' | 'triggered_ability';
  controller: PlayerID;
  card?: CardRef;
  targets?: readonly string[];
  // Target details with type information for visual display
  targetDetails?: readonly TargetInfo[];
  // For triggered abilities
  source?: string;              // ID of the permanent that has the triggered ability
  sourceName?: string;          // Name of the source permanent
  description?: string;         // Description of the triggered ability effect
  triggerType?: string;         // Type of trigger (etb, dies, attacks, etc.)
  mandatory?: boolean;          // Whether the trigger is mandatory
  value?: number;               // For abilities with numeric values (Annihilator N, etc.)
}

/* Target information for display purposes */
export interface TargetInfo {
  id: string;
  type: 'permanent' | 'player' | 'spell' | 'ability';
  name?: string;
  /** For permanent targets, the controller's ID */
  controllerId?: string;
  /** For permanent targets, the controller's name */
  controllerName?: string;
}

/* Life totals mapping */
export interface LifeTotals {
  [playerId: PlayerID]: number;
}

/* Game phase enum (expanded to include PRE_GAME) */
export enum GamePhase {
  PRE_GAME = "pre_game",
  BEGINNING = "beginning", // beginning phase (untap/upkeep/draw)
  UNTAP = "untap",
  UPKEEP = "upkeep",
  DRAW = "draw",
  PRECOMBAT_MAIN = "precombatMain",
  FIRSTMAIN = "first_main",
  COMBAT = "combat",
  POSTCOMBAT_MAIN = "postcombatMain",
  ENDING = "ending"
}

/* Game step enum */
export enum GameStep {
  UNTAP = 'UNTAP',
  UPKEEP = 'UPKEEP',
  DRAW = 'DRAW',
  MAIN1 = 'MAIN1',
  BEGIN_COMBAT = 'BEGIN_COMBAT',
  DECLARE_ATTACKERS = 'DECLARE_ATTACKERS',
  DECLARE_BLOCKERS = 'DECLARE_BLOCKERS',
  DAMAGE = 'DAMAGE',
  END_COMBAT = 'END_COMBAT',
  MAIN2 = 'MAIN2',
  END = 'END',
  CLEANUP = 'CLEANUP'
}

/**
 * House rules configuration for optional game variants.
 * Multiple rules can be enabled simultaneously (default: all off).
 * 
 * These are selectable during the pregame phase and affect gameplay mechanics.
 */
export interface HouseRules {
  /**
   * First mulligan in multiplayer is free (doesn't count toward cards to bottom).
   * This is the official Commander rule per Rule 103.5a but can be toggled.
   */
  freeFirstMulligan?: boolean;

  /**
   * Free mulligan if opening hand has no lands or all lands.
   * Common house rule to reduce non-games from mana issues.
   */
  freeMulliganNoLandsOrAllLands?: boolean;

  /**
   * Any damage dealt by a commander counts as commander damage,
   * not just combat damage. Affects the 21 commander damage loss condition.
   */
  anyCommanderDamageCountsAsCommanderDamage?: boolean;

  /**
   * If all human players mulligan in a round, decrease the mulligan count
   * by 1 for each player (effectively a "group mulligan").
   */
  groupMulliganDiscount?: boolean;

  /**
   * Concede and leave remove a player's battlefield immediately instead of
   * waiting until that player's next turn.
   */
  immediateConcede?: boolean;

  /**
   * Enable Archenemy variant cards in the match.
   * If enabled, requires a scheme deck to be imported/selected.
   */
  enableArchenemy?: boolean;

  /**
   * Enable Planechase variant cards in the match.
   * If enabled, requires a planar deck to be imported/selected.
   */
  enablePlanechase?: boolean;

  /**
   * Custom house rule suggestions submitted by players.
   * These are stored for review and potential future implementation.
   */
  customRuleSuggestions?: string[];
}

export type OracleAutomationGapClassification =
  | 'unsupported'
  | 'ambiguous'
  | 'player_choice'
  | 'invalid_input';

export interface OracleAutomationGap {
  id: string;
  timestamp: number;
  gameId: GameID;
  source: 'oracle_ir';
  classification: OracleAutomationGapClassification;
  reasonCode: string;
  message: string;
  stepKind: string;
  raw: string;
  controllerId?: PlayerID;
  sourceId?: string;
  sourceName?: string;
  turnNumber?: number;
  phase?: string;
  combatOnly?: boolean;
  metadata?: Record<string, string | number | boolean | null | readonly string[]>;
}

export type DurablePermissionZone = 'hand' | 'library' | 'graveyard' | 'exile' | 'battlefield' | 'command' | 'stack' | 'mana_pool' | string;
export type DurablePermissionAction = 'play' | 'cast' | 'activate' | 'spend_mana' | string;
export type DurablePermissionOrigin = 'self' | 'static_battlefield' | 'emblem' | 'delayed' | 'one_shot' | 'temporary' | string;
export type DurablePermissionDuration = 'this_turn' | 'end_of_turn' | 'until_end_of_next_turn' | 'while_source_remains' | 'static' | 'one_shot' | string;
export type DurablePermissionCostMode = 'normal' | 'alternate' | 'without_paying_mana_cost' | 'additional_only' | string;

export interface DurablePermissionCardFilter {
  affectedCardIds?: readonly string[];
  qualifier?: string;
  typeLineIncludes?: readonly string[];
  oracleTextIncludes?: readonly string[];
}

export interface DurablePermissionUsageLimit {
  type: 'once' | 'once_per_turn' | 'one_per_permanent_type' | 'unlimited' | string;
  maxUses?: number;
  used?: number;
  usedThisTurn?: number;
}

export interface DurablePermissionTimingOverride {
  asThoughFlash?: boolean;
  sorcerySpeedOnly?: boolean;
  duringYourTurnOnly?: boolean;
  ignoreTiming?: boolean;
}

export type DurablePermissionConditionType = 'player_controls_permanent_type' | 'player_controls_permanent_named' | 'source_on_battlefield' | string;

export interface DurablePermissionCondition {
  type: DurablePermissionConditionType;
  playerId?: PlayerID;
  minCount?: number;
  typeLineIncludes?: readonly string[];
  names?: readonly string[];
  nameIncludes?: readonly string[];
  sourceId?: string;
  sourceObjectId?: string;
  negate?: boolean;
}

export interface DurablePermissionReplacementBehavior {
  exileAfterResolution?: boolean;
  leaveBattlefieldDestination?: DurablePermissionZone;
  leaveBattlefieldLifeGain?: number;
  sourceName?: string;
}

export interface DurablePermissionDebugEvidence {
  sourceText?: string;
  reason?: string;
  createdByEventId?: string;
  notes?: readonly string[];
}

export interface DurablePermission {
  id: string;
  kind: string;
  grantedTo: PlayerID;
  allowedAction: DurablePermissionAction;
  origin: DurablePermissionOrigin;
  duration: DurablePermissionDuration;
  sourceId?: string;
  sourceName?: string;
  sourceZone?: DurablePermissionZone;
  sourceObjectId?: string;
  allowedSourceZones?: readonly DurablePermissionZone[];
  allowedDestination?: DurablePermissionZone;
  cardFilter?: DurablePermissionCardFilter;
  usageLimit?: DurablePermissionUsageLimit;
  costMode?: DurablePermissionCostMode;
  timingOverride?: DurablePermissionTimingOverride;
  condition?: DurablePermissionCondition;
  replacement?: DurablePermissionReplacementBehavior;
  turnApplied?: number;
  expiresAtTurn?: number;
  metadata?: Record<string, unknown>;
  debug?: DurablePermissionDebugEvidence;
}

/* Game state authoritative snapshot */
export interface GameState {
  id: GameID;
  format: GameFormat | string;
  players: PlayerRef[];
  startingLife: number;
  life: LifeTotals;
  turnPlayer: PlayerID;
  priority: PlayerID;
  turnDirection?: 1 | -1;
  stack: StackItem[];
  battlefield: BattlefieldPermanent[];
  commandZone: Record<PlayerID, CommanderInfo>;
  phase: GamePhase;
  step?: GameStep;
  active: boolean;
  zones?: Record<PlayerID, PlayerZones>;
  status?: string;
  turnOrder?: PlayerID[];
  startedAt?: number;
  turn?: number;
  turnNumber?: number; // Current turn number (incremented each turn)
  activePlayerIndex?: number;
  landsPlayedThisTurn?: Record<PlayerID, number>;
  lifeGainedThisTurn?: Record<PlayerID, number>;
  lifeLostThisTurn?: Record<PlayerID, number>;
  permanentsSacrificedThisTurn?: Record<PlayerID, number>;
  lastDieRollByPlayer?: Record<PlayerID, number | { sides?: number; result: number; timestamp?: number }>;
  turnStartBattlefieldSnapshot?: BattlefieldPermanent[];
  turnStartHandSnapshot?: Record<PlayerID, string[]>;
  // AI mana retention taps tracking - prevents infinite loops
  aiManaRetentionTaps?: Record<PlayerID, number>;
  // Special game designations (Rules 724-730)
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  schemeDeck?: any[];
  ongoingSchemes?: any[];
  planarDeck?: any[];
  planarDeckFaceDown?: any[];
  currentPlane?: any | null;
  planeswalkedThisTurn?: boolean;
  planeswalksAttempted?: number;
  planeswalkedToThisTurn?: Record<PlayerID, string[]>;
  planeswalkedToPlanesThisTurn?: Record<PlayerID, string[]>;
  regenerationShields?: Array<{
    id: string;
    permanentId: string;
    controllerId: string;
    createdAt: number;
    isUsed: boolean;
    expiresAtEndOfTurn: boolean;
  }>;
  futureSpellEffects?: FutureSpellEffect[];
  dungeonProgress?: Record<PlayerID, {
    dungeonId: string;
    dungeonName: string;
    roomIndex: number;
    roomId?: string;
  }>;
  dungeonCompletedThisTurn?: Record<PlayerID, boolean>;
  dungeonCompleted?: Record<PlayerID, boolean>;
  completedDungeons?: Record<PlayerID, number>;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
  /** CR 702.179: players have no speed until an effect or Start Your Engines! gives it to them. */
  speed?: Record<PlayerID, number>;
  /** CR 702.179d's inherent trigger can fire at most once each turn for each player. */
  speedIncreasedThisTurn?: Record<PlayerID, boolean>;
  /** CR 702.195: permanent player designation granted by Storied. */
  enduringStory?: Record<PlayerID, boolean>;
  /** CR 702.177a: each Exhaust ability may be activated only once per turn. */
  exhaustAbilitiesActivatedThisTurn?: Record<string, boolean>;
  // Mana pool for each player
  manaPool?: Record<PlayerID, ManaPool>;
  // Combat state
  combat?: CombatInfo;
  // Pending targets for spells/abilities
  pendingTargets?: any;
  // Creature type choices (Morophon, etc.) - can be string for global or Record for per-permanent
  morophonChosenType?: string | Record<string, string>;
  // Allow undos flag
  allowUndos?: boolean;
  // Creation timestamp
  createdAt?: number;
  // Last action timestamp
  lastActionAt?: number;
  // Commander damage tracking
  commanderDamage?: Record<PlayerID, Record<PlayerID, number>>;
  // Turn timer settings
  turnTimerEnabled?: boolean;
  turnTimerSeconds?: number;
  // Player protection effects (Teferi's Protection, etc.)
  playerProtection?: Record<PlayerID, PlayerProtectionState>;
  // Poison counters tracking
  poisonCounters?: Record<PlayerID, number>;
  // Spectators list
  spectators?: readonly PlayerRef[];
  // Rules engine compatibility
  winner?: PlayerID | null;
  priorityPlayerIndex?: number;
  // House rules configuration (optional game variants)
  houseRules?: HouseRules;
  // Trigger shortcut preferences per player (for Smothering Tithe, Rhystic Study, etc.)
  triggerShortcuts?: Record<PlayerID, TriggerShortcut[]>;
  /**
   * Pending damage triggers awaiting target selection (Brash Taunter, etc.)
   */
  pendingDamageTriggers?: Record<string, {
    sourceId: string;
    sourceName: string;
    controller: PlayerID;
    damageAmount: number;
    triggerType: string;
    targetType?: 'opponent' | 'any' | 'each_opponent' | 'any_non_dragon' | 'controller' | 'chosen_player' | 'opponent_or_planeswalker' | 'none';
    targetRestriction?: string;
    effect?: string;
    effectMode?: 'gain_life' | 'gain_life_and_attacking_player_loses_life';
    attackingPlayerId?: PlayerID;
  }>;
  /**
   * Pending attack triggers awaiting player's mana payment decision.
   * Maps trigger ID to trigger details (e.g., Casal's transform on attack).
   */
  pendingAttackTriggers?: Record<string, {
    permanentId: string;
    cardName: string;
    effect?: string;
    manaCost?: string;
    controller: string;
    description: string;
  }>;
  /**
   * Tracks noncreature spells cast per player per turn.
   * Used for triggers like Esper Sentinel that care about "first noncreature spell each turn".
   * Reset at the start of each turn.
   */
  noncreatureSpellsCastThisTurn?: Record<PlayerID, number>;
  /**
   * Tracks spells cast this turn.
   * Used for Storm count and templates like "if N or more spells were cast this turn".
   * Reset at the start of each turn.
   */
  spellsCastThisTurn?: any[];
  /**
   * Tracks spells cast from hand per player per turn.
   * Used by some intervening-if templates like "if you haven't cast a spell from your hand this turn".
   * Reset at the start of each turn.
   */
  spellsCastFromHandThisTurn?: Record<PlayerID, number>;
  /** Pending library search prompts keyed by player */
  /**
   * Control change effects for temporary "gain control" effects.
   * Tracks which permanents have had their controller changed and need cleanup.
   */
  controlChangeEffects?: Array<{
    permanentId: string;
    originalController: PlayerID;
    newController: PlayerID;
    duration: string;
    appliedAt: number;
  }>;
  /**
   * Pending move counter activations awaiting source/destination selection.
   * Maps activation ID to activation details.
   * Used for Nesting Grounds and similar abilities.
   */
  pendingMoveCounterActivations?: Record<string, {
    playerId: PlayerID;
    sourceId: string;
    sourceName: string;
    step: 'select_source' | 'select_destination';
    sourcePermId?: string;
    counterType?: string;
  }>;
  /**
   * Pending proliferate activations awaiting target selection.
   * Array of proliferate effects waiting for player to choose permanents/players with counters.
   */
  pendingProliferate?: Array<{
    id: string;
    controller: PlayerID;
    sourceName: string;
    imageUrl?: string;
  }>;
  /**
   * Per-player "you may" auto-decision preferences.
   * Key format: "{sourceName_lower}:{effectText_lower}".
   * 'yes'    → always auto-execute
   * 'no'     → always auto-skip
   * number>0 → countdown: auto-execute that many more times, then delete
   * 'no_until_targets:<fingerprint>' → auto-skip while legal targets unchanged
   */
  mayAutoPreferences?: Record<PlayerID, Record<string, 'yes' | 'no' | number | string>>;
  /**
   * Recent structured Oracle automation gaps saved for debugging and follow-up
   * parser/executor improvements. This is capped by the rules engine to avoid
   * unbounded growth in long-running games.
   */
  oracleAutomationGaps?: readonly OracleAutomationGap[];
  /** Temporary source-based damage prevention effects such as Mourner's Shield. */
  damagePreventionEffects?: readonly DamagePreventionEffect[];
  /** Queued extra turns waiting to be taken. Most recently created turns are consumed first. */
  extraTurns?: readonly ExtraTurnEffect[];
  /** One-shot "skip your next turn" effects waiting to be consumed. */
  skipNextTurnEffects?: readonly SkipNextTurnEffect[];
  /** One-shot "skip your next draw step" effects waiting to be consumed. */
  skipNextDrawStepEffects?: readonly SkipNextDrawStepEffect[];
  /** Durable action permissions used to unify cast/play/activate/spend exceptions. */
  durablePermissions?: readonly DurablePermission[];
}

/* Player protection state for effects like Teferi's Protection */
export interface PlayerProtectionState {
  teferisProtection?: boolean;
  lifeCannotChange?: boolean;
  protectionFromEverything?: boolean;
  expiresAtCleanup?: boolean;
}

/* Client-scoped game view (lightweight diff of authoritative state) */
export type ClientGameView = Omit<GameState, 'battlefield' | 'stack' | 'players' | 'zones'> & {
  battlefield: BattlefieldPermanent[];
  stack: StackItem[];
  players: PlayerRef[];
  zones?: Record<PlayerID, PlayerZones>;
  spectators?: readonly PlayerRef[];
  commandZone?: Record<PlayerID, CommanderInfo>;
  poisonCounters?: Record<PlayerID, number>;
  experienceCounters?: Record<PlayerID, number>;
  // Combat state for display
  combat?: CombatInfo;
  // Special game designations for display
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
  /** Pending commander zone choice - when a commander would change zones */
  pendingCommanderZoneChoice?: PendingCommanderZoneChoice[];
  /** The player ID viewing this game state (used by server to calculate playable card highlighting) */
  viewer?: PlayerID;
  costAdjustments?: Record<string, CardCostAdjustment>;
};

/** Pending commander zone choice (Rule 903.9a/903.9b) */
export interface PendingCommanderZoneChoice {
  commanderId: string;
  commanderName: string;
  destinationZone: 'graveyard' | 'exile' | 'library' | 'hand';
  playerId?: string; // Owner who needs to make the choice
  libraryPosition?: 'top' | 'bottom' | 'shuffle'; // For library zone - where it would go
  card: {
    id: string;
    name: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: Record<string, string>;
    mana_cost?: string;
    power?: string;
    toughness?: string;
  };
}

/* Combat information for display purposes */
export interface CombatInfo {
  phase: 'declareAttackers' | 'declareBlockers' | 'combatDamage' | 'endCombat';
  attackers: readonly CombatantInfo[];
  blockers: readonly CombatantInfo[];
  /**
   * Combat control effects (Master Warcraft, Odric, Master Tactician)
   * When set, this player chooses which creatures attack/block instead of their controllers
   */
  combatControl?: CombatControlEffect;
}

/**
 * Combat control effect for cards like Master Warcraft and Odric, Master Tactician
 * These effects allow a player to choose which creatures attack and/or block during combat.
 * 
 * Rules Reference:
 * - Master Warcraft: "Cast this spell only before attackers are declared. 
 *   You choose which creatures attack this turn. You choose which creatures block this turn 
 *   and how those creatures block."
 * - Odric, Master Tactician: "Whenever Odric, Master Tactician and at least three other 
 *   creatures attack, you choose which creatures block this combat and how those creatures block."
 */
export interface CombatControlEffect {
  /** Player who controls the combat decisions */
  controllerId: PlayerID;
  /** Source permanent/spell that granted this effect */
  sourceId: string;
  /** Name of the source for display purposes */
  sourceName: string;
  /** Whether this effect controls attacker declarations */
  controlsAttackers: boolean;
  /** Whether this effect controls blocker declarations */
  controlsBlockers: boolean;
  /** 
   * For mandatory attackers: IDs of creatures that MUST attack 
   * (empty means controller can choose freely)
   */
  mandatoryAttackers?: readonly string[];
  /**
   * For mandatory blockers: map of attacker ID -> blocker IDs that MUST block it
   * (empty means controller can choose freely)
   */
  mandatoryBlockers?: Readonly<Record<string, readonly string[]>>;
  /** Creatures that are prevented from attacking (if controlled by another player) */
  preventedAttackers?: readonly string[];
  /** Creatures that are prevented from blocking (if controlled by another player) */
  preventedBlockers?: readonly string[];
}

/* Combatant info for UI display */
export interface CombatantInfo {
  permanentId: string;
  name?: string;
  defending?: PlayerID;           // For attackers: who they're attacking
  blocking?: readonly string[];   // For blockers: what they're blocking
  blockedBy?: readonly string[];  // For attackers: what's blocking them
  damage?: number;                // Damage assigned
}

export interface StateDiff<T> {
  full?: T;
  patch?: Partial<T>;
  seq: number;
}

export type { ManaRestrictionType, RestrictedManaEntry, ManaPool } from './types-handlers/manaPoolTypes.js';


/* Payment item for mana payment during spell casting */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export type CostAdjustmentKind = 'increase' | 'reduction' | 'mixed';

export interface CostAdjustmentMessageSource {
  kind: 'increase' | 'reduction';
  message: string;
}

export interface PaymentCostAdjustment {
  originalManaCost: string;
  adjustedManaCost: string;
  genericReduction: number;
  coloredReductions: Record<string, number>;
  genericTax: number;
  reductionMessages: string[];
  taxMessages: string[];
  sources: CostAdjustmentMessageSource[];
  kind: CostAdjustmentKind;
}

export interface CardCostAdjustment {
  originalCost: string;
  adjustedCost: string;
  adjustment: number;
  genericAdjustment?: number;
  sources: string[];
  isIncrease?: boolean;
}

export interface PaymentItem {
  permanentId: string;
  paymentSourceId?: string;
  mana: ManaColor;
  abilityId?: string;
  /** Exact mana symbols produced by this selected source, preserving fixed mixed bundles like {U}{R}. */
  producedColors?: ManaColor[];
  /** Number of mana produced by this tap (default 1, e.g., Sol Ring produces 2) */
  count?: number;
  /** Permanents sacrificed to pay a mana ability activation cost. */
  sacrificedPermanentIds?: string[];
  /** If using restricted mana from pool, the restriction index */
  fromRestrictedPool?: boolean;
  /** Index into the restricted mana array */
  restrictedIndex?: number;
}

/**
 * Type for mana pool payment - can be from tapping a permanent or from floating mana
 */
export interface ManaPoolPaymentItem {
  /** Color of mana being used */
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  /** Amount of mana being used */
  amount: number;
  /** If from restricted pool, include the restriction info */
  fromRestricted?: boolean;
  /** Restriction index if from restricted mana */
  restrictedIndex?: number;
}

/* Game action types for socket communication */
export enum GameActionType {
  CAST_SPELL = 'castSpell',
  ACTIVATE_ABILITY = 'activateAbility',
  DECLARE_ATTACKERS = 'declareAttackers',
  DECLARE_BLOCKERS = 'declareBlockers',
  PASS_PRIORITY = 'passPriority',
  MULLIGAN = 'mulligan',
  PLAY_LAND = 'playLand',
  DISCARD = 'discard',
  SACRIFICE = 'sacrifice',
}

export interface GameAction {
  type: GameActionType;
  gameId: string;
  playerId: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

/* Automation error reporting */
export interface AutomationErrorReport {
  id: string;
  gameId: string;
  playerId: string;
  reportedAt: number;
  actionType?: string;
  cardInvolved?: string;
  description: string;
  expectedBehavior: string;
  gameState: Partial<GameState>;
  rulesReferences?: string[];
  status: 'pending' | 'reviewing' | 'fixed' | 'wont-fix' | 'invalid';
  resolution?: string;
  fixedInVersion?: string;
}

/* Target reference for spells and abilities */
export type TargetRef = 
  | { kind: 'permanent'; id: string }
  | { kind: 'player'; id: string }
  | { kind: 'card'; id: string; zone: string }
  | { kind: 'stack'; id: string };  // For targeting spells/abilities on the stack (counterspells)

/* In-memory game type for server */
export interface InMemoryGame {
  id: GameID;
  state: GameState;
  players: Map<PlayerID, PlayerRef>;
  createdAt: number;
  lastActivity: number;
}

/**
 * Trigger shortcut preference for optional triggered abilities.
 * Allows players to set automatic responses for "may" triggers and 
 * "opponent may pay" triggers to speed up gameplay.
 * 
 * Examples:
 * - Smothering Tithe: opponent can set "never pay" to skip the prompt
 * - Rhystic Study: opponent can set "never pay" to always decline
 * - Soul Warden: controller can set "always yes" to auto-trigger life gain
 */
export type TriggerShortcutType = 
  | 'always_pay'      // Always pay the cost (for opponent-pays triggers)
  | 'never_pay'       // Never pay the cost (for opponent-pays triggers)
  | 'always_yes'      // Always choose "yes" for may abilities
  | 'always_no'       // Always choose "no" for may abilities
  | 'always_resolve'  // Always auto-resolve mandatory triggers without prompting (Soul Warden, etc.)
  | 'ask_each_time';  // Default: prompt each time

export type TriggerShortcutEligibilityType = 'opponent_pays' | 'may_ability' | 'mandatory';

export const TRIGGER_SHORTCUT_PREFERENCES: readonly TriggerShortcutType[] = [
  'always_pay',
  'never_pay',
  'always_yes',
  'always_no',
  'always_resolve',
  'ask_each_time',
] as const;

export const TRIGGER_SHORTCUT_PREFERENCE_LABELS: Record<TriggerShortcutType, string> = {
  always_pay: 'Always Pay',
  never_pay: 'Never Pay',
  always_yes: 'Always Yes',
  always_no: 'Always No',
  always_resolve: 'Always Resolve',
  ask_each_time: 'Ask Each Time',
};

export const TRIGGER_SHORTCUT_OPTIONS_BY_TYPE: Record<TriggerShortcutEligibilityType, readonly TriggerShortcutType[]> = {
  opponent_pays: ['ask_each_time', 'always_pay', 'never_pay'],
  may_ability: ['ask_each_time', 'always_yes', 'always_no'],
  mandatory: ['ask_each_time', 'always_resolve'],
} as const;

export function isTriggerShortcutType(value: unknown): value is TriggerShortcutType {
  return typeof value === 'string' && (TRIGGER_SHORTCUT_PREFERENCES as readonly string[]).includes(value);
}

export function getTriggerShortcutOptionsForType(type: TriggerShortcutEligibilityType): readonly TriggerShortcutType[] {
  return TRIGGER_SHORTCUT_OPTIONS_BY_TYPE[type] || ['ask_each_time'];
}

export function isTriggerShortcutPreferenceAllowed(
  type: TriggerShortcutEligibilityType,
  preference: unknown
): preference is TriggerShortcutType {
  return isTriggerShortcutType(preference)
    && getTriggerShortcutOptionsForType(type).includes(preference);
}

/**
 * A saved trigger shortcut preference for a specific card/effect.
 */
export interface TriggerShortcut {
  /** Card name that has the trigger (normalized to lowercase) */
  cardName: string;
  /** The player who set this preference */
  playerId: PlayerID;
  /** The preference for this trigger */
  preference: TriggerShortcutType;
  /** Optional: specific trigger description if card has multiple triggers */
  triggerDescription?: string;
}

/**
 * Known triggers that support shortcuts.
 * Maps card names to their trigger type for UI display.
 */
export const SHORTCUT_ELIGIBLE_TRIGGERS: Record<string, {
  description: string;
  type: TriggerShortcutEligibilityType;
  defaultPreference: TriggerShortcutType;
}> = {
  'smothering tithe': {
    description: 'Pay {2} or controller creates a Treasure',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'rhystic study': {
    description: 'Pay {1} or controller draws a card',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'mystic remora': {
    description: 'Pay {4} or controller draws a card',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'esper sentinel': {
    description: 'Pay {X} or controller draws a card',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'propaganda': {
    description: 'Pay {2} per creature to attack',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'ghostly prison': {
    description: 'Pay {2} per creature to attack',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'sphere of safety': {
    description: 'Pay {X} per creature to attack (X = enchantments)',
    type: 'opponent_pays',
    defaultPreference: 'ask_each_time'
  },
  'soul warden': {
    description: 'Gain 1 life when another creature enters',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  "soul's attendant": {
    description: 'You may gain 1 life when another creature enters',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'judge of currents': {
    description: 'You may gain 1 life when a Merfolk you control becomes tapped',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'fallowsage': {
    description: 'You may draw a card when it becomes tapped',
    type: 'may_ability',
    defaultPreference: 'ask_each_time'
  },
  'curiosity': {
    description: 'You may draw a card when enchanted creature deals damage to a player',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'keen sense': {
    description: 'You may draw a card when enchanted creature deals damage to a player',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'snake umbra': {
    description: 'You may draw a card when enchanted creature deals damage to a player',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'sixth sense': {
    description: 'You may draw a card when enchanted creature deals combat damage to a player',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'curious obsession': {
    description: 'You may draw a card when enchanted creature deals damage to an opponent',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'ophidian eye': {
    description: 'You may draw a card when enchanted creature deals damage to an opponent',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'essence warden': {
    description: 'Gain 1 life when another creature enters',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'suture priest': {
    description: 'Gain 1 life when a creature enters under your control',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'ajani\'s welcome': {
    description: 'Gain 1 life when a creature enters under your control',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'impassioned orator': {
    description: 'Gain 1 life when a creature enters under your control',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'auriok champion': {
    description: 'You may gain 1 life when a creature enters',
    type: 'may_ability',
    defaultPreference: 'always_yes'
  },
  'altar of the brood': {
    description: 'Each opponent mills 1 when a permanent enters',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'impact tremors': {
    description: 'Deal 1 damage to each opponent when a creature enters',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  },
  'purphoros, god of the forge': {
    description: 'Deal 2 damage to each opponent when a creature enters',
    type: 'mandatory',
    defaultPreference: 'always_resolve'
  }
};
