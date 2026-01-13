// shared/src/types.ts
// Canonical shared types and enums used by client and server.
// Full expanded version, merged with PRE_GAME support.

export type GameID = string;
export type PlayerID = string;
export type SeatIndex = number;

export type GameFormat = 'commander' | 'standard' | 'modern' | 'vintage' | 'legacy' | 'pauper' | 'custom';

/* Image URIs used by Scryfall */
export interface ImageUris {
  small?: string;
  normal?: string;
  art_crop?: string;
}

/* Card face for double-faced/transform/split cards */
export interface CardFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  power?: string;
  toughness?: string;
  loyalty?: string; // For MDFC planeswalkers
}

/* Known card shape (non-secret) */
export interface KnownCardRef {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  mana_cost?: string;
  power?: string | number;
  toughness?: string | number;
  loyalty?: string | number; // for planeswalkers - starting loyalty value
  zone?: string;
  faceDown?: boolean;
  knownTo?: PlayerID[]; // who knows the card face/identity
  card_faces?: CardFace[]; // for double-faced/transform/split cards
  layout?: string; // card layout type (e.g., 'transform', 'modal_dfc', 'split')
  colors?: readonly string[]; // color identifiers ('W', 'U', 'B', 'R', 'G')
  cmc?: number; // converted mana cost
}

/* Hidden card representation for face-down and private zones */
export interface HiddenCardRef {
  id: string;
  faceDown: true;
  zone: 'battlefield' | 'exile' | 'stack' | 'library' | 'hand' | 'graveyard' | 'command';
  visibility: 'owner' | 'controller' | 'public' | 'none';
  // Optional properties for compatibility with KnownCardRef (when card is revealed)
  name?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  mana_cost?: string;
  power?: string | number;
  toughness?: string | number;
  loyalty?: string | number; // for planeswalkers - starting loyalty value
}

/* Generic CardRef used across the app */
export type CardRef = KnownCardRef | HiddenCardRef;

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
  // battlefield removed - use state.battlefield filtered by controller
  exile?: any[];
  commandZone?: any[];
  counters?: Record<string, number>;
  hasLost?: boolean;
  lostReason?: string; // Reason why player lost (e.g., "Life total reached 0 or less")
  commanderDamage?: Record<string, number>;
  manaPool?: ManaPool;
}

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
  }>;
  /** Which commander IDs are currently in the command zone (not on stack/battlefield) */
  inCommandZone?: readonly string[];
}

