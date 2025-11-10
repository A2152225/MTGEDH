import { GameFormat, GamePhase } from "../../../shared/src";
import type {
  GameID,
  PlayerID,
  PlayerRef,
  GameState,
  CommanderInfo,
  PlayerZones,
  KnownCardRef,
} from "../../../shared/src";
import { mulberry32, hashStringToSeed } from "../utils/rng";
import { uid } from "../utils";

/**
 * GameContext holds the mutable in-memory state pieces and some helpers.
 * This mirrors the original monolithic context shape used by state modules.
 */
export interface GameContext {
  readonly gameId: GameID;
  readonly state: GameState;
  readonly life: Record<PlayerID, number>;
  readonly poison: Record<PlayerID, number>;
  readonly experience: Record<PlayerID, number>;
  readonly commandZone: Record<PlayerID, CommanderInfo>;
  readonly zones: Record<PlayerID, PlayerZones>;
  readonly libraries: Map<PlayerID, KnownCardRef[]>;
  readonly joinedBySocket: Map<string, { socketId: string; playerId: PlayerID; spectator: boolean }>;
  readonly participantsList: Array<{ socketId: string; playerId: PlayerID; spectator: boolean }>;
  readonly tokenToPlayer: Map<string, PlayerID>;
  readonly playerToToken: Map<PlayerID, string>;
  readonly grants: Map<PlayerID, Set<PlayerID>>;
  readonly inactive: Set<PlayerID>;
  readonly spectatorNames: Map<PlayerID, string>;
  readonly pendingInitialDraw: Set<PlayerID>;
  rngSeed: number | null;
  rng: () => number;
  seq: { value: number };
  passesInRow: { value: number };
  bumpSeq: () => void;
}

export function createContext(gameId: GameID): GameContext {
  const players: PlayerRef[] = [];
  const commandZone: Record<PlayerID, CommanderInfo> = {} as Record<PlayerID, CommanderInfo>;
  const zones: Record<PlayerID, PlayerZones> = {};
  const life: Record<PlayerID, number> = {};
  const poison: Record<PlayerID, number> = {};
  const experience: Record<PlayerID, number> = {};
  const libraries = new Map<PlayerID, KnownCardRef[]>();
  const joinedBySocket = new Map<string, { socketId: string; playerId: PlayerID; spectator: boolean }>();
  const participantsList: Array<{ socketId: string; playerId: PlayerID; spectator: boolean }> = [];
  const tokenToPlayer = new Map<string, PlayerID>();
  const playerToToken = new Map<PlayerID, string>();
  const grants = new Map<PlayerID, Set<PlayerID>>();
  const inactive = new Set<PlayerID>();
  const spectatorNames = new Map<PlayerID, string>();
  const pendingInitialDraw = new Set<PlayerID>();

  // RNG seeded deterministically per-game id by default
  let rngSeed: number | null = null;
  let rng = mulberry32(hashStringToSeed(gameId));
  const seq = { value: 0 };
  const passesInRow = { value: 0 };

  function bumpSeq() {
    seq.value++;
  }

  return {
    gameId,
    state: {
      id: gameId,
      format: (GameFormat as any) || "commander",
      players: [],
      startingLife: 40,
      life: {},
      turnPlayer: "" as any,
      priority: "" as any,
      turnDirection: 1,
      stack: [],
      battlefield: [],
      commandZone: {},
      phase: GamePhase.BEGINNING,
      step: undefined,
      active: false,
      zones: {},
      status: undefined,
      turnOrder: [],
      startedAt: undefined,
      turn: undefined,
      activePlayerIndex: undefined,
      landsPlayedThisTurn: {},
    } as GameState,
    life,
    poison,
    experience,
    commandZone,
    zones,
    libraries,
    joinedBySocket,
    participantsList,
    tokenToPlayer,
    playerToToken,
    grants,
    inactive,
    spectatorNames,
    pendingInitialDraw,
    rngSeed,
    rng,
    seq,
    passesInRow,
    bumpSeq,
  };
}