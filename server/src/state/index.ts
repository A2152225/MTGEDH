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
  reconcileZonesConsistency,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  applyScry,
  applySurveil,
} from "./modules/zones";
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
import { pushStack, resolveTopOfStack, playLand } from "./modules/stack";
import { viewFor } from "./modules/view";
import {
  applyEvent,
  replay as replayEvents,
  reset as resetGame,
  skip as skipPlayer,
  unskip as unskipPlayer,
  remove as removePlayer,
} from "./modules/applyEvent";

/**
 * Factory that returns the full game surface expected by socket handlers.
 * Delegates to the ctx and modules so logic remains pure and centralized.
 */
export function createInitialGameState(gameId: GameID): InMemoryGame {
  const ctx = createContext(gameId);

  // helper to access seq whether stored as { value } or plain number
  const getSeq = () => {
    const s = (ctx as any).seq;
    return s && typeof s === "object" && "value" in s ? s.value : s;
  };
  const setSeq = (v: number) => {
    const s = (ctx as any).seq;
    if (s && typeof s === "object" && "value" in s) s.value = v;
    else (ctx as any).seq = v;
  };

  const game: InMemoryGame = {
    // core state
    state: ctx.state,

    // seq accessor compatible with older and newer ctx shapes
    get seq() {
      return getSeq();
    },
    set seq(v: number) {
      setSeq(v);
    },

    // connection / participant management
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

    // deck / zones API
    importDeckResolved: (playerId, cards) => importDeckResolved(ctx, playerId, cards),
    shuffleLibrary: (playerId: PlayerID) => shuffleLibrary(ctx, playerId),
    drawCards: (playerId: PlayerID, count: number) => drawCards(ctx, playerId, count),
    selectFromLibrary: (playerId, cardIds, moveTo) => selectFromLibrary(ctx, playerId, cardIds, moveTo),
    moveHandToLibrary: (playerId: PlayerID) => moveHandToLibrary(ctx, playerId),
    searchLibrary: (playerId: PlayerID, query: string, limit: number) => searchLibrary(ctx, playerId, query, limit),

    // legacy / utility zone helpers
    reconcileZonesConsistency: (playerId?: PlayerID) => reconcileZonesConsistency(ctx, playerId),
    reorderHand: (playerId: PlayerID, order: number[]) => zonesReorderHand(ctx, playerId, order),
    shuffleHand: (playerId: PlayerID) => zonesShuffleHand(ctx, playerId),
    peekTopN: (playerId: PlayerID, n: number) => peekTopN(ctx, playerId, n),
    applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) =>
      applyScry(ctx, playerId, keepTopOrder, bottomOrder),
    applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) =>
      applySurveil(ctx, playerId, toGraveyard, keepTopOrder),

    // commander
    setCommander: (playerId: PlayerID, names: string[], ids?: string[], colorIdentity?: ("W" | "U" | "B" | "R" | "G")[]) =>
      setCommander(ctx, playerId, names, ids || [], colorIdentity),
    castCommander: (playerId: PlayerID, commanderId: string) => castCommander(ctx, playerId, commanderId),
    moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => moveCommanderToCZ(ctx, playerId, commanderId),

    // counters / tokens / engine
    updateCounters: (permanentId, deltas) => updateCounters(ctx, permanentId, deltas),
    applyUpdateCountersBulk: (updates) => applyUpdateCountersBulk(ctx, updates),
    createToken: (controller, name, count, basePower, baseToughness) =>
      createToken(ctx, controller, name, count, basePower, baseToughness),
    removePermanent: (permanentId: string) => removePermanent(ctx, permanentId),
    movePermanentToExile: (permanentId: string) => movePermanentToExile(ctx, permanentId),
    applyEngineEffects: (effects: readonly any[]) => applyEngineEffects(ctx, effects),
    runSBA: (playerId: PlayerID) => runSBA(ctx, playerId),

    // stack
    pushStack: (item) => pushStack(ctx, item),
    resolveTopOfStack: () => resolveTopOfStack(ctx),
    playLand: (playerId, card) => playLand(ctx, playerId, card),

    // view / RNG
    viewFor: (viewer: PlayerID | undefined, spectator?: boolean) => viewFor(ctx, viewer, !!spectator),
    seedRng: (seed: number) => ctx.seedRng(seed),
    hasRngSeed: () => ctx.hasRngSeed(),

    // pending opening draw helper (kept for compatibility)
    flagPendingOpeningDraw: (playerId: PlayerID) => ctx.pendingInitialDraw.add(playerId),
    // Expose the underlying Set so older socket code that uses game.pendingInitialDraw works
    pendingInitialDraw: ctx.pendingInitialDraw,

    // commander movement helpers (kept earlier)
    moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => moveCommanderToCZ(ctx, playerId, commanderId),

    // event / replay / lifecycle
    applyEvent: (e: GameEvent) => applyEvent(ctx, e),
    replay: (events: GameEvent[]) => replayEvents(ctx, events),
    reset: (preservePlayers: boolean) => resetGame(ctx, preservePlayers),
    skip: (playerId: PlayerID) => skipPlayer(ctx, playerId),
    unskip: (playerId: PlayerID) => unskipPlayer(ctx, playerId),
    remove: (playerId: PlayerID) => removePlayer(ctx, playerId),

    // helper aliases for compatibility (some callers used different names)
    importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">>) =>
      importDeckResolved(ctx, playerId, cards),
  };

  // legacy convenience: attach pendingInitialDraw on the returned object as a runtime alias
  (game as any).pendingInitialDraw = ctx.pendingInitialDraw;

  return game;
}