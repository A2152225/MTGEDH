import { createContext } from "./context";
import type { InMemoryGame, GameID, GameEvent } from "./types";
import type { PlayerID, KnownCardRef } from "./types";

import { join, leave, disconnect, participants } from "./modules/join";
import { passPriority, setTurnDirection } from "./modules/priority";
import { nextTurn, nextStep } from "./modules/turn";
import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  searchLibrary,
  reconcileZonesConsistency
} from "./modules/zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./modules/commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  movePermanentToExile,
  applyEngineEffects,
  runSBA
} from "./modules/counters_tokens";
import { pushStack, resolveTopOfStack, playLand } from "./modules/stack";
import { viewFor } from "./modules/view";
import {
  applyEvent,
  replay,
  reorderHand,
  shuffleHand,
  peekTopN,
  applyScry,
  applySurveil,
  reset,
  skip,
  unskip
} from "./modules/replay";

/**
 * Public factory returning same surface as original monolithic gameState.ts
 */
export function createInitialGameState(gameId: GameID): InMemoryGame {
  const ctx = createContext(gameId);

  return {
    state: ctx.state,
    get seq() { return ctx.seq.value; },
    set seq(v: number) { ctx.seq.value = v; },

    join: (socketId, playerName, spectator, fixedPlayerId, seatToken) =>
      join(ctx, socketId, playerName, spectator, fixedPlayerId, seatToken),
    leave: (playerId?: PlayerID) => leave(ctx, playerId),
    disconnect: (socketId: string) => disconnect(ctx, socketId),
    participants: () => participants(ctx),

    passPriority: (playerId: PlayerID) => passPriority(ctx, playerId),
    setTurnDirection: (dir: 1 | -1) => setTurnDirection(ctx, dir),
    nextTurn: () => nextTurn(ctx),
    nextStep: () => nextStep(ctx),

    flagPendingOpeningDraw: (playerId: PlayerID) => ctx.pendingInitialDraw.add(playerId),

    importDeckResolved: (playerId, cards) => importDeckResolved(ctx, playerId, cards),
    shuffleLibrary: (playerId) => shuffleLibrary(ctx, playerId),
    drawCards: (playerId, count) => drawCards(ctx, playerId, count),
    selectFromLibrary: (playerId, cardIds, moveTo) => selectFromLibrary(ctx, playerId, cardIds, moveTo),
    moveHandToLibrary: (playerId) => moveHandToLibrary(ctx, playerId),
    searchLibrary: (playerId, query, limit) => searchLibrary(ctx, playerId, query, limit),

    grantSpectatorAccess: (owner, spectator) => {
      const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
      set.add(spectator);
      ctx.grants.set(owner, set);
      ctx.bumpSeq();
    },
    revokeSpectatorAccess: (owner, spectator) => {
      const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
      set.delete(spectator);
      ctx.grants.set(owner, set);
      ctx.bumpSeq();
    },

    viewFor: (viewer, spectator) => viewFor(ctx, viewer, spectator),
    seedRng: (seed: number) => {
      ctx.rngSeed = seed >>> 0;
      ctx.rng = (function(seed: number) {
        let t = seed;
        return () => {
          t = (t + 0x6D2B79F5) >>> 0;
          let r = t;
          r = Math.imul(r ^ (r >>> 15), r | 1);
          r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
          return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
      })(ctx.rngSeed);
    },
    hasRngSeed: () => ctx.rngSeed !== null,

    setCommander: (playerId, names, ids, ci) => setCommander(ctx, playerId, names, ids, ci),
    castCommander: (playerId, commanderId) => castCommander(ctx, playerId, commanderId),
    moveCommanderToCZ: (playerId, commanderId) => moveCommanderToCZ(ctx, playerId, commanderId),

    updateCounters: (permId, deltas) => updateCounters(ctx, permId, deltas),
    updateCountersBulk: (updates) => applyUpdateCountersBulk(ctx, updates),
    createToken: (controller, name, count, bp, bt) => createToken(ctx, controller, name, count, bp, bt),
    removePermanent: (permId) => removePermanent(ctx, permId),
    movePermanentToExile: (permId) => movePermanentToExile(ctx, permId),
    applyEngineEffects: (effects) => applyEngineEffects(ctx, effects),

    pushStack: (item) => pushStack(ctx, item),
    resolveTopOfStack: () => resolveTopOfStack(ctx),
    playLand: (playerId, card) => playLand(ctx, playerId, card),

    applyEvent: (e: GameEvent) => applyEvent(ctx, e),
    replay: (events: GameEvent[]) => replay(ctx, events),

    reset: (preservePlayers: boolean) => reset(ctx, preservePlayers),
    skip: (playerId: PlayerID) => skip(ctx, playerId),
    unskip: (playerId: PlayerID) => unskip(ctx, playerId),
    remove: (playerId: PlayerID) => leave(ctx, playerId),

    reorderHand: (playerId, order) => reorderHand(ctx, playerId, order),
    shuffleHand: (playerId) => shuffleHand(ctx, playerId),

    peekTopN: (playerId, n) => peekTopN(ctx, playerId, n),
    applyScry: (playerId, keepTopOrder, bottomOrder) => applyScry(ctx, playerId, keepTopOrder, bottomOrder),
    applySurveil: (playerId, toGraveyard, keepTopOrder) => applySurveil(ctx, playerId, toGraveyard, keepTopOrder)
  };
}