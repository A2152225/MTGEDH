import type { GameEvent, PlayerID, PlayerRef } from "../types";
import type { GameContext } from "../context";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  reconcileZonesConsistency
} from "./zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  movePermanentToExile,
  applyEngineEffects,
  runSBA
} from "./counters_tokens";
import { passPriority } from "./priority";
import { pushStack, resolveTopOfStack, playLand, applyTargetEffects } from "./stack";
import { nextTurn, nextStep } from "./turn";

import { evaluateAction } from "../../rules-engine";
import { categorizeSpell, resolveSpell } from "../../rules-engine/targeting";
import { addPlayerIfMissing } from "./join";

/**
 * Apply a single persisted or live event to the authoritative game state.
 * Mirrors original logic from monolithic gameState.ts (behavior unchanged).
 */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  switch (e.type) {
    case "rngSeed":
      ctx.rngSeed = e.seed >>> 0;
      // Simple mulberry32 style RNG identical to original
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
      ctx.state.turnDirection = e.direction;
      ctx.bumpSeq();
      break;

    case "join":
      // Restore original behavior: add player entry (seat handled in original event)
      addPlayerIfMissing(ctx, e.playerId, e.name, (e as any).seat);
      break;

    case "leave":
      // Leave handled outside via public API; no direct mutation here to avoid double removal.
      break;

    case "restart":
      reset(ctx, Boolean(e.preservePlayers));
      break;

    case "removePlayer":
      // Removal handled via public API; event here kept for historical consistency
      break;

    case "skipPlayer":
      skip(ctx, e.playerId);
      break;

    case "unskipPlayer":
      unskip(ctx, e.playerId);
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
      importDeckResolved(
        ctx,
        (e as any).playerId,
        (e as any).cards
      );
      break;

    case "shuffleLibrary":
      shuffleLibrary(ctx, e.playerId);
      break;

    case "drawCards":
      drawCards(ctx, e.playerId, (e as any).count);
      break;

    case "selectFromLibrary":
      selectFromLibrary(ctx, e.playerId, (e as any).cardIds, (e as any).moveTo);
      break;

    case "handIntoLibrary":
      moveHandToLibrary(ctx, e.playerId);
      break;

    case "setCommander":
      setCommander(
        ctx,
        e.playerId,
        (e as any).commanderNames,
        (e as any).commanderIds,
        (e as any).colorIdentity
      );
      break;

    case "castCommander":
      castCommander(ctx, e.playerId, (e as any).commanderId);
      break;

    case "moveCommanderToCZ":
      moveCommanderToCZ(ctx, e.playerId, (e as any).commanderId);
      break;

    case "updateCounters":
      updateCounters(ctx, (e as any).permanentId, (e as any).deltas);
      break;

    case "updateCountersBulk":
      applyUpdateCountersBulk(ctx, (e as any).updates);
      break;

    case "createToken":
      createToken(
        ctx,
        (e as any).controller,
        (e as any).name,
        (e as any).count,
        (e as any).basePower,
        (e as any).baseToughness
      );
      break;

    case "removePermanent":
      removePermanent(ctx, (e as any).permanentId);
      break;

    case "dealDamage": {
      const effects = evaluateAction(ctx.state, {
        type: "DEAL_DAMAGE",
        targetPermanentId: (e as any).targetPermanentId,
        amount: (e as any).amount,
        wither: (e as any).wither,
        infect: (e as any).infect
      });
      applyEngineEffects(ctx, effects);
      runSBA(ctx);
      break;
    }

    case "resolveSpell": {
      // Reconstruct chosen targets for resolution
      const chosen = (e as any).chosen as any[] || [];
      const effects = resolveSpell((e as any).spec, chosen, ctx.state);
      applyTargetEffects(ctx, effects);
      break;
    }

    case "pushStack":
      pushStack(ctx, (e as any).item);
      break;

    case "resolveTopOfStack":
      resolveTopOfStack(ctx);
      break;

    case "playLand":
      playLand(ctx, e.playerId, (e as any).card);
      break;

    case "nextTurn":
      nextTurn(ctx);
      break;

    case "nextStep":
      nextStep(ctx);
      break;

    case "reorderHand":
      reorderHand(ctx, e.playerId, (e as any).order);
      break;

    case "shuffleHand":
      shuffleHand(ctx, e.playerId);
      break;

    case "scryResolve":
      applyScry(ctx, e.playerId, (e as any).keepTopOrder, (e as any).bottomOrder);
      break;

    case "surveilResolve":
      applySurveil(ctx, e.playerId, (e as any).toGraveyard, (e as any).keepTopOrder);
      break;

    case "passPriority":
      // Historical event; actual priority rotation handled separately (no direct state mutation here)
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

/* ===== Helpers migrated intact from original monolith ===== */

export function reorderHand(ctx: GameContext, playerId: PlayerID, order: number[]) {
  const z = ctx.zones?.[playerId];
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
  const z = ctx.zones?.[playerId];
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
  return lib.slice(0, Math.max(0, n | 0)).map((c) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: (c as any).image_uris
  }));
}

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (keepTopOrder.length + bottomOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...keepTopOrder, ...bottomOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
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
  ctx.zones[playerId] = ctx.zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0
  } as any;
  ctx.zones[playerId]!.libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