/* Modifier applied to a permanent (power/toughness, abilities, etc.) */
export interface PermanentModifier {
  readonly type: 'powerToughness' | 'POWER_TOUGHNESS' | 'ability' | 'ABILITY' | string;
  readonly power?: number;
  readonly toughness?: number;
  readonly ability?: string;
  readonly sourceId?: string;
  readonly duration?: 'permanent' | 'end_of_turn' | 'end_of_combat';
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
  tapped?: boolean;
  counters?: Readonly<Record<string, number>>;
  basePower?: number;
  baseToughness?: number;
  attachedTo?: string;
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
  // Phasing support
  phasedOut?: boolean;
  phaseOutController?: PlayerID;
  // Teferi's Protection and similar effects
  teferisProtection?: boolean;
  // Echo paid tracking
  echoPaid?: boolean;
  // Token flag
  isToken?: boolean;
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
  // Mutate support (Rule 702.140)
  mutatedStack?: MutatedCardStack;  // Stack of cards in a mutated creature (presence indicates mutation)
  mutationCount?: number;           // Number of times this creature has been mutated
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
  sourceId?: string;             // ID of the permanent/spell that created this effect
  sourceName?: string;           // Name of the source
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
  // AI mana retention taps tracking - prevents infinite loops
  aiManaRetentionTaps?: Record<PlayerID, number>;
  // Special game designations (Rules 724-730)
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
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
   * Pending "any color" mana activations awaiting player color choice.
   * Maps activation ID to activation details.
   * Populated when a player taps a permanent that produces "any color" mana.
   * Cleaned up when the player confirms their color choice or cancels.
   */
  pendingManaActivations?: Record<string, {
    playerId: PlayerID;
    permanentId: string;
    cardName: string;
    amount: number;
    allowedColors?: string[]; // Optional array of allowed color codes (e.g., ['W', 'U'])
  }>;
  /**
   * Pending fight activations awaiting target selection.
   */
  pendingFightActivations?: Record<string, {
    playerId: PlayerID;
    sourceId: string;
    sourceName?: string;
    controller?: 'opponent' | 'any' | 'you';
  }>;
  /**
   * Pending damage triggers awaiting target selection (Brash Taunter, etc.)
   */
  pendingDamageTriggers?: Record<string, {
    sourceId: string;
    sourceName: string;
    controller: PlayerID;
    damageAmount: number;
    triggerType: string;
    targetType?: 'opponent' | 'any' | 'each_opponent' | 'any_non_dragon' | 'controller';
    targetRestriction?: string;
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
  /** Pending library search prompts keyed by player */
  /**
   * Pending tap/untap activations for permanents with tap abilities.
   */
  pendingTapUntapActivations?: Record<string, any>;
  /**
   * Pending counter movements between permanents.
   */
  pendingCounterMovements?: Record<string, any>;
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
   * Pending control change activations awaiting opponent selection.
   * Maps activation ID to activation details.
   * Used for Humble Defector-style activated abilities and Xantcha-style ETB effects.
   */
  pendingControlChangeActivations?: Record<string, {
    playerId: PlayerID;
    permanentId: string;
    cardName: string;
    drawCards?: number;
    // ETB control change fields
    type?: 'enters_under_opponent_control' | 'may_give_opponent' | 'opponent_gains';
    isOptional?: boolean;
    goadsOnChange?: boolean;
    mustAttackEachCombat?: boolean;
    cantAttackOwner?: boolean;
  }>;
  /**
   * Pending counter-adding activations awaiting target selection.
   * Maps activation ID to activation details.
   * Used for Gwafa Hazid, Immaculate Magistrate, Sage of Fables, etc.
   */
  pendingCounterActivations?: Record<string, {
    playerId: PlayerID;
    sourceId: string;
    sourceName: string;
    counterType: string;
    targetController?: 'opponent' | 'any' | 'you';
    oracleText?: string;
    scalingText?: string | null;
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
   * Firebending mana tracking - tracks red mana from firebending that lasts until end of combat.
   * Maps playerId to amount of firebending red mana in their pool.
   */
  firebendingMana?: Record<PlayerID, number>;
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

/**
 * Mana restriction type - specifies how restricted mana can be spent
 * Rule 106.6: Some abilities produce mana that can be spent only on certain things
 */
export type ManaRestrictionType = 
  | 'creatures'           // Can only be spent on creatures (e.g., Beastcaller Savant)
  | 'abilities'           // Can only be spent on abilities (e.g., Metalworker with Training Grounds)
  | 'colorless_spells'    // Can only be spent on colorless spells (e.g., Eldrazi Temple)
  | 'artifacts'           // Can only be spent on artifacts
  | 'legendary'           // Can only be spent on legendary spells (e.g., Reki, History of Kamigawa)
  | 'multicolored'        // Can only be spent on multicolored spells
  | 'commander'           // Can only be spent on commander costs (e.g., Command Tower in some interpretations)
  | 'activated_abilities' // Can only be spent to activate abilities of a specific permanent type
  | 'instant_sorcery'     // Can only be spent on instants and sorceries
  | 'specific_card';      // Can only be spent on a specific card or permanent (stored in restrictedTo)

/**
 * Represents a single unit of restricted mana in the mana pool
 * Rule 106.6: Some effects produce mana with restrictions on what it can be spent on
 */
export interface RestrictedManaEntry {
  /** The type of the mana (primary field for identifying the mana color) */
  type: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  /** Amount of mana with this restriction */
  amount: number;
  /** Type of restriction on this mana */
  restriction: ManaRestrictionType;
  /** Optional: specific card/permanent ID this mana can be spent on */
  restrictedTo?: string;
  /** Source permanent that produced this mana (for tracking) */
  sourceId?: string;
  /** Source permanent name (for display) */
  sourceName?: string;
}

/**
 * Enhanced mana pool for a player - supports both regular and restricted mana
 * 
 * Rule 106.4: A player's mana pool is where mana is stored.
 * Rule 106.6: Some mana can only be spent in specific ways.
 * Rule 106.4a: If unused mana remains in a player's mana pool after mana is spent to pay
 * a cost, that player announces what mana is left. If unused mana remains in a player's 
 * mana pool at the end of a step or phase, that mana empties (unless the player has an 
 * effect preventing it, like Horizon Stone or Omnath, Locus of Mana).
 */
export interface ManaPool {
  /** Regular unrestricted mana counts */
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  generic?: number;
  
  /** 
   * Restricted mana entries - mana that can only be spent on specific things
   * Each entry represents mana with a specific restriction type
   * Readonly to match rules-engine types
   */
  readonly restricted?: readonly RestrictedManaEntry[];
  
  /**
   * Flag indicating this player's mana pool doesn't empty at end of phases/steps
   * Set by effects like Horizon Stone, Omnath Locus of Mana, Kruphix God of Horizons
   */
  readonly doesNotEmpty?: boolean;
  
  /**
   * If mana doesn't empty but converts to a specific color, specify that color
   * Examples:
   * - 'colorless' for Kruphix, God of Horizons and Horizon Stone
   * - 'black' for Omnath, Locus of All
   * - 'red' for Ozai, the Phoenix King
   * If undefined and doesNotEmpty is true, mana is preserved as-is
   */
  readonly convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  
  /**
   * @deprecated Use convertsTo instead. Kept for backwards compatibility.
   * If mana doesn't empty but converts to colorless, specify that transformation
   */
  readonly convertsToColorless?: boolean;
  
  /**
   * Source permanent(s) providing the "doesn't empty" effect
   * Used to track when the effect should be removed
   */
  readonly noEmptySourceIds?: readonly string[];
}

/* Payment item for mana payment during spell casting */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export interface PaymentItem {
  permanentId: string;
  mana: ManaColor;
  /** Number of mana produced by this tap (default 1, e.g., Sol Ring produces 2) */
  count?: number;
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
  type: 'opponent_pays' | 'may_ability' | 'mandatory';
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
