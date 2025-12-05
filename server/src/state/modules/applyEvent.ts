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
  applyExplore,
} from "./zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  applyEngineEffects,
  runSBA,
  movePermanentToExile,
} from "./counters_tokens";
import { pushStack, resolveTopOfStack, playLand, castSpell } from "./stack";
import { nextTurn, nextStep, passPriority } from "./turn";
import { join, leave as leaveModule } from "./join";
import { resolveSpell } from "../../rules-engine/targeting";
import { evaluateAction } from "../../rules-engine/index";
import { mulberry32 } from "../../utils/rng";

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
    // Clear commandZone in place to preserve reference identity
    if (ctx.state.commandZone && typeof ctx.state.commandZone === 'object') {
      for (const key of Object.keys(ctx.state.commandZone)) {
        delete ctx.state.commandZone[key];
      }
    } else {
      ctx.state.commandZone = {};
    }
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
        // Clear hand
        ctx.state.zones[pid].hand = [];
        ctx.state.zones[pid].handCount = 0;
        // Clear library
        if (ctx.libraries && typeof ctx.libraries.set === "function")
          ctx.libraries.set(pid, []);
        else (ctx.libraries as any)[pid] = [];
        ctx.state.zones[pid].libraryCount = 0;
        // Clear graveyard (important for undo to properly restore previous state)
        ctx.state.zones[pid].graveyard = [];
        ctx.state.zones[pid].graveyardCount = 0;
        // Clear exile if it exists
        if (ctx.state.zones[pid].exile !== undefined) {
          ctx.state.zones[pid].exile = [];
          ctx.state.zones[pid].exileCount = 0;
        }
        // Reset life and counters
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
          
          // Set turnPlayer and priority if not already set (non-spectators only)
          // This matches the behavior in join.ts addPlayerIfMissing()
          if (!spectator) {
            if (!(ctx.state as any).turnPlayer) {
              (ctx.state as any).turnPlayer = pid;
            }
            if (!(ctx.state as any).priority) {
              (ctx.state as any).priority = pid;
            }
            
            // Initialize life, poison, experience for non-spectator players
            const startingLife = ctx.state.startingLife ?? 40;
            if (ctx.life) ctx.life[pid] = ctx.life[pid] ?? startingLife;
            if (ctx.poison) ctx.poison[pid] = ctx.poison[pid] ?? 0;
            if (ctx.experience) ctx.experience[pid] = ctx.experience[pid] ?? 0;
            
            // Initialize zones
            const zones = ctx.state.zones = ctx.state.zones || {};
            zones[pid] = zones[pid] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            
            // Initialize landsPlayedThisTurn
            if (ctx.state.landsPlayedThisTurn) {
              ctx.state.landsPlayedThisTurn[pid] = ctx.state.landsPlayedThisTurn[pid] ?? 0;
            }
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
        const pid = (e as any).playerId;
        // Check hand count BEFORE calling setCommander to know if we need opening draw
        const zones = ctx.state.zones || {};
        const zonesBefore = zones[pid];
        const handCountBefore = zonesBefore
          ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
          : 0;
        
        setCommander(
          ctx as any,
          pid,
          (e as any).commanderNames || [],
          (e as any).commanderIds || [],
          (e as any).colorIdentity || []
        );
        
        // For backward compatibility with old games that don't have separate shuffle/draw events:
        // If hand was empty before and is still empty after setCommander, we need to check if
        // the next events include shuffleLibrary/drawCards. If not, we'll do it here.
        // This flag can be checked by the replay function to decide.
        // For now, mark that setCommander was called with empty hand for potential follow-up.
        if (handCountBefore === 0) {
          (ctx as any)._setCommanderCalledWithEmptyHand = pid;
        }
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
        // Handle both legacy effects format and new action format
        let effects: any[] = (e as any).effects || [];
        
        // If targetPermanentId is provided, evaluate using rules engine
        const targetPermanentId = (e as any).targetPermanentId;
        const amount = (e as any).amount;
        if (targetPermanentId && amount > 0) {
          const action = {
            type: 'DEAL_DAMAGE' as const,
            targetPermanentId,
            amount,
            wither: Boolean((e as any).wither),
            infect: Boolean((e as any).infect),
          };
          effects = [...evaluateAction(ctx.state, action)];
        }
        
        try {
          applyEngineEffects(ctx as any, effects);
        } catch {}
        try {
          runSBA(ctx as any);
        } catch {}
        break;
      }

      case "resolveSpell": {
        // Execute spell effects based on spec and chosen targets
        const spec = (e as any).spec;
        const chosen = (e as any).chosen || [];
        
        // Handle COUNTER_TARGET_SPELL specially since it's not in the targeting module
        if (spec?.op === 'COUNTER_TARGET_SPELL') {
          for (const target of chosen) {
            if (target.kind === 'stack') {
              const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === target.id);
              if (stackIdx >= 0) {
                const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                // Move the countered spell to its controller's graveyard
                const controller = (countered as any).controller as PlayerID;
                const zones = ctx.state.zones = ctx.state.zones || {};
                zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                if ((countered as any).card) {
                  gy.push((countered as any).card);
                  (zones[controller] as any).graveyardCount = gy.length;
                }
              }
            }
          }
          ctx.bumpSeq();
          break;
        }
        
        if (spec && typeof resolveSpell === 'function') {
          try {
            const effects = resolveSpell(spec, chosen, ctx.state);
            // Apply each effect
            for (const eff of effects) {
              switch (eff.kind) {
                case 'DestroyPermanent':
                  removePermanent(ctx as any, eff.id);
                  break;
                case 'MoveToExile':
                  movePermanentToExile(ctx as any, eff.id);
                  break;
                case 'DamagePermanent': {
                  // Apply damage to permanent (may kill it via SBA)
                  const perm = ctx.state.battlefield.find((p: any) => p.id === eff.id);
                  if (perm) {
                    (perm as any).damage = ((perm as any).damage || 0) + eff.amount;
                  }
                  break;
                }
                case 'DamagePlayer': {
                  // Reduce player life
                  if (ctx.life && eff.playerId) {
                    ctx.life[eff.playerId] = (ctx.life[eff.playerId] ?? ctx.state.startingLife ?? 40) - eff.amount;
                  }
                  break;
                }
                case 'CounterSpell': {
                  // Counter a spell on the stack
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                    // Move the countered spell to its controller's graveyard
                    const controller = (countered as any).controller as PlayerID;
                    const zones = ctx.state.zones = ctx.state.zones || {};
                    zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                    const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                    if ((countered as any).card) {
                      gy.push({ ...(countered as any).card, zone: 'graveyard' });
                      (zones[controller] as any).graveyardCount = gy.length;
                    }
                  }
                  break;
                }
                case 'CounterAbility': {
                  // Counter an ability on the stack (just remove it)
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    ctx.state.stack.splice(stackIdx, 1);
                  }
                  break;
                }
              }
            }
            // Run state-based actions after applying effects
            runSBA(ctx as any);
            ctx.bumpSeq();
          } catch (err) {
            console.warn('[applyEvent] resolveSpell failed:', err);
          }
        }
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
        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const cardData = (e as any).card || (e as any).cardId;
        playLand(ctx as any, (e as any).playerId, cardData);
        break;
      }

      case "castSpell": {
        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const spellCardData = (e as any).card || (e as any).cardId;
        castSpell(
          ctx as any, 
          (e as any).playerId, 
          spellCardData,
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

      case "exploreResolve": {
        applyExplore(
          ctx as any,
          (e as any).playerId,
          (e as any).permanentId,
          (e as any).revealedCardId,
          (e as any).isLand || false,
          (e as any).toGraveyard || false
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

      case "mulligan": {
        // Mulligan: move hand to library, shuffle, draw 7
        const pid = (e as any).playerId;
        if (!pid) break;
        try {
          moveHandToLibrary(ctx as any, pid);
          shuffleLibrary(ctx as any, pid);
          drawCards(ctx as any, pid, 7);
        } catch (err) {
          console.warn("applyEvent(mulligan): failed", err);
        }
        break;
      }

      case "keepHand": {
        // Mark player as having kept their hand
        // This is important for tracking mulligan state during replay
        const pid = (e as any).playerId;
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = state.mulliganState[pid] || {};
          state.mulliganState[pid].hasKeptHand = true;
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(keepHand): failed", err);
        }
        break;
      }

      case "mulliganPutToBottom": {
        // London mulligan: move selected cards from hand to bottom of library
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        if (!pid || cardIds.length === 0) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          const lib = ctx.libraries.get(pid) || [];
          
          // Move each selected card from hand to bottom of library
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              lib.push({ ...card, zone: "library" });
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.libraryCount = lib.length;
          ctx.libraries.set(pid, lib);
          
          // Mark hand as kept after putting cards on bottom
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = state.mulliganState[pid] || {};
          state.mulliganState[pid].hasKeptHand = true;
          
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(mulliganPutToBottom): failed", err);
        }
        break;
      }

      case "setLife":
      case "adjustLife": {
        // Set or adjust a player's life total
        const pid = (e as any).playerId;
        const life = (e as any).life;
        const delta = (e as any).delta;
        if (!pid) break;
        try {
          if (typeof life === 'number') {
            // Absolute set
            if (ctx.life) ctx.life[pid] = life;
          } else if (typeof delta === 'number') {
            // Relative adjustment
            if (ctx.life) ctx.life[pid] = (ctx.life[pid] ?? ctx.state.startingLife ?? 40) + delta;
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn(`applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "cleanupDiscard": {
        // Discard cards during cleanup step
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        if (!pid || cardIds.length === 0) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          
          // Move each selected card from hand to graveyard
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              graveyard.push({ ...card, zone: "graveyard" });
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(cleanupDiscard): failed", err);
        }
        break;
      }

      case "mill": {
        // Mill cards from library to graveyard
        const pid = (e as any).playerId;
        const count = (e as any).count || 1;
        if (!pid) break;
        try {
          const lib = ctx.libraries.get(pid) || [];
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          
          // Mill top N cards
          const milled = lib.splice(0, Math.min(count, lib.length));
          for (const card of milled) {
            graveyard.push({ ...card, zone: "graveyard" });
          }
          
          // Update counts
          z.libraryCount = lib.length;
          z.graveyardCount = graveyard.length;
          ctx.libraries.set(pid, lib);
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(mill): failed", err);
        }
        break;
      }

      case "tapPermanent":
      case "untapPermanent": {
        // Tap or untap a permanent
        const permId = (e as any).permanentId;
        const tapped = e.type === "tapPermanent";
        if (!permId) break;
        try {
          const battlefield = ctx.state.battlefield || [];
          const perm = battlefield.find((p: any) => p.id === permId);
          if (perm) {
            (perm as any).tapped = tapped;
            ctx.bumpSeq();
          }
        } catch (err) {
          console.warn(`applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "sacrificePermanent": {
        // Sacrifice a permanent (move to graveyard)
        const permId = (e as any).permanentId;
        if (!permId) break;
        try {
          removePermanent(ctx as any, permId);
        } catch (err) {
          console.warn("applyEvent(sacrificePermanent): failed", err);
        }
        break;
      }

      case "sacrificeSelected": {
        // Multiple permanents sacrificed (e.g., for Diabolic Intent)
        const permanentIds = (e as any).permanentIds as string[] || [];
        if (permanentIds.length === 0) break;
        try {
          for (const permId of permanentIds) {
            removePermanent(ctx as any, permId);
          }
        } catch (err) {
          console.warn("applyEvent(sacrificeSelected): failed", err);
        }
        break;
      }

      case "declareAttackers": {
        // Set attackers for combat
        const attackers = (e as any).attackers as Array<{ attackerId: string; defendingPlayer?: string }> || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          // Clear previous attackers
          for (const perm of battlefield) {
            if (perm) (perm as any).attacking = undefined;
          }
          // Set new attackers
          for (const atk of attackers) {
            const perm = battlefield.find((p: any) => p.id === atk.attackerId);
            if (perm) {
              (perm as any).attacking = atk.defendingPlayer || true;
              (perm as any).tapped = true; // Attacking creatures tap
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(declareAttackers): failed", err);
        }
        break;
      }

      case "declareBlockers": {
        // Set blockers for combat
        const blockers = (e as any).blockers as Array<{ blockerId: string; attackerId: string }> || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          // Clear previous blockers
          for (const perm of battlefield) {
            if (perm) {
              (perm as any).blocking = undefined;
              (perm as any).blockedBy = undefined;
            }
          }
          // Set new blockers
          for (const blk of blockers) {
            const blocker = battlefield.find((p: any) => p.id === blk.blockerId);
            const attacker = battlefield.find((p: any) => p.id === blk.attackerId);
            if (blocker) {
              (blocker as any).blocking = blk.attackerId;
            }
            if (attacker) {
              (attacker as any).blockedBy = (attacker as any).blockedBy || [];
              (attacker as any).blockedBy.push(blk.blockerId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(declareBlockers): failed", err);
        }
        break;
      }

      case "activateFetchland": {
        // Fetchland activation: sacrifice land, search for land, put on battlefield
        // The actual search/put is handled by librarySearchSelect, this just marks the sacrifice
        const permId = (e as any).permanentId;
        if (permId) {
          try {
            removePermanent(ctx as any, permId);
          } catch (err) {
            console.warn("applyEvent(activateFetchland): failed", err);
          }
        }
        break;
      }

      case "activateManaAbility": {
        // Mana ability activation: tap permanent, add mana
        const permId = (e as any).permanentId;
        const manaColor = (e as any).manaColor;
        try {
          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).tapped = true;
            }
          }
          // Mana pool updates are typically ephemeral, but we bump seq for state sync
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(activateManaAbility): failed", err);
        }
        break;
      }

      case "activatePlaneswalkerAbility": {
        // Planeswalker ability: adjust loyalty counters
        const permId = (e as any).permanentId;
        const loyaltyCost = (e as any).loyaltyCost || 0;
        try {
          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).counters = (perm as any).counters || {};
              (perm as any).counters.loyalty = ((perm as any).counters.loyalty || 0) + loyaltyCost;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(activatePlaneswalkerAbility): failed", err);
        }
        break;
      }

      case "activateGraveyardAbility": {
        // Graveyard ability (flashback, unearth, etc.)
        // The specific effect depends on the ability, but typically moves the card
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const abilityType = (e as any).abilityType;
        try {
          // Most graveyard abilities exile the card after use
          if (cardId && pid && abilityType === 'flashback') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;
                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: "exile" });
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(activateGraveyardAbility): failed", err);
        }
        break;
      }

      case "shockLandChoice": {
        // Shock land enters tapped or player pays 2 life
        const pid = (e as any).playerId;
        const permId = (e as any).permanentId;
        const payLife = (e as any).payLife;
        try {
          if (payLife && pid && ctx.life) {
            ctx.life[pid] = (ctx.life[pid] ?? ctx.state.startingLife ?? 40) - 2;
          }
          if (!payLife && permId) {
            // Land enters tapped
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).tapped = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(shockLandChoice): failed", err);
        }
        break;
      }

      case "moxDiamondChoice": {
        // Mox Diamond replacement effect - discard a land to enter battlefield, or go to graveyard
        const pid = (e as any).playerId;
        const discardLandId = (e as any).discardLandId;
        const stackItemId = (e as any).stackItemId;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z as any;
          ctx.state.zones = zones;
          
          // Find Mox Diamond on stack (it may already be removed by socket handler, but handle replay case)
          const stack = ctx.state.stack || [];
          const moxIdx = stack.findIndex((item: any) => item.id === stackItemId);
          let moxCard = null;
          
          if (moxIdx !== -1) {
            const [moxItem] = stack.splice(moxIdx, 1);
            moxCard = moxItem.card;
          }
          
          if (discardLandId) {
            // Discard a land and put Mox Diamond on battlefield
            const hand = z.hand as any[];
            const landIdx = hand.findIndex((c: any) => c?.id === discardLandId);
            if (landIdx !== -1) {
              const [discardedLand] = hand.splice(landIdx, 1);
              z.handCount = hand.length;
              (z.graveyard as any[]).push({ ...discardedLand, zone: 'graveyard' });
              z.graveyardCount = (z.graveyard as any[]).length;
            }
            
            // Put Mox Diamond on battlefield
            if (moxCard) {
              ctx.state.battlefield = ctx.state.battlefield || [];
              const permId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              ctx.state.battlefield.push({
                id: permId,
                controller: pid,
                owner: pid,
                tapped: false,
                counters: {},
                card: { ...moxCard, zone: 'battlefield' },
              } as any);
            }
          } else {
            // Put Mox Diamond in graveyard
            if (moxCard) {
              (z.graveyard as any[]).push({ ...moxCard, zone: 'graveyard' });
              z.graveyardCount = (z.graveyard as any[]).length;
            }
          }
          
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(moxDiamondChoice): failed", err);
        }
        break;
      }

      case "bounceLandChoice": {
        // Bounce land: return a land to hand
        const pid = (e as any).playerId;
        const returnedLandId = (e as any).returnedLandId;
        try {
          if (returnedLandId && pid) {
            const battlefield = ctx.state.battlefield || [];
            const idx = battlefield.findIndex((p: any) => p.id === returnedLandId);
            if (idx !== -1) {
              const [perm] = battlefield.splice(idx, 1);
              const zones = ctx.state.zones || {};
              const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
              zones[pid] = z;
              if (perm && (perm as any).card) {
                (z.hand as any[]).push({ ...(perm as any).card, zone: "hand" });
                z.handCount = (z.hand as any[]).length;
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(bounceLandChoice): failed", err);
        }
        break;
      }

      case "librarySearchSelect": {
        // Select cards from library search (tutor effects)
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const destination = (e as any).destination || "hand";
        try {
          if (pid && cardIds.length > 0) {
            const lib = ctx.libraries.get(pid) || [];
            const zones = ctx.state.zones || {};
            const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            zones[pid] = z;
            
            for (const cardId of cardIds) {
              const idx = lib.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = lib.splice(idx, 1);
                if (destination === "hand") {
                  (z.hand as any[]).push({ ...card, zone: "hand" });
                } else if (destination === "battlefield") {
                  ctx.state.battlefield = ctx.state.battlefield || [];
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: {},
                    card: { ...card, zone: "battlefield" },
                  } as any);
                } else if (destination === "top") {
                  lib.unshift({ ...card, zone: "library" });
                }
              }
            }
            
            z.handCount = (z.hand as any[]).length;
            z.libraryCount = lib.length;
            ctx.libraries.set(pid, lib);
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(librarySearchSelect): failed", err);
        }
        break;
      }

      case "creatureTypeSelected": {
        // Creature type selection (e.g., Cavern of Souls, Metallic Mimic)
        const permId = (e as any).permanentId;
        const creatureType = (e as any).creatureType;
        try {
          if (permId && creatureType) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).chosenCreatureType = creatureType;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(creatureTypeSelected): failed", err);
        }
        break;
      }

      case "playOpeningHandCards": {
        // Play cards from opening hand (Leylines, Chancellor triggers)
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        try {
          if (pid && cardIds.length > 0) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.hand)) {
              const hand = z.hand as any[];
              ctx.state.battlefield = ctx.state.battlefield || [];
              
              for (const cardId of cardIds) {
                const idx = hand.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = hand.splice(idx, 1);
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: {},
                    card: { ...card, zone: "battlefield" },
                  } as any);
                }
              }
              z.handCount = hand.length;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(playOpeningHandCards): failed", err);
        }
        break;
      }

      case "skipOpeningHandActions": {
        // Player chose to skip opening hand actions
        // Just a marker event, no state change needed
        ctx.bumpSeq();
        break;
      }

      case "resolveTrigger": {
        // Resolve a triggered ability
        // The specific effect depends on the trigger type
        const triggerId = (e as any).triggerId;
        const choice = (e as any).choice;
        // Most trigger resolution is handled by specific logic elsewhere
        // This is primarily for logging/replay tracking
        ctx.bumpSeq();
        break;
      }

      case "joinForcesInitiated":
      case "joinForcesComplete": {
        // Join forces spell mechanics
        // State changes are handled by the specific spell resolution
        ctx.bumpSeq();
        break;
      }

      case "setHouseRules": {
        // Set house rules for the game
        const rules = (e as any).rules;
        try {
          if (rules && typeof rules === 'object') {
            (ctx.state as any).houseRules = { ...(ctx.state as any).houseRules, ...rules };
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(setHouseRules): failed", err);
        }
        break;
      }

      case "targetSelectionConfirm": {
        // Target selection confirmed for a spell/ability
        // The actual targeting logic is handled by the spell resolution
        ctx.bumpSeq();
        break;
      }

      case "pushTriggeredAbility": {
        // Push a triggered ability onto the stack
        // This allows triggers to be replayed correctly
        const triggerId = (e as any).triggerId;
        const sourceId = (e as any).sourceId;
        const sourceName = (e as any).sourceName;
        const controllerId = (e as any).controllerId;
        const description = (e as any).description;
        const triggerType = (e as any).triggerType;
        const effect = (e as any).effect;
        
        try {
          // Check if this trigger is already on the stack (idempotency for replay)
          const existingTrigger = (ctx.state.stack || []).find((s: any) => s.id === triggerId);
          if (existingTrigger) {
            console.info(`applyEvent(pushTriggeredAbility): trigger ${triggerId} already on stack, skipping (replay idempotency)`);
            break;
          }
          
          ctx.state.stack = ctx.state.stack || [];
          ctx.state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: controllerId,
            source: sourceId,
            sourceName: sourceName,
            description: description,
            triggerType: triggerType,
            effect: effect,
            mandatory: true,
          } as any);
          
          console.log(`[applyEvent] Pushed triggered ability: ${sourceName} - ${description}`);
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(pushTriggeredAbility): failed", err);
        }
        break;
      }

      case "resolveTriggeredAbility": {
        // Resolve a triggered ability - execute its effect
        const triggerId = (e as any).triggerId;
        const effect = (e as any).effect;
        const controllerId = (e as any).controllerId;
        const sourceName = (e as any).sourceName;
        
        try {
          // The actual effect execution is handled by resolveTopOfStack
          // This event just records that the trigger was resolved
          console.log(`[applyEvent] Resolved triggered ability: ${sourceName} - ${effect}`);
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(resolveTriggeredAbility): failed", err);
        }
        break;
      }

      case "executeEffect": {
        // Execute a game effect (token creation, life change, draw, mill, etc.)
        const effectType = (e as any).effectType;
        const controllerId = (e as any).controllerId;
        const targetId = (e as any).targetId;
        const amount = (e as any).amount;
        const tokenData = (e as any).tokenData;
        
        try {
          switch (effectType) {
            case 'createToken': {
              if (tokenData) {
                ctx.state.battlefield = ctx.state.battlefield || [];
                const tokenId = tokenData.id || `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                
                // Check if token already exists (replay idempotency)
                const existingToken = ctx.state.battlefield.find((p: any) => p.id === tokenId);
                if (existingToken) {
                  console.info(`applyEvent(executeEffect/createToken): token ${tokenId} already exists, skipping`);
                  break;
                }
                
                ctx.state.battlefield.push({
                  id: tokenId,
                  controller: controllerId,
                  owner: controllerId,
                  tapped: false,
                  counters: {},
                  basePower: tokenData.power,
                  baseToughness: tokenData.toughness,
                  summoningSickness: !tokenData.hasHaste,
                  isToken: true,
                  card: {
                    id: tokenId,
                    name: tokenData.name,
                    type_line: tokenData.typeLine,
                    power: String(tokenData.power),
                    toughness: String(tokenData.toughness),
                    colors: tokenData.colors || [],
                    oracle_text: tokenData.abilities?.join(', ') || '',
                    keywords: tokenData.abilities || [],
                    zone: 'battlefield',
                  },
                } as any);
                console.log(`[applyEvent] Created token: ${tokenData.name} for ${controllerId}`);
              }
              break;
            }
            case 'gainLife':
            case 'loseLife': {
              const player = (ctx.state.players || []).find((p: any) => p.id === targetId);
              if (player) {
                const delta = effectType === 'gainLife' ? amount : -amount;
                ctx.state.life = ctx.state.life || {};
                ctx.state.life[targetId] = (ctx.state.life[targetId] ?? 40) + delta;
                player.life = ctx.state.life[targetId];
                console.log(`[applyEvent] ${targetId} ${effectType === 'gainLife' ? 'gained' : 'lost'} ${amount} life`);
              }
              break;
            }
            case 'drawCard': {
              // Draw is handled by drawCards, just bump seq
              break;
            }
            case 'mill': {
              const zones = ctx.state.zones?.[targetId] as any;
              if (zones?.library && Array.isArray(zones.library)) {
                for (let i = 0; i < amount && zones.library.length > 0; i++) {
                  const milledCard = zones.library.shift();
                  if (milledCard) {
                    zones.graveyard = zones.graveyard || [];
                    milledCard.zone = 'graveyard';
                    zones.graveyard.push(milledCard);
                  }
                }
                zones.libraryCount = zones.library.length;
                zones.graveyardCount = (zones.graveyard || []).length;
                console.log(`[applyEvent] ${targetId} milled ${amount} card(s)`);
              }
              break;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(executeEffect): failed", err);
        }
        break;
      }

      case "foretellCard": {
        // Foretell: exile a card from hand face-down
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const foretoldCardData = (e as any).card;
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          // Remove card from hand
          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;
          
          // Add to exile with foretell data
          z.exile = z.exile || [];
          if (foretoldCardData) {
            (z.exile as any[]).push(foretoldCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;
          
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(foretellCard): failed", err);
        }
        break;
      }

      case "phaseOutPermanents": {
        // Phase out multiple permanents
        const pid = (e as any).playerId;
        const permanentIds = (e as any).permanentIds as string[] || [];
        
        try {
          const battlefield = ctx.state.battlefield || [];
          for (const permId of permanentIds) {
            const permanent = battlefield.find((p: any) => p?.id === permId);
            if (permanent && permanent.controller === pid && !permanent.phasedOut) {
              (permanent as any).phasedOut = true;
              (permanent as any).phaseOutController = pid;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(phaseOutPermanents): failed", err);
        }
        break;
      }

      case "equipPermanent": {
        // Attach equipment to a creature
        const pid = (e as any).playerId;
        const equipmentId = (e as any).equipmentId;
        const targetCreatureId = (e as any).targetCreatureId;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === equipmentId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);
          
          if (equipment && targetCreature) {
            // Detach from previous creature if attached
            if (equipment.attachedTo) {
              const prevCreature = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevCreature) {
                (prevCreature as any).attachedEquipment = ((prevCreature as any).attachedEquipment || []).filter((id: string) => id !== equipmentId);
              }
            }
            
            // Attach to new creature
            equipment.attachedTo = targetCreatureId;
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
              (targetCreature as any).attachedEquipment.push(equipmentId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(equipPermanent): failed", err);
        }
        break;
      }

      case "concede": {
        // Mark player as having conceded
        const pid = (e as any).playerId;
        
        try {
          const players = ctx.state.players || [];
          const player = players.find((p: any) => p.id === pid);
          
          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Date.now();
          }
          ctx.bumpSeq();
        } catch (err) {
          console.warn("applyEvent(concede): failed", err);
        }
        break;
      }

      default: {
        // Log unknown events but don't fail - they may be newer events not yet supported
        // or events that don't affect core game state
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
 * 
 * Also handles backward compatibility for old games that don't have explicit
 * shuffleLibrary/drawCards events after setCommander.
 */
export function replay(ctx: GameContext, events: GameEvent[]) {
  if (!Array.isArray(events)) return;
  
  // Set replay mode flag to prevent side effects in functions like nextStep
  // This ensures that actions like drawing cards during draw step aren't duplicated
  // when explicit drawCards events are also in the event log
  (ctx as any).isReplaying = true;
  
  try {
    // Track which players have shuffle/draw events anywhere in the event list
    // This is used to detect old-style games that don't have explicit shuffle/draw events
    // and need backward compatibility handling
    const playersWithShuffleEvent = new Set<string>();
    const playersWithDrawEvent = new Set<string>();
    const playersWithSetCommander = new Set<string>();
    
    // First pass: detect which players have which event types
    for (const e of events) {
      if (!e || typeof e.type !== "string") continue;
      
      const pid = (e as any).playerId as string | undefined;
      if (!pid) continue;
      
      if (e.type === "setCommander") {
        playersWithSetCommander.add(pid);
      } else if (e.type === "shuffleLibrary") {
        playersWithShuffleEvent.add(pid);
      } else if (e.type === "drawCards") {
        playersWithDrawEvent.add(pid);
      }
    }
    
    // Second pass: apply events
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
      
      // Backward compatibility: if setCommander was called and there are no
      // shuffleLibrary/drawCards events FOR THIS PLAYER in the event list, do them now
      // This handles old games that don't have explicit shuffle/draw events after setCommander
      if (e.type === "setCommander") {
        const pid = (e as any).playerId;
        const needsShuffle = !playersWithShuffleEvent.has(pid);
        const needsDraw = !playersWithDrawEvent.has(pid);
        
        if (needsShuffle || needsDraw) {
          // Check if hand is empty (meaning opening draw hasn't happened)
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          const handCount = z
            ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0))
            : 0;
          
          if (handCount === 0) {
            console.info("[replay] Backward compat: performing opening draw after setCommander for", pid);
            try {
              if (needsShuffle) {
                shuffleLibrary(ctx as any, pid);
              }
              if (needsDraw) {
                drawCards(ctx as any, pid, 7);
              }
            } catch (err) {
              console.warn("[replay] Backward compat: opening draw failed for", pid, err);
            }
          }
        }
      }
    }

    try {
      reconcileZonesConsistency(ctx as any);
    } catch (err) {
      /* swallow */
    }
  } finally {
    // Clear replay mode flag when done
    (ctx as any).isReplaying = false;
  }
}