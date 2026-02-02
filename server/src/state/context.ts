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
  // Note: zones are stored in ctx.state.zones (single source of truth)
  // public counters (runtime)
  life: Record<PlayerID, number>;
  poison: Record<PlayerID, number>;
  experience: Record<PlayerID, number>;
  commandZone: Record<PlayerID, any>;
  // participant tracking
  joinedBySocket: Map<
    string,
    { socketId: string; playerId: PlayerID; spectator: boolean }
  >;
  participantsList: Array<{
    socketId: string;
    playerId: PlayerID;
    spectator: boolean;
  }>;
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

  // Priority tracking for stack resolution
  passesInRow: { value: number };

  // Replay mode flag - when true, skip side effects in functions like nextStep
  // This prevents duplicate actions when replaying events (e.g., don't draw again 
  // during nextStep if a separate drawCards event was already replayed)
  isReplaying?: boolean;

  // misc runtime helpers that modules may call
  landsPlayedThisTurn?: Record<PlayerID, number>;
  maxLandsPerTurn?: Record<PlayerID, number>;  // Default 1, can be increased by effects like Exploration, Azusa
  additionalDrawsPerTurn?: Record<PlayerID, number>;  // Extra draws per draw step (Font of Mythos, Rites of Flourishing)
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

/**
 * createContext(gameId)
 *
 * Returns a fresh in-memory GameContext for the given gameId.
 * The returned context contains:
 *  - a minimal authoritative GameState snapshot (state)
 *  - runtime maps for libraries/zones and counters
 *  - RNG seeded with a per-instance random/time-based seed
 *  - bumpSeq() which increments seq.value (used to signal visibility changes)
 *
 * Implementation notes:
 * - We avoid importing runtime values from shared (shared contains only types
 *   for our build in this code path). Use string literals for phase/format initializers.
 */
