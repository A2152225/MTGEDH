/**
 * Public InMemoryGame surface for the server-authoritative game object.
 *
 * This file intentionally exposes the full API surface that socket handlers
 * and other server modules expect. It mirrors the original monolithic
 * gameState surface so the modular refactor does not remove or change any
 * publicly-used method signatures.
 *
 * Keep this file comprehensive — if you add server methods, add them here.
 */

import { GameFormat, GamePhase, GameStep } from "../../../shared/src";
import type {
  GameID,
  PlayerID,
  PlayerRef,
  GameState,
  ClientGameView,
  CommanderInfo,
  PlayerZones,
  KnownCardRef,
  TargetRef,
} from "../../../shared/src";

export { GameFormat, GamePhase, GameStep };
export type {
  GameID,
  PlayerID,
  PlayerRef,
  GameState,
  ClientGameView,
  CommanderInfo,
  PlayerZones,
  KnownCardRef,
  TargetRef,
};

export type GameEvent =
  | { type: "rngSeed"; seed: number }
  | { type: "setTurnDirection"; direction: 1 | -1 }
  | { type: "join"; playerId: PlayerID; name: string; seat?: number; seatToken?: string }
  | { type: "leave"; playerId: PlayerID }
  | { type: "passPriority"; by: PlayerID }
  | { type: "restart"; preservePlayers?: boolean }
  | { type: "removePlayer"; playerId: PlayerID }
  | { type: "skipPlayer"; playerId: PlayerID }
  | { type: "unskipPlayer"; playerId: PlayerID }
  | { type: "spectatorGrant"; owner: PlayerID; spectator: PlayerID }
  | { type: "spectatorRevoke"; owner: PlayerID; spectator: PlayerID }
  | {
      type: "deckImportResolved";
      playerId: PlayerID;
      cards: Array<
        Pick<
          KnownCardRef,
          | "id"
          | "name"
          | "type_line"
          | "oracle_text"
          | "image_uris"
          | "mana_cost"
          | "power"
          | "toughness"
          | "color_identity"
        >
      >;
    }
  | { type: "shuffleLibrary"; playerId: PlayerID }
  | { type: "drawCards"; playerId: PlayerID; count: number }
  | {
      type: "selectFromLibrary";
      playerId: PlayerID;
      cardIds: string[];
      moveTo: "hand" | "graveyard" | "exile" | "battlefield";
      reveal?: boolean;
    }
  | { type: "handIntoLibrary"; playerId: PlayerID }
  | {
      type: "setCommander";
      playerId: PlayerID;
      commanderNames: string[];
      commanderIds?: string[];
      colorIdentity?: ("W" | "U" | "B" | "R" | "G")[];
    }
  | { type: "castCommander"; playerId: PlayerID; commanderId: string }
  | { type: "moveCommanderToCZ"; playerId: PlayerID; commanderId: string }
  | { type: "updateCounters"; permanentId: string; deltas: Record<string, number> }
  | { type: "updateCountersBulk"; updates: { permanentId: string; deltas: Record<string, number> }[] }
  | {
      type: "createToken";
      controller: PlayerID;
      name: string;
      count?: number;
      basePower?: number;
      baseToughness?: number;
    }
  | { type: "removePermanent"; permanentId: string }
  | { type: "dealDamage"; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean }
  | { type: "resolveSpell"; caster: PlayerID; cardId: string; spec: any; chosen: any[] }
  | {
      type: "pushStack";
      item: {
        id: string;
        controller: PlayerID;
        card: Pick<
          KnownCardRef,
          "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness"
        >;
        targets?: string[];
      };
    }
  | { type: "resolveTopOfStack" }
  | {
      type: "playLand";
      playerId: PlayerID;
      card: Pick<
        KnownCardRef,
        "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness"
      >;
    }
  | { type: "nextTurn" }
  | { type: "nextStep" }
  | { type: "reorderHand"; playerId: PlayerID; order: number[] }
  | { type: "shuffleHand"; playerId: PlayerID }
  | { type: "scryResolve"; playerId: PlayerID; keepTopOrder: string[]; bottomOrder: string[] }
  | { type: "surveilResolve"; playerId: PlayerID; toGraveyard: string[]; keepTopOrder: string[] };

