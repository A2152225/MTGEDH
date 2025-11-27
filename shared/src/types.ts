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
  battlefield?: any[];
  exile?: any[];
  commandZone?: any[];
  counters?: Record<string, number>;
  hasLost?: boolean;
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
  battlefield?: any[];
  exile?: any[];
  manaPool?: any;
}

/* Player status for counter tracking and protection effects */
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
  isCommander?: boolean;
  grantedAbilities?: string[];
  posX?: number;
  posY?: number;
  posZ?: number;
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
}

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
  type: 'spell' | 'ability';
  controller: PlayerID;
  card?: CardRef;
  targets?: readonly string[];
  // Target details with type information for visual display
  targetDetails?: readonly TargetInfo[];
}

/* Target information for display purposes */
export interface TargetInfo {
  id: string;
  type: 'permanent' | 'player' | 'spell' | 'ability';
  name?: string;
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
  activePlayerIndex?: number;
  landsPlayedThisTurn?: Record<PlayerID, number>;
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
};

/* Combat information for display purposes */
export interface CombatInfo {
  phase: 'declareAttackers' | 'declareBlockers' | 'combatDamage' | 'endCombat';
  attackers: readonly CombatantInfo[];
  blockers: readonly CombatantInfo[];
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

/* Mana pool for a player */
export interface ManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  generic?: number;
}

/* Payment item for mana payment during spell casting */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export interface PaymentItem {
  permanentId: string;
  mana: ManaColor;
  /** Number of mana produced by this tap (default 1, e.g., Sol Ring produces 2) */
  count?: number;
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
  | { kind: 'card'; id: string; zone: string };

/* In-memory game type for server */
export interface InMemoryGame {
  id: GameID;
  state: GameState;
  players: Map<PlayerID, PlayerRef>;
  createdAt: number;
  lastActivity: number;
}