// Core identifiers
export type GameID = string;
export type PlayerID = string;
export type SeatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Canonical formats
export enum GameFormat {
  COMMANDER = "COMMANDER",
  STANDARD = "STANDARD",
  MODERN = "MODERN",
  VINTAGE = "VINTAGE",
  LEGACY = "LEGACY",
  PAUPER = "PAUPER",
  CUSTOM = "CUSTOM",
}
export type Format = `${GameFormat}`;

// Player references visible to clients
export interface PlayerRef {
  id: PlayerID;
  name: string;
  seat: SeatIndex;
  isSpectator?: boolean;
  inactive?: boolean;
  eliminated?: boolean;
}

export interface SpectatorRef {
  id: PlayerID;
  name: string;
  hasAccessToYou?: boolean;
}

// Server-side richer player shape (not sent to clients verbatim)
export interface Player extends PlayerRef {
  socketId?: string;
  connected?: boolean;
  library?: string[];
  hand?: string[];
  graveyard?: string[];
  life?: number;
  hasPriority?: boolean;
  startingLife?: number;
}

// Visibility model
export type Visibility = "owner" | "controller" | "public" | "none";

export interface HiddenCardRef {
  id: string;
  faceDown: true;
  zone: "battlefield" | "exile" | "stack" | "library" | "hand" | "graveyard" | "command";
  visibility: Visibility;
}

// Scryfall image URIs
export interface ImageUris {
  small?: string;
  normal?: string;
  art_crop?: string;
}

// Visible card reference
export interface KnownCardRef {
  id: string;
  name: string;
  oracle_id?: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  zone: HiddenCardRef["zone"];
  faceDown?: false;
}

export type CardRef = HiddenCardRef | KnownCardRef;

export interface LifeTotals {
  [playerId: PlayerID]: number;
}

// Commander info per player
export interface CommanderInfo {
  commanderIds: readonly string[];
  commanderNames?: readonly string[];
  tax?: number; // aggregate
  taxById?: Readonly<Record<string, number>>;
}

// Battlefield permanent
export interface BattlefieldPermanent {
  id: string;
  controller: PlayerID;
  owner: PlayerID;
  tapped: boolean;
  counters?: Readonly<Record<string, number>>;
  basePower?: number;
  baseToughness?: number;
  attachedTo?: string; // aura/equipment attachments target permanent id
  card: CardRef;
}

// Stack item
export interface StackItem {
  id: string;
  type: "spell" | "ability";
  controller: PlayerID;
  card?: CardRef;
  targets?: readonly string[];
}

export enum GamePhase {
  BEGINNING = "BEGINNING",
  PRECOMBAT_MAIN = "PRECOMBAT_MAIN",
  COMBAT = "COMBAT",
  POSTCOMBAT_MAIN = "POSTCOMBAT_MAIN",
  END = "END",
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
  CLEANUP = "CLEANUP",
}
export enum GameStatus {
  WAITING = "WAITING",
  IN_PROGRESS = "IN_PROGRESS",
  FINISHED = "FINISHED",
}

// Player zones and counts
export interface PlayerZones {
  hand: CardRef[];
  handCount: number;
  libraryCount: number;
  graveyard: KnownCardRef[];
  graveyardCount: number;
  exile?: CardRef[];
}

// Authoritative server state
export interface GameState {
  id: GameID;
  format: GameFormat | Format;
  players: Player[];
  startingLife: number;
  life: LifeTotals;
  turnPlayer: PlayerID;
  priority: PlayerID;
  // +1 = clockwise, -1 = counter-clockwise
  turnDirection?: 1 | -1;
  stack: StackItem[];
  battlefield: BattlefieldPermanent[];
  commandZone: Record<PlayerID, CommanderInfo>;
  phase: GamePhase;
  step?: GameStep;
  active: boolean;
  zones?: Record<PlayerID, PlayerZones>;
  status?: GameStatus;
  turnOrder?: PlayerID[];
  startedAt?: number;
  turn?: number;
  activePlayerIndex?: number;
}

// Client-scoped view
export type ClientGameView = Omit<GameState, "battlefield" | "stack" | "players" | "zones"> & {
  battlefield: BattlefieldPermanent[];
  stack: StackItem[];
  players: PlayerRef[];
  zones?: Record<PlayerID, PlayerZones>;
  spectators?: readonly SpectatorRef[];
};

// Diff
export interface StateDiff<T> {
  full?: T;
  patch?: Partial<T>;
  seq: number;
}

// Target reference (server validates)
export type TargetRef =
  | { kind: 'player'; id: PlayerID }
  | { kind: 'permanent'; id: string }
  | { kind: 'stack'; id: string };

// Actions and automation
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
  playerId?: PlayerID;
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