export interface Participant {
  readonly socketId: string;
  readonly playerId: PlayerID;
  readonly spectator: boolean;
}

export interface InMemoryGame {
  // core snapshot
  readonly state: GameState;
  seq: number;

  // lifecycle / participants
  join: (
    socketId: string,
    playerName: string,
    spectator: boolean,
    fixedPlayerId?: PlayerID,
    seatTokenFromClient?: string
  ) => { playerId: PlayerID; added: boolean; seatToken?: string; seat?: number };
  leave: (playerId?: PlayerID) => boolean;
  disconnect: (socketId: string) => void;
  participants: () => Participant[];

  // priority / turn control
  passPriority: (playerId: PlayerID) => { changed: boolean; resolvedNow: boolean };
  setTurnDirection: (dir: 1 | -1) => void;
  nextTurn: () => void;
  nextStep: () => void;

  // RNG helpers
  seedRng: (seed: number) => void;
  hasRngSeed: () => boolean;

  // spectator grants
  grantSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;
  revokeSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;

  // pending opening draw (commander)
  flagPendingOpeningDraw: (playerId: PlayerID) => void;
  pendingInitialDraw?: Set<PlayerID>;

  // deck / zones
  importDeckResolved: (
    playerId: PlayerID,
    cards: Array<
      Pick<
        KnownCardRef,
        | "id"
        | "name"
        | "type_line"
        | "oracle_text"
        | "image_uris"
        | "mana_cost"
        | "power"
        | "toughness"
      >
    >
  ) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => string[];
  selectFromLibrary: (
    playerId: PlayerID,
    cardIds: string[],
    moveTo: "hand" | "graveyard" | "exile" | "battlefield"
  ) => string[];
  moveHandToLibrary: (playerId: PlayerID) => number;
  searchLibrary: (playerId: PlayerID, query: string, limit: number) => Array<Pick<KnownCardRef, "id" | "name">>;

  // zone helpers
  reconcileZonesConsistency: (playerId?: PlayerID) => void;
  reorderHand: (playerId: PlayerID, order: number[]) => boolean;
  shuffleHand: (playerId: PlayerID) => void;
  peekTopN: (
    playerId: PlayerID,
    n: number
  ) => Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">>;
  applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) => void;
  applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) => void;

  // commander
  setCommander: (
    playerId: PlayerID,
    commanderNames: string[],
    commanderIds?: string[],
    colorIdentity?: ("W" | "U" | "B" | "R" | "G")[]
  ) => void;
  castCommander: (playerId: PlayerID, commanderId: string) => void;
  moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => void;
  getCommanderInfo?: (playerId: PlayerID) => { commanderIds: string[]; commanderCards?: any[] } | null;

  // counters / tokens / engine
  updateCounters: (permanentId: string, deltas: Record<string, number>) => void;
  applyUpdateCountersBulk: (updates: { permanentId: string; deltas: Record<string, number> }[]) => void;
  createToken: (controller: PlayerID, name: string, count?: number, basePower?: number, baseToughness?: number) => void;
  removePermanent: (permanentId: string) => void;
  movePermanentToExile: (permanentId: string) => void;
  applyEngineEffects: (effects: readonly any[]) => void;
  runSBA: (playerId: PlayerID) => void;

  // stack
  pushStack: (item: {
    id: string;
    controller: PlayerID;
    card: Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">;
    targets?: string[];
  }) => void;
  resolveTopOfStack: () => void;

  // play
  playLand: (
    playerId: PlayerID,
    card: Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">
  ) => void;

  // view
  viewFor: (viewer?: PlayerID, spectator?: boolean) => ClientGameView;

  // event lifecycle / utilities
  applyEvent: (e: GameEvent) => void;
  replay: (events: GameEvent[]) => void;
  reset: (preservePlayers: boolean) => void;
  skip: (playerId: PlayerID) => void;
  unskip: (playerId: PlayerID) => void;
  remove: (playerId: PlayerID) => void;

  // backward-compat placeholders
  pendingInitialDraw?: Set<PlayerID>;
  moveCommanderToCZ?: (playerId: PlayerID, commanderId: string) => void;
  get seqValue?: number;
  [k: string]: any;
}