/**
 * Replayed event application and helpers.
 * This file mirrors the original applyEvent/replay logic from the monolith.
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../types";
import type { GameEvent } from "../types";
import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand,
  shuffleHand,
  peekTopN,
  applyScry,
  applySurveil,
} from "./zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  applyEngineEffects,
  runSBA,
} from "./counters_tokens";
import { pushStack, resolveTopOfStack, playLand } from "./stack";
import { nextTurn, nextStep, passPriority } from "./turn";
import { reconcileZonesConsistency } from "./zones";

/* applyEvent: mirror of monolithic behavior */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  switch (e.type) {
    case "rngSeed":
      ctx.rngSeed = (e as any).seed >>> 0;
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
      ctx.bumpSeq();
      break;

    case "setTurnDirection":
      ctx.state.turnDirection = (e as any).direction;
      ctx.bumpSeq();
      break;

    case "join":
      // join is handled through the join module; skip direct mutation here
      break;

    case "leave":
      break;

    case "restart":
      reset(ctx, Boolean((e as any).preservePlayers));
      break;

    case "removePlayer":
      break;

    case "skipPlayer":
      skip(ctx, (e as any).playerId);
      break;

    case "unskipPlayer":
      unskip(ctx, (e as any).playerId);
      break;

    case "spectatorGrant": {
      const set = ctx.grants.get((e as any).owner) ?? new Set<PlayerID>();
      set.add((e as any).spectator);
      ctx.grants.set((e as any).owner, set);
      ctx.bumpSeq();
      break;
    }

    case "spectatorRevoke": {
      const set = ctx.grants.get((e as any).owner) ?? new Set<PlayerID>();
      set.delete((e as any).spectator);
      ctx.grants.set((e as any).owner, set);
      ctx.bumpSeq();
      break;
    }

    case "deckImportResolved":
      importDeckResolved(ctx, (e as any).playerId, (e as any).cards);
      break;

    case "shuffleLibrary":
      shuffleLibrary(ctx, (e as any).playerId);
      break;

    case "drawCards":
      drawCards(ctx, (e as any).playerId, (e as any).count);
      break;

    case "selectFromLibrary":
      selectFromLibrary(ctx, (e as any).playerId, (e as any).cardIds, (e as any).moveTo);
      break;

    case "handIntoLibrary":
      moveHandToLibrary(ctx, (e as any).playerId);
      break;

    case "setCommander":
      setCommander(ctx, (e as any).playerId, (e as any).commanderNames, (e as any).commanderIds, (e as any).colorIdentity);
      break;

    case "castCommander":
      castCommander(ctx, (e as any).playerId, (e as any).commanderId);
      break;

    case "moveCommanderToCZ":
      moveCommanderToCZ(ctx, (e as any).playerId, (e as any).commanderId);
      break;

    case "updateCounters":
      updateCounters(ctx, (e as any).permanentId, (e as any).deltas);
      break;

    case "updateCountersBulk":
      applyUpdateCountersBulk(ctx, (e as any).updates);
      break;

    case "createToken":
      createToken(ctx, (e as any).controller, (e as any).name, (e as any).count, (e as any).basePower, (e as any).baseToughness);
      break;

    case "removePermanent":
      removePermanent(ctx, (e as any).permanentId);
      break;

    case "dealDamage": {
      const effects: any[] = [];
      applyEngineEffects(ctx, effects);
      runSBA(ctx);
      break;
    }

    case "resolveSpell": {
      // resolution logic omitted — caller should supply spec/resolution
      break;
    }

    case "pushStack":
      pushStack(ctx, (e as any).item);
      break;

    case "resolveTopOfStack":
      resolveTopOfStack(ctx);
      break;

    case "playLand":
      playLand(ctx, (e as any).playerId, (e as any).card);
      break;

    case "nextTurn":
      nextTurn(ctx);
      break;

    case "nextStep":
      nextStep(ctx);
      break;

    case "reorderHand":
      reorderHand(ctx, (e as any).playerId, (e as any).order);
      break;

    case "shuffleHand":
      shuffleHand(ctx, (e as any).playerId);
      break;

    case "scryResolve":
      applyScry(ctx, (e as any).playerId, (e as any).keepTopOrder, (e as any).bottomOrder);
      break;

    case "surveilResolve":
      applySurveil(ctx, (e as any).playerId, (e as any).toGraveyard, (e as any).keepTopOrder);
      break;

    case "passPriority":
      break;
  }
}

/**
 * Replay a sequence of events (persisted) into a fresh context.
 */
export function replay(ctx: GameContext, events: GameEvent[]) {
  for (const e of events) {
    if (e.type === "passPriority") {
      passPriority(ctx, (e as any).by);
    } else {
      applyEvent(ctx, e);
    }
  }
  reconcileZonesConsistency(ctx);
}

/* Helpers ported from original monolith */

export function reorderHand(ctx: GameContext, playerId: PlayerID, order: number[]) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return false;
  const hand = (z.hand as any[]) || [];
  const n = hand.length;
  if (order.length !== n) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (typeof v !== "number" || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  const next: any[] = new Array(n);
  for (let i = 0; i < n; i++) next[i] = hand[order[i]];
  z.hand = next as any;
  z.handCount = next.length;
  ctx.bumpSeq();
  return true;
}

export function shuffleHand(ctx: GameContext, playerId: PlayerID) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return;
  const hand = (z.hand as any[]) || [];
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  z.hand = hand as any;
  z.handCount = hand.length;
  ctx.bumpSeq();
}

export function peekTopN(ctx: GameContext, playerId: PlayerID, n: number) {
  const lib = ctx.libraries.get(playerId) || [];
  return lib.slice(0, Math.max(0, n | 0)).map((c: any) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: (c as any).image_uris,
  }));
}

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (keepTopOrder.length + bottomOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...keepTopOrder, ...bottomOrder]) {
    const idx = lib.findIndex((c: any) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  for (const id of bottomOrder) {
    const c = byId.get(id);
    if (c) lib.push({ ...c, zone: "library" });
  }
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any;
  zones[playerId]!.libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

export function applySurveil(ctx: GameContext, playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (toGraveyard.length + keepTopOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...toGraveyard, ...keepTopOrder]) {
    const idx = lib.findIndex((c: any) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z =
    zones[playerId] ||
    (zones[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    } as any);
  (z as any).graveyard = (z as any).graveyard || [];
  for (const id of toGraveyard) {
    const c = byId.get(id);
    if (c) (z as any).graveyard.push({ ...c, zone: "graveyard", faceDown: false });
  }
  (z as any).graveyardCount = ((z as any).graveyard || []).length;
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  (z as any).libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}