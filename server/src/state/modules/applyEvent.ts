// server/src/state/modules/applyEvent.ts
// Event application / replay / reset helpers.
//
// Exports:
// - applyEvent(ctx, e)
// - replay(ctx, events)
// - reset(ctx, preservePlayers)
// - skip(ctx, playerId)
// - unskip(ctx, playerId)
// - remove(ctx, playerId)
//
// Defensive implementation: tolerates unknown event types and missing engine helpers.

import type { GameContext } from "../context";
import type { PlayerID, GameEvent } from "../types";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  searchLibrary,
  reconcileZonesConsistency,
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
import { pushStack, resolveTopOfStack, playLand, castSpell } from "./stack";
import { nextTurn, nextStep, passPriority } from "./turn";
import { join, leave as leaveModule } from "./join";

/* -------- Helpers ---------- */

/**
 * reset(ctx, preservePlayers)
 * Conservative fallback reset used when no specialized engine reset is available.
 */
export function reset(ctx: any, preservePlayers = false): void {
  if (!ctx) throw new Error("reset: missing ctx");

  // Prefer specialized reset if present on ctx or a global replayModule
  try {
    // @ts-ignore - global replayModule if present
    if (
      typeof (global as any).replayModule !== "undefined" &&
      (global as any).replayModule &&
      typeof (global as any).replayModule.reset === "function"
    ) {
      (global as any).replayModule.reset(ctx, preservePlayers);
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
      console.warn("reset: ctx.reset threw, falling back:", err);
    }
  }

  // Fallback conservative reset
  try {
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

    // Reset primary runtime containers
    ctx.state = ctx.state || {};
    ctx.state.battlefield = [];
    ctx.state.stack = [];
    ctx.state.commandZone = {};
    ctx.state.zones = ctx.state.zones || {};
    ctx.libraries = ctx.libraries || new Map<string, any[]>();
    ctx.life = ctx.life || {};
    ctx.poison = ctx.poison || {};
    ctx.experience = ctx.experience || {};

    // If preserving players, keep entries for those playerIds; otherwise clear players
    if (!preservePlayers) {
      ctx.state.players = [];
      ctx.life = {};
      ctx.poison = {};
      ctx.experience = {};
    } else {
      // ensure each known player has cleared zones & libraries
      const pids = participantsBackup.length
        ? participantsBackup.map((p) => p.playerId).filter(Boolean)
        : (Object.keys(ctx.state.zones || {}) as string[]);
      for (const pid of pids) {
        ctx.state.zones[pid] = ctx.state.zones[pid] || {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
        };
        ctx.state.zones[pid].hand = [];
        ctx.state.zones[pid].handCount = 0;
        if (ctx.libraries && typeof ctx.libraries.set === "function")
          ctx.libraries.set(pid, []);
        else (ctx.libraries as any)[pid] = [];
        ctx.state.zones[pid].libraryCount = 0;
        ctx.state.zones[pid].graveyard =
          ctx.state.zones[pid].graveyard || [];
        ctx.state.zones[pid].graveyardCount = (
          ctx.state.zones[pid].graveyard || []
        ).length;
        ctx.life[pid] = ctx.state.startingLife ?? ctx.life[pid] ?? 40;
        if (ctx.poison) ctx.poison[pid] = 0;
        if (ctx.experience) ctx.experience[pid] = 0;
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

    // Reset bump/seq if present
    try {
      if (ctx.seq && typeof ctx.seq === "object" && "value" in ctx.seq)
        ctx.seq.value = 0;
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn("reset fallback failed:", err);
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
    console.warn("skip fallback failed:", err);
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
    console.warn("unskip fallback failed:", err);
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
    if ((ctx as any).zones && (ctx as any).zones[playerId])
      delete (ctx as any).zones[playerId];
    if (ctx.life && ctx.life[playerId] !== undefined) delete ctx.life[playerId];
    if (ctx.poison && ctx.poison[playerId] !== undefined)
      delete ctx.poison[playerId];
    if (ctx.experience && ctx.experience[playerId] !== undefined)
      delete ctx.experience[playerId];
    if (ctx.grants instanceof Map) {
      for (const [owner, set] of Array.from(ctx.grants.entries())) {
        if (set instanceof Set && set.has(playerId)) set.delete(playerId);
      }
    }
    try {
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {}
  } catch (err) {
    console.warn("remove fallback failed:", err);
  }
}

/* -------- Core applyEvent implementation ---------- */

/**
 * Apply a single persisted game event into the provided GameContext.
 * Tolerant: unknown event types are logged and ignored.
 */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  if (!e || typeof e.type !== "string") return;

  try {
    switch (e.type) {
      case "rngSeed": {
        ctx.rngSeed = (e as any).seed >>> 0;
        // mulberry32 inline
        ctx.rng = (function (seed: number) {
          let t = seed >>> 0;
          return function () {
            t = (t + 0x6d2b79f5) >>> 0;
            let r = t;
            r = Math.imul(r ^ (r >>> 15), r | 1);
            r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          };
        })(ctx.rngSeed);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "setTurnDirection": {
        (ctx.state as any).turnDirection = (e as any).direction;
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "join": {
        // Rebuild roster entries when replaying from persisted events.
        // Socket join flow handles live connections; this is strictly for replay-after-restart.
        const pid = (e as any).playerId as PlayerID | undefined;
        const name = (e as any).name as string | undefined;
        const seatToken = (e as any).seatToken as string | undefined;
        const spectator = Boolean((e as any).spectator);

        if (!pid || !name) {
          break;
        }

        try {
          (ctx.state as any).players = (ctx.state as any).players || [];
          const playersArr = (ctx.state as any).players as any[];
          let existing = playersArr.find((p: any) => p.id === pid);
          if (!existing) {
            existing = {
              id: pid,
              name,
              spectator,
              seatToken,
            };
            playersArr.push(existing);
          } else {
            // Ensure basic fields are set
            if (!existing.name) existing.name = name;
            if (typeof existing.spectator === "undefined")
              existing.spectator = spectator;
            if (!existing.seatToken && seatToken)
              existing.seatToken = seatToken;
          }
          // Zones will be normalized by reconcileZonesConsistency after replay.
        } catch (err) {
          console.warn("applyEvent(join): failed to rebuild player", err);
        }
        break;
      }

      case "leave":
        // leave handled by socket lifecycle; for replay we currently do not strip players
        break;

      case "restart": {
        reset(ctx as any, Boolean((e as any).preservePlayers));
        break;
      }

      case "resetGame": {
        // historical event alias - map to the restart/reset semantics
        const preserve =
          (e as any).preservePlayers ?? (e as any).preserve ?? false;
        reset(ctx as any, Boolean(preserve));
        break;
      }

      case "removePlayer": {
        remove(ctx as any, (e as any).playerId);
        break;
      }

      case "skipPlayer": {
        skip(ctx as any, (e as any).playerId);
        break;
      }

      case "unskipPlayer": {
        unskip(ctx as any, (e as any).playerId);
        break;
      }

      case "spectatorGrant": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.add(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "spectatorRevoke": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.delete(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "deckImportResolved": {
        importDeckResolved(
          ctx as any,
          (e as any).playerId,
          (e as any).cards || []
        );
        break;
      }

      case "shuffleLibrary": {
        shuffleLibrary(ctx as any, (e as any).playerId);
        break;
      }

      case "drawCards": {
        drawCards(
          ctx as any,
          (e as any).playerId,
          (e as any).count || 1
        );
        break;
      }

      case "selectFromLibrary": {
        selectFromLibrary(
          ctx as any,
          (e as any).playerId,
          (e as any).cardIds || [],
          (e as any).moveTo
        );
        break;
      }

      case "handIntoLibrary": {
        moveHandToLibrary(ctx as any, (e as any).playerId);
        break;
      }

      case "setCommander": {
        setCommander(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderNames || [],
          (e as any).commanderIds || [],
          (e as any).colorIdentity || []
        );
        break;
      }

      case "castCommander": {
        castCommander(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderId
        );
        break;
      }

      case "moveCommanderToCZ": {
        moveCommanderToCZ(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderId
        );
        break;
      }

      case "updateCounters": {
        updateCounters(
          ctx as any,
          (e as any).permanentId,
          (e as any).deltas || {}
        );
        break;
      }

      case "updateCountersBulk": {
        applyUpdateCountersBulk(ctx as any, (e as any).updates || []);
        break;
      }

      case "createToken": {
        createToken(
          ctx as any,
          (e as any).controller,
          (e as any).name,
          (e as any).count,
          (e as any).basePower,
          (e as any).baseToughness
        );
        break;
      }

      case "removePermanent": {
        removePermanent(ctx as any, (e as any).permanentId);
        break;
      }

      case "dealDamage": {
        const effects: any[] = (e as any).effects || [];
        try {
          applyEngineEffects(ctx as any, effects);
        } catch {}
        try {
          runSBA(ctx as any);
        } catch {}
        break;
      }

      case "resolveSpell": {
        // Engine-driven resolution handled elsewhere
        break;
      }

      case "pushStack": {
        pushStack(ctx as any, (e as any).item);
        break;
      }

      case "resolveTopOfStack": {
        resolveTopOfStack(ctx as any);
        break;
      }

      case "playLand": {
        playLand(ctx as any, (e as any).playerId, (e as any).cardId || (e as any).card);
        break;
      }

      case "castSpell": {
        castSpell(
          ctx as any, 
          (e as any).playerId, 
          (e as any).cardId || (e as any).card,
          (e as any).targets
        );
        break;
      }

      case "nextTurn": {
        nextTurn(ctx as any);
        break;
      }

      case "nextStep": {
        nextStep(ctx as any);
        break;
      }

      case "reorderHand": {
        zonesReorderHand(
          ctx as any,
          (e as any).playerId,
          (e as any).order || []
        );
        break;
      }

      case "shuffleHand": {
        zonesShuffleHand(ctx as any, (e as any).playerId);
        break;
      }

      case "scryResolve": {
        applyScry(
          ctx as any,
          (e as any).playerId,
          (e as any).keepTopOrder || [],
          (e as any).bottomOrder || []
        );
        break;
      }

      case "surveilResolve": {
        applySurveil(
          ctx as any,
          (e as any).playerId,
          (e as any).toGraveyard || [],
          (e as any).keepTopOrder || []
        );
        break;
      }

      case "passPriority": {
        const by = (e as any).by;
        try {
          if (typeof passPriority === "function")
            passPriority(ctx as any, by);
        } catch {}
        break;
      }

      default: {
        console.warn("applyEvent: unknown event type", (e as any).type);
        break;
      }
    }
  } catch (err) {
    console.warn("applyEvent: failed to apply event", (e as any).type, err);
  }
}

/**
 * Replay a sequence of persisted events into ctx.
 * Special-case passPriority events to call passPriority directly for safety.
 */
export function replay(ctx: GameContext, events: GameEvent[]) {
  if (!Array.isArray(events)) return;
  for (const e of events) {
    if (!e || typeof e.type !== "string") continue;
    if (e.type === "passPriority") {
      try {
        if (typeof passPriority === "function")
          passPriority(ctx as any, (e as any).by);
      } catch (err) {
        console.warn("replay: passPriority failed", err);
      }
      continue;
    }
    applyEvent(ctx, e);
  }

  try {
    reconcileZonesConsistency(ctx as any);
  } catch (err) {
    /* swallow */
  }
}