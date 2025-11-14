import { createContext } from "./context";
import type { InMemoryGame, GameEvent } from "./types";
import type { PlayerID, KnownCardRef } from "./types";

import { join, leave, disconnect, participants } from "./modules/join";
import { passPriority, setTurnDirection } from "./modules/priority";
import {
  nextTurn,
  nextStep,
  scheduleStepsAfterCurrent,
  scheduleStepsAtEndOfTurn,
  clearScheduledSteps,
  getScheduledSteps,
  removeScheduledSteps,
} from "./modules/turn";
import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  searchLibrary,
  reconcileZonesConsistency,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
} from "./modules/zones";
import { applyScry, applySurveil } from "./modules/zones_helpers";
import { setCommander, castCommander, moveCommanderToCZ } from "./modules/commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  movePermanentToExile,
  applyEngineEffects,
  runSBA,
} from "./modules/counters_tokens";
import { pushStack, resolveTopOfStack, playLand, exileEntireStack } from "./modules/stack";
import { viewFor } from "./modules/view";
import { applyEvent, replay, reset, skip, unskip, remove } from "./modules/applyEvent";
import { mulberry32 } from "../utils/rng";

/**
 * Create a public InMemoryGame surface that delegates to the ctx + modules.
 * This wrapper preserves the monolithic API surface used by socket handlers.
 */
