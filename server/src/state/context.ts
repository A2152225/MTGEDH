// server/src/state/context.ts
// Create an in-memory runtime context for a single game instance.
//
// NOTE: this file uses only `import type` from the shared types to avoid
// importing runtime values from shared (which are type-only here).
// The returned context exposes a `state` object (authoritative snapshot)
// and runtime helpers (libraries Map, rng, bumpSeq, etc.) used by state modules.

import type {
  GameState,
  PlayerRef,
  PlayerZones,
  KnownCardRef,
  PlayerID,
} from "../../../shared/src/types";

export interface GameContext {
  gameId: string;
  state: GameState;
  // runtime maps / caches
  libraries: Map<PlayerID, KnownCardRef[]>;
  zones: Record<PlayerID, PlayerZones>;
  // public counters (runtime)
  life: Record<PlayerID, number>;
  poison: Record<PlayerID, number>;
  experience: Record<PlayerID, number>;
  commandZone: Record<PlayerID, any>;
  // participant tracking
  joinedBySocket: Map<string, { socketId: string; playerId: PlayerID; spectator: boolean }>;
  participantsList: Array<{ socketId: string; playerId: PlayerID; spectator: boolean }>;
  // token maps
  tokenToPlayer: Map<string, PlayerID>;
  playerToToken: Map<PlayerID, string>;
  // grants / spectator names
  grants: Map<PlayerID, Set<PlayerID>>;
  inactive: Set<PlayerID>;
  spectatorNames: Map<PlayerID, string>;
  // pending initial draw set
  pendingInitialDraw: Set<PlayerID>;

  // NEW: explicit visibility grants for hand (Telepathy, judge, reveal-hand effects)
  handVisibilityGrants: Map<PlayerID, Set<PlayerID | "spectator:judge">>;

  // RNG and sequencing helpers
  rngSeed: number | null;
  rng: () => number;
  seq: { value: number };
  bumpSeq: () => void;

  // misc runtime helpers that modules may call
  landsPlayedThisTurn?: Record<PlayerID, number>;
  manaPool?: Record<PlayerID, any>;
  // other internal transient flags & helpers
  pendingInitialDrawFlag?: any;
}

/**
 * Deterministic PRNG (mulberry32)
 * seeded with a 32-bit integer seed.
 */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple hash string → 32-bit int seed (FNV-1a style) */
function hashStringToSeed(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * createContext(gameId)
 *
 * Returns a fresh in-memory GameContext for the given gameId.
 * The returned context contains:
 *  - a minimal authoritative GameState snapshot (state)
 *  - runtime maps for libraries/zones and counters
 *  - deterministic RNG seeded by gameId
 *  - bumpSeq() which increments seq.value (used to signal visibility changes)
 *
 * Implementation notes:
 * - We avoid importing runtime values from shared (shared contains only types
 *   for our build in this code path). Use string literals for phase/format initializers.
 */
export function createContext(gameId: string): GameContext {
  const rngSeed = hashStringToSeed(gameId);
  const rng = mulberry32(rngSeed);

  const seq = { value: 0 };
  function bumpSeq() {
    seq.value++;
  }

  // Minimal authoritative state snapshot. Keep shape compatible with ClientGameView.
  const state: GameState = {
    id: gameId,
    // default format: commander (string union in shared types)
    format: "commander" as any,
    players: [],
    startingLife: 40,
    life: {},
    turnPlayer: "" as any,
    priority: "" as any,
    turnDirection: 1,
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: "PRE_GAME" as any,
    step: undefined,
    active: false,
    zones: {},
    status: undefined,
    turnOrder: [],
    startedAt: undefined,
    turn: undefined,
    activePlayerIndex: undefined,
    landsPlayedThisTurn: {} as any,
  };

  const ctx: GameContext = {
    gameId,
    state,
    libraries: new Map<PlayerID, KnownCardRef[]>(),
    zones: {},
    life: {},
    poison: {},
    experience: {},
    commandZone: {} as any,
    joinedBySocket: new Map(),
    participantsList: [],
    tokenToPlayer: new Map(),
    playerToToken: new Map(),
    grants: new Map(),
    inactive: new Set(),
    spectatorNames: new Map(),
    pendingInitialDraw: new Set(),

    // NEW: initialize hand visibility grants map
    handVisibilityGrants: new Map(),

    rngSeed,
    rng,
    seq,
    bumpSeq,

    // optional runtime containers (populated by other modules when used)
    landsPlayedThisTurn: {},
    manaPool: {},
  };

  return ctx;
}

export default createContext;