export function createContext(gameId: string): GameContext {
  // Previously this used hashStringToSeed(gameId), which made all games with the
  // same id share the same default seed. That caused new physical games with the
  // same name to have correlated shuffles/opening hands.
  //
  // We now use a time/random-based seed for each new context. For persisted games,
  // this initial seed is overridden by the rngSeed event during replay, so replay
  // remains deterministic for an existing game history.
  const initialSeed =
    (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rngSeed = initialSeed;
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
    phase: "pre_game" as any,
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

  // Intervening-if helpers: record baseline deck/library metadata.
  // Commander minimum deck is 100 including commander(s); library minimum is 99.
  (state as any).minimumLibrarySize = 99;
  (state as any).startingLibraryCountByPlayer = {};

  // Per-turn ETB tracking used by intervening-if evaluation.
  // Stored as ad-hoc fields on state to avoid widening shared GameState types.
  (state as any).landsEnteredBattlefieldThisTurn = {};
  (state as any).nonlandPermanentsEnteredBattlefieldThisTurn = {};
  (state as any).creaturesEnteredBattlefieldThisTurnByController = {};
  (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = {};
  (state as any).creaturesEnteredBattlefieldThisTurnIdsByController = {};
  (state as any).artifactsEnteredBattlefieldThisTurnByController = {};
  (state as any).artifactsEnteredBattlefieldThisTurnIdsByController = {};
  (state as any).enchantmentsEnteredBattlefieldThisTurnByController = {};
  (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController = {};
  (state as any).planeswalkersEnteredBattlefieldThisTurnByController = {};
  (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController = {};
  (state as any).battlesEnteredBattlefieldThisTurnByController = {};
  (state as any).battlesEnteredBattlefieldThisTurnIdsByController = {};

  // Per-turn LTB/dies tracking used by intervening-if evaluation.
  // These must exist even before the first event writes them, otherwise recognized
  // templates (e.g. "if a creature died this turn") collapse to `null` instead of 0.
  (state as any).creaturesDiedThisTurnByController = {};
  (state as any).creaturesDiedThisTurnByControllerSubtype = {};
  (state as any).creaturesDiedThisTurnIds = [];
  (state as any).permanentLeftBattlefieldThisTurn = {};

  // Additional per-turn trackers used by intervening-if evaluation.
  // These are safe defaults; state modules update them on positive evidence.
  (state as any).lifeGainedThisTurn = {};
  (state as any).lifeLostThisTurn = {};
  (state as any).cardsDrawnThisTurn = {};
  (state as any).spellsCastFromHandThisTurn = {};
  (state as any).noncreatureSpellsCastThisTurn = {};
  (state as any).damageTakenThisTurnByPlayer = {};
  (state as any).discardedCardThisTurn = {};
  (state as any).anyPlayerDiscardedCardThisTurn = false;
  (state as any).dieRollsThisTurn = {};
  (state as any).countersPutThisTurnByPermanentId = {};
  (state as any).plusOneCountersPutThisTurnByPermanentId = {};
  (state as any).creaturesThatDealtDamageToPlayer = {};
  (state as any).linkedExiles = [];

  // Combat trackers used by recognized intervening-if templates.
  // - creaturesAttackedThisTurn is per-turn and cleared at end of turn.
  // - attackedOrBlockedThisCombatByPermanentId is per-combat and reset on declare attackers.
  (state as any).creaturesAttackedThisTurn = {};
  (state as any).attackedOrBlockedThisCombatByPermanentId = {};
  (state as any).attackersDeclaredThisCombatByPlayer = {};

  // Per-turn / per-cycle trackers used by recognized intervening-if templates.
  // These are safe defaults; state modules update them on positive evidence.
  (state as any).completedDungeonThisTurn = {};
  (state as any).dungeonCompletedThisTurn = {};
  (state as any).tookCombatDamageSinceLastTurn = {};
  (state as any).combatDamageDealtToPlayerSinceLastTurn = {};

  // Cycling/crime/day-night trackers used by recognized intervening-if templates.
  (state as any).cycleCountThisTurn = {};
  (state as any).cardsCycledThisTurn = {};
  (state as any).cycledCardsThisTurn = {};
  (state as any).committedCrimeThisTurn = {};
  (state as any).crimeCommittedThisTurn = {};
  (state as any).hasCommittedCrimeThisTurn = {};
  (state as any).dayNightChangedThisTurn = false;

  // Additional per-turn trackers used by newer recognized templates.
  (state as any).spellWasWarpedThisTurn = {};
  (state as any).evidenceCollectedThisTurn = {};
  (state as any).evidenceCollectedThisTurnByPlayer = {};
  (state as any).evidenceCollectedThisTurnByPlayerCounts = {};
  (state as any).playedCardFromExileThisTurn = {};
  (state as any).playedFromExileThisTurn = {};
  (state as any).cardsPlayedFromExileThisTurn = {};
  (state as any).castFromExileThisTurn = {};
  (state as any).castFromGraveyardThisTurn = {};
  (state as any).playedLandFromGraveyardThisTurn = {};
  (state as any).playedLandFromExileThisTurn = {};
  (state as any).discardedCardThisTurn = (state as any).discardedCardThisTurn || {};
  (state as any).anyPlayerDiscardedCardThisTurn = typeof (state as any).anyPlayerDiscardedCardThisTurn === 'boolean'
    ? (state as any).anyPlayerDiscardedCardThisTurn
    : false;

  // Token/sacrifice/counter placement trackers (used by various intervening-if templates).
  (state as any).tokensCreatedThisTurn = {};
  (state as any).tokenCreatedThisTurn = {};
  (state as any).createdTokenThisTurn = {};
  (state as any).sacrificedCluesThisTurn = {};
  (state as any).cluesSacrificedThisTurn = {};
  (state as any).cluesSacrificedThisTurnCount = {};
  (state as any).permanentsSacrificedThisTurn = {};
  (state as any).foodsSacrificedThisTurn = {};
  (state as any).putCounterOnCreatureThisTurn = {};
  (state as any).placedCounterOnCreatureThisTurn = {};
  (state as any).countersPlacedOnCreaturesThisTurn = {};
  (state as any).putPlusOneCounterOnPermanentThisTurn = {};
  (state as any).placedPlusOneCounterOnPermanentThisTurn = {};
  (state as any).plusOneCounterPlacedOnPermanentThisTurn = {};
  (state as any).putCounterOnPermanentThisTurnByPermanentId = (state as any).putCounterOnPermanentThisTurnByPermanentId || {};

  // Graveyard-leave trackers (used by intervening-if templates).
  (state as any).cardLeftGraveyardThisTurn = {};
  (state as any).cardsLeftGraveyardThisTurn = {};
  (state as any).leftGraveyardThisTurn = {};
  (state as any).creatureCardLeftGraveyardThisTurn = {};
  (state as any).creatureCardsLeftGraveyardThisTurn = {};
  (state as any).cardLeftYourGraveyardThisTurn = {};
  (state as any).creatureCardLeftYourGraveyardThisTurn = {};
  (state as any).cardsPutIntoYourGraveyardThisTurn = {};
  (state as any).cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn = {};
  (state as any).creatureCardPutIntoYourGraveyardThisTurn = {};
  (state as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = {};
  (state as any).enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn = {};
  (state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;
  (state as any).permanentPutIntoHandFromBattlefieldThisTurn = {};
  (state as any).creaturesDamagedByThisCreatureThisTurn = {};
  (state as any).attackedByAssassinThisTurnByPlayer = {};
  (state as any).putCounterOnPermanentThisTurnByPermanentId = {};

  // Per-turn tap tracking used by intervening-if evaluation.
  // Conservative: we only set `true` on positive evidence and avoid writing `false`.
  (state as any).tappedNonlandPermanentThisTurnByPlayer = {};
  (state as any).tappedNonlandPermanentLastTurnByPlayer = {};

  // Intervening-if: baseline per-game/last-turn trackers.
  // These start at safe defaults so early-game checks don't collapse to null.
  (state as any).spellsCastThisTurn = [];
  (state as any).spellsCastLastTurnCount = 0;
  (state as any).spellsCastLastTurnByPlayerCounts = {};
  (state as any).lifeLostLastTurnByPlayerCounts = {};
  (state as any).lifeLostLastTurnByPlayer = {};
  (state as any).lifeLostLastTurn = {};
  (state as any).landsEnteredBattlefieldLastTurnByPlayerCounts = {};
  (state as any).creaturesEnteredBattlefieldLastTurnByController = {};
  (state as any).attackedPlayersThisTurnByPlayer = {};
  (state as any).attackedPlayersLastTurnByPlayer = {};
  (state as any).attackedYouLastTurnByPlayer = {};
  (state as any).opponentCastSpellSinceYourLastTurnEnded = {};
  (state as any).monarchAtTurnBeginByPlayer = {};
  (state as any).wasMonarchAtTurnBegin = {};
  (state as any).monarchAtTurnBegan = {};

  const ctx: GameContext = {
    gameId,
    state,
    libraries: new Map<PlayerID, KnownCardRef[]>(),
    life: state.life,  // Share the same object as state.life
    poison: {},
    experience: {},
    commandZone: state.commandZone,  // Share the same object as state.commandZone
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
    
    // Priority tracking for stack resolution
    passesInRow: { value: 0 },

    // optional runtime containers - share with state where possible
    landsPlayedThisTurn: state.landsPlayedThisTurn,  // Share with state
    maxLandsPerTurn: {},  // Default 1 per player, can be increased by effects
    additionalDrawsPerTurn: {},  // Extra draws per draw step (Font of Mythos, etc.)
    manaPool: {},
  };

  return ctx;
}

export default createContext;