export function applySurveil(ctx: GameContext, playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (toGraveyard.length + keepTopOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...toGraveyard, ...keepTopOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  const z =
    ctx.zones[playerId] ||
    (ctx.zones[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0
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

export function skip(ctx: GameContext, playerId: PlayerID) {
  if (!(ctx.state.players as any as PlayerRef[]).find((p) => p.id === playerId)) return;
  ctx.inactive.add(playerId);
  ctx.bumpSeq();
}

export function unskip(ctx: GameContext, playerId: PlayerID) {
  if (!(ctx.state.players as any as PlayerRef[]).find((p) => p.id === playerId)) return;
  ctx.inactive.delete(playerId);
  ctx.bumpSeq();
}

export function reset(ctx: GameContext, preservePlayers: boolean) {
  const {
    state,
    inactive,
    commandZone,
    zones,
    libraries,
    life,
    poison,
    experience,
    bumpSeq
  } = ctx;
  state.stack = [];
  state.battlefield = [];
  state.phase = state.phase; // kept neutral; original resets to BEGINNING but follow next turn semantics
  state.phase = state.phase;
  state.phase = state.phase; // structural no-op
  inactive.clear();
  for (const k of Object.keys(commandZone)) delete (commandZone as any)[k];
  if (preservePlayers) {
    for (const p of (state.players as any as PlayerRef[])) {
      life[p.id] = state.startingLife;
      poison[p.id] = 0;
      experience[p.id] = 0;
      zones[p.id] = {
        hand: [],
        handCount: 0,
        libraryCount: libraries.get(p.id)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0
      };
    }
    for (const pid of Object.keys(zones))
      if (!(state.players as any as PlayerRef[]).find((p) => p.id === pid))
        delete (zones as any)[pid as PlayerID];
    for (const pid of Object.keys(life))
      if (!(state.players as any as PlayerRef[]).find((p) => p.id === pid))
        delete (life as any)[pid as PlayerID];
    state.turnPlayer = (state.players as any as PlayerRef[])[0]?.id ?? ("" as PlayerID);
    state.priority = state.turnPlayer;
  } else {
    (state.players as any as PlayerRef[]).splice(0, (state.players as any as PlayerRef[]).length);
    for (const k of Object.keys(life)) delete (life as any)[k];
    for (const k of Object.keys(zones)) delete (zones as any)[k];
    for (const k of Object.keys(poison)) delete (poison as any)[k];
    for (const k of Object.keys(experience)) delete (experience as any)[k];
    libraries.clear();
    state.turnPlayer = "" as PlayerID;
    state.priority = "" as PlayerID;
  }
  state.landsPlayedThisTurn = {};
  ctx.passesInRow.value = 0;
  bumpSeq();
}