// Core identifiers
export type GameID = string;
export type PlayerID = string;
export type SeatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Format =
  | "commander"
  | "standard"
  | "vintage"
  | "modern"
  | "custom";

export interface PlayerRef {
  readonly id: PlayerID;
  readonly name: string;
  readonly seat: SeatIndex;
  readonly isSpectator?: boolean;
}

// Visibility model
export type Visibility = "owner" | "controller" | "public" | "none";

export interface HiddenCardRef {
  readonly id: string; // opaque id
  readonly faceDown: true;
  readonly zone: "battlefield" | "exile" | "stack" | "library" | "hand" | "graveyard" | "command";
  readonly visibility: Visibility;
}

export interface KnownCardRef {
  readonly id: string;
  readonly name: string;
  readonly oracle_id?: string;
  readonly cmc?: number;
  readonly mana_cost?: string;
  readonly zone: HiddenCardRef["zone"];
  readonly faceDown?: false;
}

export type CardRef = HiddenCardRef | KnownCardRef;

export interface LifeTotals {
  readonly [playerId: PlayerID]: number;
}

export interface CommanderInfo {
  readonly commanderIds: readonly string[];
  readonly tax: number; // total extra generic cost applied
}

export interface BattlefieldPermanent {
  readonly id: string;
  readonly controller: PlayerID;
  readonly owner: PlayerID;
  readonly tapped: boolean;
  readonly counters?: Readonly<Record<string, number>>;
  readonly card: CardRef; // may be face-down
}

export interface StackItem {
  readonly id: string;
  readonly type: "spell" | "ability";
  readonly controller: PlayerID;
  readonly card?: CardRef; // spells have card, abilities may not
  readonly targets?: readonly string[];
}

export interface GameState {
  readonly id: GameID;
  readonly format: Format;
  readonly players: readonly PlayerRef[];
  readonly startingLife: number;
  readonly life: LifeTotals;
  readonly turnPlayer: PlayerID;
  readonly priority: PlayerID;
  readonly stack: readonly StackItem[];
  readonly battlefield: readonly BattlefieldPermanent[];
  readonly commandZone: Readonly<Record<PlayerID, CommanderInfo>>;
  readonly phase: "begin" | "precombat_main" | "combat" | "postcombat_main" | "end";
  readonly active: boolean;
}

// Client-scoped view (after visibility filtering)
export type ClientGameView = Omit<GameState, "battlefield" | "stack"> & {
  readonly battlefield: readonly BattlefieldPermanent[];
  readonly stack: readonly StackItem[];
};

// Diff envelope
export interface StateDiff<T> {
  readonly full?: T;
  readonly patch?: Partial<T>;
  readonly seq: number;
}