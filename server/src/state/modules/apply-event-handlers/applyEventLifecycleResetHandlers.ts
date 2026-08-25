// server/src/state/modules/apply-event-handlers/applyEventLifecycleResetHandlers.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts.
//
// Cluster: context lifecycle fallbacks used by the lobby/session events and by
// callers that reset or reseat players outside the event log.
// Public entries: reset, skip, unskip, remove.
//
// These live in a leaf so extracted applyEvent case families can call them
// without importing applyEvent.ts (which would create an import cycle).
import { createContext } from "../../context";
import type { PlayerID } from "../../types";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { mulberry32 } from "../../../utils/rng";
import { debugWarn } from "../../../utils/debug.js";


export function reset(ctx: any, preservePlayers = false): void {
  if (!ctx) throw new Error("reset: missing ctx");

  // Clear unified ResolutionQueue state for this game. This prevents stale
  // pending interactions from blocking subsequent replays/undo.
  try {
    const gameId = (ctx as any).gameId;
    if (typeof gameId === 'string' && gameId.trim()) {
      ResolutionQueueManager.clearAllSteps(gameId);
    }
  } catch {
    // best-effort only
  }

  // Prefer specialized reset if present on ctx or a global replayModule
  try {
    // @ts-ignore - global replayModule if present
    const globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    if (
      typeof (globalObj as any).replayModule !== "undefined" &&
      (globalObj as any).replayModule &&
      typeof (globalObj as any).replayModule.reset === "function"
    ) {
      (globalObj as any).replayModule.reset(ctx, preservePlayers);
      return;
    }
  } catch {
    // continue to fallback
  }

  if (typeof ctx.reset === "function") {
    try {
      ctx.reset(preservePlayers);
      return;
    } catch (err) {
      debugWarn(2, "reset: ctx.reset threw, falling back:", err);
    }
  }

  // Fallback conservative reset
  try {
    const currentState = (ctx.state && typeof ctx.state === 'object') ? ctx.state : {};
    const preservedGameId = String((currentState as any).id || ctx.gameId || '').trim() || String(ctx.gameId || 'game');
    const preservedFormat = (currentState as any).format;
    const preservedStartingLife = Number((currentState as any).startingLife);
    const preservedTurnDirection = Number((currentState as any).turnDirection);

    const preservedZonesRef = (currentState as any).zones && typeof (currentState as any).zones === 'object'
      ? (currentState as any).zones
      : {};
    const preservedLifeRef = (currentState as any).life && typeof (currentState as any).life === 'object'
      ? (currentState as any).life
      : {};
    const preservedCommandZoneRef = (currentState as any).commandZone && typeof (currentState as any).commandZone === 'object'
      ? (currentState as any).commandZone
      : {};
    const preservedLandsPlayedThisTurnRef = (currentState as any).landsPlayedThisTurn && typeof (currentState as any).landsPlayedThisTurn === 'object'
      ? (currentState as any).landsPlayedThisTurn
      : {};
    // Snapshot mana pool (object values, not reference) to survive the reset for
    // replay scenarios that depend on the initial mana state.
    const preservedManaPool: Record<string, any> = {};
    if (preservePlayers && (currentState as any).manaPool && typeof (currentState as any).manaPool === 'object') {
      for (const [pid, pool] of Object.entries((currentState as any).manaPool)) {
        if (pool && typeof pool === 'object') {
          preservedManaPool[pid] = { ...(pool as any) };
        }
      }
    }
    const preservedGraveyards: Record<string, any[]> = {};
    const preservedPlayers = preservePlayers && Array.isArray((currentState as any).players)
      ? ((currentState as any).players as any[]).map((player: any) => ({ ...player }))
      : [];

    // preserve participants list if requested
    let participantsBackup: Array<any> = [];
    if (preservePlayers) {
      if (typeof ctx.participants === "function") {
        try {
          participantsBackup = ctx.participants().slice();
        } catch {
          participantsBackup = [];
        }
      } else if (Array.isArray((ctx as any).participantsList)) {
        participantsBackup = (ctx as any).participantsList.slice();
      }
    }

    const freshCtx = createContext(preservedGameId);
    const targetState = currentState as Record<string, any>;
    for (const key of Object.keys(preservedZonesRef)) {
      delete preservedZonesRef[key];
    }
    for (const key of Object.keys(preservedLifeRef)) {
      delete preservedLifeRef[key];
    }
    for (const key of Object.keys(preservedCommandZoneRef)) {
      delete preservedCommandZoneRef[key];
    }
    for (const key of Object.keys(preservedLandsPlayedThisTurnRef)) {
      delete preservedLandsPlayedThisTurnRef[key];
    }
    for (const key of Object.keys(targetState)) {
      delete targetState[key];
    }
    Object.assign(targetState, freshCtx.state);
    targetState.zones = preservedZonesRef;
    targetState.life = preservedLifeRef;
    targetState.commandZone = preservedCommandZoneRef;
    targetState.landsPlayedThisTurn = preservedLandsPlayedThisTurnRef;
    ctx.state = targetState;

    if (preservedFormat != null) {
      (ctx.state as any).format = preservedFormat;
    }
    if (Number.isFinite(preservedStartingLife) && preservedStartingLife > 0) {
      (ctx.state as any).startingLife = preservedStartingLife;
    }
    if (Number.isFinite(preservedTurnDirection) && Math.abs(preservedTurnDirection) === 1) {
      (ctx.state as any).turnDirection = preservedTurnDirection;
    }


    ctx.libraries = new Map<string, any[]>();
    ctx.life = (ctx.state as any).life || {};
    ctx.poison = {};
    ctx.experience = {};
    ctx.commandZone = (ctx.state as any).commandZone || {};
    ctx.pendingInitialDraw = new Set<string>();
    ctx.handVisibilityGrants = new Map();
    ctx.revealedLibraryTopByOwner = new Map();
    ctx.inactive = new Set<string>();
    ctx.landsPlayedThisTurn = (ctx.state as any).landsPlayedThisTurn || {};
    if (Object.keys(preservedManaPool).length > 0) {
      (ctx.state as any).manaPool = (ctx.state as any).manaPool || {};
      for (const [pid, pool] of Object.entries(preservedManaPool)) {
        (ctx.state as any).manaPool[pid] = pool;
      }
      ctx.manaPool = (ctx.state as any).manaPool;
    }
    ctx.maxLandsPerTurn = {};
    ctx.additionalDrawsPerTurn = {};
    ctx.manaPool = {};

    if (!preservePlayers) {
      (ctx.state as any).players = [];
    } else {
      (ctx.state as any).players = preservedPlayers;

      const playerIds = preservedPlayers.length > 0
        ? preservedPlayers.map((player: any) => String(player?.id || '').trim()).filter(Boolean)
        : participantsBackup.map((participant) => String(participant?.playerId || '').trim()).filter(Boolean);

      for (const pid of playerIds) {
        (ctx.state as any).zones[pid] = {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        };
        ctx.libraries.set(pid, []);
        ctx.life[pid] = Number((ctx.state as any).startingLife || 40);
        ctx.poison[pid] = 0;
        ctx.experience[pid] = 0;

        const playerEntry = ((ctx.state as any).players || []).find((player: any) => String(player?.id || '').trim() === pid);
        if (playerEntry) {
          playerEntry.life = ctx.life[pid];
        }
      }
    }

    // Clear pending initial draw flags to avoid double-draws
    if (
      (ctx as any).pendingInitialDraw &&
      typeof (ctx as any).pendingInitialDraw.clear === "function"
    ) {
      (ctx as any).pendingInitialDraw.clear();
    } else {
      (ctx as any).pendingInitialDraw = new Set<string>();
    }

    // Clear RNG state so it can be properly re-initialized from rngSeed event during replay
    // This is critical for undo to work correctly - the RNG must be reset to produce
    // the same shuffle/draw sequence when events are replayed
    try {
      ctx.rngSeed = null;
      // Create a fresh RNG function that will be replaced by rngSeed event
      // Using a new random seed as fallback in case no rngSeed event exists
      const fallbackSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      ctx.rng = mulberry32(fallbackSeed);
    } catch {
      // ignore RNG reset errors
    }

    // Reset bump/seq if present
    try {
      if (ctx.passesInRow && typeof ctx.passesInRow === "object" && "value" in ctx.passesInRow) {
        ctx.passesInRow.value = 0;
      }
      if (ctx.seq && typeof ctx.seq === "object" && "value" in ctx.seq)
        ctx.seq.value = 0;
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {
      // ignore
    }
  } catch (err) {
    debugWarn(1, "reset fallback failed:", err);
  }
}

/* Skip / unskip / remove fallbacks (prefer module implementations) */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (typeof (ctx as any).skip === "function") {
    (ctx as any).skip(playerId);
    return;
  }
  try {
    if (!((ctx as any).inactive instanceof Set))
      (ctx as any).inactive = new Set<PlayerID>();
    (ctx as any).inactive.add(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (typeof (ctx as any).unskip === "function") {
    (ctx as any).unskip(playerId);
    return;
  }
  try {
    if ((ctx as any).inactive instanceof Set)
      (ctx as any).inactive.delete(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (typeof (ctx as any).remove === "function") {
    (ctx as any).remove(playerId);
    return;
  }
  try {
    // Remove from participants list
    if (Array.isArray((ctx as any).participantsList)) {
      const idx = (ctx as any).participantsList.findIndex(
        (p: any) => p.playerId === playerId
      );
      if (idx !== -1) (ctx as any).participantsList.splice(idx, 1);
    }
    // Remove player data from state and maps
    if (Array.isArray(ctx.state?.players)) {
      const i = (ctx.state.players as any[]).findIndex(
        (p: any) => p.id === playerId
      );
      if (i >= 0) (ctx.state.players as any[]).splice(i, 1);
    }
    if (ctx.libraries && typeof ctx.libraries.delete === "function")
      ctx.libraries.delete(playerId);
    if (ctx.state.zones && ctx.state.zones[playerId])
      delete ctx.state.zones[playerId];
    if (ctx.life && ctx.life[playerId] !== undefined) delete ctx.life[playerId];
    if (ctx.poison && ctx.poison[playerId] !== undefined)
      delete ctx.poison[playerId];
    if (ctx.experience && ctx.experience[playerId] !== undefined)
      delete ctx.experience[playerId];
    if (ctx.grants instanceof Map) {
      for (const [owner, set] of ctx.grants.entries()) {
        if (set instanceof Set && set.has(playerId)) set.delete(playerId);
      }
    }
    try {
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {}
  } catch (err) {
    debugWarn(1, "remove fallback failed:", err);
  }
}
