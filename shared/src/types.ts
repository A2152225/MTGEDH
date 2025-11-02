// Core identifiers
export type GameID = string;
export type PlayerID = string;
export type SeatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Canonical formats; keep enum to allow value usage (e.g., GameFormat.COMMANDER)
export enum GameFormat {
  COMMANDER = "COMMANDER",
  STANDARD = "STANDARD",
  MODERN = "MODERN",
  VINTAGE = "VINTAGE",
  LEGACY = "LEGACY",
  PAUPER = "PAUPER",
  CUSTOM = "CUSTOM"
}

// Back-compat alias
export type Format = `${GameFormat}`;

// Player references visible to clients
export interface PlayerRef {
  id: PlayerID;
  name: string;
  seat: SeatIndex;
  isSpectator?: boolean;
}

// Server-side richer player shape (superset; still safe for client views)
export interface Player extends PlayerRef {
  socketId?: string;
  connected?: boolean;
  library?: string[]; // card ids
  hand?: string[]; // card ids
  graveyard?: string[]; // card ids
  life?: number;
  hasPriority?: boolean;
  startingLife?: number;
}

// Visibility model
export type Visibility = "owner" | "controller" | "public" | "none";

export interface HiddenCardRef {
  id: string; // opaque id
  faceDown: true;
  zone: "battlefield" | "exile" | "stack" | "library" | "hand" | "graveyard" | "command";
  visibility: Visibility;
}

export interface KnownCardRef {
  id: string;
  name: string;
  oracle_id?: string;
  cmc?: number;
  mana_cost?: string;
  zone: HiddenCardRef["zone"];
  faceDown?: false;
}

export type CardRef = HiddenCardRef | KnownCardRef;

export interface LifeTotals {
  [playerId: PlayerID]: number;
}

export interface CommanderInfo {
  commanderIds: readonly string[];
  tax: number; // total extra generic cost applied
}

export interface BattlefieldPermanent {
  id: string;
  controller: PlayerID;
  owner: PlayerID;
  tapped: boolean;
  counters?: Readonly<Record<string, number>>;
  card: CardRef; // may be face-down
}

export interface StackItem {
  id: string;
  type: "spell" | "ability";
  controller: PlayerID;
  card?: CardRef; // spells have card, abilities may not
  targets?: readonly string[];
}

// Phases/steps as enums to allow value usage in code
export enum GamePhase {
  BEGINNING = "BEGINNING",
  PRECOMBAT_MAIN = "PRECOMBAT_MAIN",
  COMBAT = "COMBAT",
  POSTCOMBAT_MAIN = "POSTCOMBAT_MAIN",
  END = "END"
}

export enum GameStep {
  UNTAP = "UNTAP",
  UPKEEP = "UPKEEP",
  DRAW = "DRAW",
  MAIN1 = "MAIN1",
  BEGIN_COMBAT = "BEGIN_COMBAT",
  DECLARE_ATTACKERS = "DECLARE_ATTACKERS",
  DECLARE_BLOCKERS = "DECLARE_BLOCKERS",
  DAMAGE = "DAMAGE",
  END_COMBAT = "END_COMBAT",
  MAIN2 = "MAIN2",
  END = "END",
  CLEANUP = "CLEANUP"
}

export enum GameStatus {
  WAITING = "WAITING",
  IN_PROGRESS = "IN_PROGRESS",
  FINISHED = "FINISHED"
}

// Player zones and counts (visibility-aware in filtered views)
export interface PlayerZones {
  hand: CardRef[];              // owner: cards; others: []
  handCount: number;            // everyone sees count
  libraryCount: number;         // everyone sees count
  graveyard: KnownCardRef[];    // owner/opponents: known info; others may receive only count in future
  graveyardCount: number;       // everyone sees count
  exile?: CardRef[];            // visible/hidden depending on effects (faceDown respected)
}

// Authoritative server state (mutable for server code)
export interface GameState {
  id: GameID;
  format: GameFormat | Format;
  players: Player[]; // server mutates this
  startingLife: number;
  life: LifeTotals;
  turnPlayer: PlayerID;
  priority: PlayerID;
  stack: StackItem[];
  battlefield: BattlefieldPermanent[];
  commandZone: Record<PlayerID, CommanderInfo>;
  phase: GamePhase;
  step?: GameStep;
  active: boolean;

  // Optional per-player zones; included when relevant
  zones?: Record<PlayerID, PlayerZones>;

  // Common server-side fields used by code
  status?: GameStatus;
  turnOrder?: PlayerID[];
  startedAt?: number;
  turn?: number;
  activePlayerIndex?: number;
}

// Client-scoped view (after visibility filtering)
export type ClientGameView = Omit<GameState, "battlefield" | "stack" | "players" | "zones"> & {
  battlefield: BattlefieldPermanent[];
  stack: StackItem[];
  players: PlayerRef[]; // clients get the narrow shape
  zones?: Record<PlayerID, PlayerZones>; // filtered/masked
};

// Diff envelope
export interface StateDiff<T> {
  full?: T;
  patch?: Partial<T>;
  seq: number;
}

// Actions and automation types (expanded for back-compat)
export type GameActionType = string;

export interface GameAction {
  id: string;
  type: GameActionType;
  actor: PlayerID;
  gameId: GameID;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export type AutomationStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export interface AutomationErrorReport {
  id?: string;
  gameId: GameID;
  reporter?: PlayerID;
  playerId?: PlayerID; // back-compat alias
  description: string;
  expectedBehavior?: string;
  actionType?: string;
  cardInvolved?: string;
  gameState?: unknown;
  rulesReferences?: string[];
  status?: AutomationStatus;
  reportedAt?: number;
  createdAt?: number;
}