export function createInitialGameState(gameId: string): InMemoryGame {
  const ctx = createContext(gameId);

  const game: InMemoryGame = {
    // core state and seq
    state: ctx.state,

    get seq() {
      const s = (ctx as any).seq;
      return s && typeof s === "object" && "value" in s ? s.value : s;
    },
    set seq(v: number) {
      const s = (ctx as any).seq;
      if (s && typeof s === "object" && "value" in s) s.value = v;
      else (ctx as any).seq = v;
    },

    // lifecycle / participants
    join: (socketId, playerName, spectator, fixedPlayerId, seatTokenFromClient) =>
      join(ctx, socketId, playerName, spectator, fixedPlayerId, seatTokenFromClient),
    leave: (playerId?: PlayerID) => leave(ctx, playerId),
    disconnect: (socketId: string) => disconnect(ctx, socketId),
    participants: () => participants(ctx),

    // priority / turn control
    passPriority: (playerId: PlayerID) => passPriority(ctx, playerId),
    setTurnDirection: (dir: 1 | -1) => setTurnDirection(ctx, dir),
    nextTurn: () => nextTurn(ctx),
    nextStep: () => nextStep(ctx),

    // RNG helpers
    seedRng: (seed: number) =>
      (ctx as any).seedRng
        ? (ctx as any).seedRng(seed)
        : ((ctx.rngSeed = seed >>> 0), (ctx.rng = (mulberry32 as any)(seed)), ctx.bumpSeq()),
    hasRngSeed: () => !!(ctx.rngSeed),

    // spectator grants
    grantSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => {
      try {
        if (typeof (ctx as any).grantSpectatorAccess === "function") {
          (ctx as any).grantSpectatorAccess(owner, spectator);
        } else {
          const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
          set.add(spectator);
          ctx.grants.set(owner, set);
          ctx.seq && (ctx.seq as any).value !== undefined ? (ctx.seq as any).value++ : (ctx as any).seq++;
        }
      } catch (err) {
        console.warn("grantSpectatorAccess fallback failed:", err);
      }
    },
    revokeSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => {
      try {
        if (typeof (ctx as any).revokeSpectatorAccess === "function") {
          (ctx as any).revokeSpectatorAccess(owner, spectator);
        } else {
          const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
          set.delete(spectator);
          ctx.grants.set(owner, set);
          ctx.seq && (ctx.seq as any).value !== undefined ? (ctx.seq as any).value++ : (ctx as any).seq++;
        }
      } catch (err) {
        console.warn("revokeSpectatorAccess fallback failed:", err);
      }
    },

    // pending opening draw (Commander)
    flagPendingOpeningDraw: (playerId: PlayerID) => ctx.pendingInitialDraw.add(playerId),
    pendingInitialDraw: ctx.pendingInitialDraw,

    // deck / zones
    importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, any>>) =>
      importDeckResolved(ctx, playerId, cards),
    shuffleLibrary: (playerId: PlayerID) => shuffleLibrary(ctx, playerId),
    drawCards: (playerId: PlayerID, count: number) => drawCards(ctx, playerId, count),
    selectFromLibrary: (playerId: PlayerID, cardIds: string[], moveTo: any) =>
      selectFromLibrary(ctx, playerId, cardIds, moveTo),
    moveHandToLibrary: (playerId: PlayerID) => moveHandToLibrary(ctx, playerId),
    searchLibrary: (playerId: PlayerID, query: string, limit: number) => searchLibrary(ctx, playerId, query, limit),

    // zone helpers
    reconcileZonesConsistency: (playerId?: PlayerID) => reconcileZonesConsistency(ctx, playerId),
    reorderHand: (playerId: PlayerID, order: number[]) => zonesReorderHand(ctx, playerId, order),
    shuffleHand: (playerId: PlayerID) => zonesShuffleHand(ctx, playerId),
    peekTopN: (playerId: PlayerID, n: number) => peekTopN(ctx, playerId, n),
    applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) =>
      applyScry(ctx, playerId, keepTopOrder, bottomOrder),
    applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) =>
      applySurveil(ctx, playerId, toGraveyard, keepTopOrder),

    // commander
    setCommander: (playerId: PlayerID, commanderNames: string[], commanderIds?: string[], colorIdentity?: any) =>
      setCommander(ctx, playerId, commanderNames, commanderIds || [], colorIdentity),
    castCommander: (playerId: PlayerID, commanderId: string) => castCommander(ctx, playerId, commanderId),
    moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => moveCommanderToCZ(ctx, playerId, commanderId),

    // convenience commander info helper
    getCommanderInfo: (playerId: PlayerID) => {
      try {
        const cz = (ctx.state && (ctx.state as any).commandZone && (ctx.state as any).commandZone[playerId]) || null;
        if (!cz) return null;
        return { commanderIds: cz.commanderIds || [], commanderCards: cz.commanderCards || null };
      } catch {
        return null;
      }
    },

    // counters/tokens/engine
    updateCounters: (permanentId: string, deltas: Record<string, number>) => updateCounters(ctx, permanentId, deltas),
    applyUpdateCountersBulk: (updates) => applyUpdateCountersBulk(ctx, updates),
    createToken: (controller: PlayerID, name: string, count?: number, basePower?: number, baseToughness?: number) =>
      createToken(ctx, controller, name, count, basePower, baseToughness),
    removePermanent: (permanentId: string) => removePermanent(ctx, permanentId),
    movePermanentToExile: (permanentId: string) => movePermanentToExile(ctx, permanentId),
    applyEngineEffects: (effects: readonly any[]) => applyEngineEffects(ctx, effects),
    runSBA: (playerId: PlayerID) => runSBA(ctx, playerId),

    // stack
    pushStack: (item) => pushStack(ctx, item),
    resolveTopOfStack: () => resolveTopOfStack(ctx),
    exileStack: (playerId?: PlayerID) => exileEntireStack(ctx, playerId),

    // play helpers
    playLand: (playerId: PlayerID, card) => playLand(ctx, playerId, card),

    // view
    viewFor: (viewer?: PlayerID, spectator?: boolean) => viewFor(ctx, viewer, !!spectator),

    // step scheduling helpers (runtime-only)
    scheduleStepsAfterCurrent: (steps: any[]) => scheduleStepsAfterCurrent(ctx, steps),
    scheduleStepsAtEndOfTurn: (steps: any[]) => scheduleStepsAtEndOfTurn(ctx, steps),
    clearScheduledSteps: () => clearScheduledSteps(ctx),
    getScheduledSteps: () => getScheduledSteps(ctx),
    removeScheduledSteps: (steps: any[]) => removeScheduledSteps(ctx, steps),

    // event lifecycle / apply/replay/reset/skip/unskip/remove delegated to module
    applyEvent: (e: GameEvent) => applyEvent(ctx, e),
    replay: (events: GameEvent[]) => replay(ctx, events),
    reset: (preservePlayers: boolean) => reset(ctx, preservePlayers),
    skip: (playerId: PlayerID) => skip(ctx, playerId),
    unskip: (playerId: PlayerID) => unskip(ctx, playerId),
    remove: (playerId: PlayerID) => remove(ctx, playerId),
  };

  // runtime aliases for compatibility with older callers
  (game as any).pendingInitialDraw = ctx.pendingInitialDraw;
  Object.defineProperty(game, "seqValue", {
    get: () => game.seq,
    enumerable: false,
    configurable: true,
  });

  return game;
}