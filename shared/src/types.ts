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
}

/* Hidden card representation for face-down and private zones */
export interface HiddenCardRef {
  id: string;
  faceDown: true;
  zone: 'battlefield' | 'exile' | 'stack' | 'library' | 'hand' | 'graveyard' | 'command';
  visibility: 'owner' | 'controller' | 'public' | 'none';
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
  }>;
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
  effectivePower?: number;
  effectiveToughness?: number;
  isCommander?: boolean;
  grantedAbilities?: string[];
  posX?: number;
  posY?: number;
  posZ?: number;
  card: CardRef;
  // Untap prevention metadata
  stunCounters?: number;
  doesNotUntapNext?: boolean;
  doesNotUntapDuringUntapStep?: boolean;
}

/* Stack item */
export interface StackItem {
  id: string;
  type: 'spell' | 'ability';
  controller: PlayerID;
  card?: CardRef;
  targets?: readonly string[];
}

/* Life totals mapping */
export interface LifeTotals {
  [playerId: PlayerID]: number;
}

/* Mana pool type */
export interface ManaPool {
  W: number; // White
  U: number; // Blue
  B: number; // Black
  R: number; // Red
  G: number; // Green
  C: number; // Colorless
  generic: number; // Generic mana (any color or colorless)
}

/* Mana cost representation */
export interface ManaCost {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  generic: number; // Generic mana ({1}, {2}, etc.)
}

/* Game phase enum (expanded to include PRE_GAME) */
export enum GamePhase {
  PRE_GAME = "pre_game",
  BEGINNING = "pre_game", // alias kept for backward compatibility (treated as PRE_GAME)
  UNTAP = "untap",
  UPKEEP = "upkeep",
  DRAW = "draw",
  FIRSTMAIN = "first_main",
  COMBAT = "combat",
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
  MAIN2 = 'MAIN2'
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
  manaPools?: Record<PlayerID, ManaPool>;
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
  manaPools?: Record<PlayerID, ManaPool>;
};

export interface StateDiff<T> {
  full?: T;
  patch?: Partial<T>;
  seq: number;
}