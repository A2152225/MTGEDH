// server/src/state/modules/apply-event-handlers/applyEventLobbySetupEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Lobby/session lifecycle, seating, spectators, deck import and opening library draws.
// Public entry: applyLobbySetupEvents(ctx, e) -> true when it handled the event.
//
// Handles: rngSeed, loopShortcutBatchStart, loopShortcutBatchEnd, loopShortcutBatchApply, proposeLoopShortcut, resolveLoopShortcutConsent, setTurnDirection, claimTurn, randomizeStartingPlayer, autoAssignTurn, join, concededPlayerCleanup, leave, restart, resetGame, removePlayer, skipPlayer, unskipPlayer, spectatorGrant, spectatorRevoke, deckImportResolved, shuffleLibrary, drawCards, selectFromLibrary, handIntoLibrary
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  drawCardsByIds,
  selectFromLibrary,
  moveHandToLibrary,
} from "../zones";
import { applyLoopShortcutStatePatch } from "../../../socket/loopShortcutSustain.js";
import { movePermanentToExile } from "../counters_tokens";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryFromRemainingIds,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { leave as leaveModule } from "../join";
import { debugWarn } from "../../../utils/debug.js";
import { clearOracleIrPendingCompoundResumeOnState } from "../oracleIrTransitionPipeline.js";
import { reset, skip, unskip, remove } from "./applyEventLifecycleResetHandlers.js";
import { removeLeavingPlayerGameObjects } from "../playerLeavingGame.js";
import { markPlayerOutOfPriority } from "../priorityEligibility.js";
import { recordedMulliganRedrawFollows } from "./applyEventPriorityMulliganLifeEvents.js";

export function applyLobbySetupEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
      case "rngSeed": {
        ctx.rngSeed = (e as any).seed >>> 0;
        try {
          (ctx.state as any).rngSeed = ctx.rngSeed;
        } catch {}
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

      case "loopShortcutBatchStart":
      case "loopShortcutBatchEnd": {
        // Markers only — real mutations are either per-action events or loopShortcutBatchApply.
        break;
      }

      case "loopShortcutBatchApply": {
        // Compressed end-state from a self-sustaining (or large) Loop Shortcut batch.
        try {
          applyLoopShortcutStatePatch(ctx.state as any, (e as any).statePatch);
        } catch (err) {
          debugWarn(1, "[applyEvent] loopShortcutBatchApply failed", err);
        }
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "proposeLoopShortcut": {
        // Multiplayer CR 731-style consent: live sets state.pendingLoopShortcut.
        // When opponentIds is empty, live auto-approves and clears pending in the same handler
        // (no resolveLoopShortcutConsent event) — mirror that end state.
        try {
          const proposalId = String((e as any).proposalId || "").trim();
          const proposerId = String((e as any).proposerId || "").trim();
          const requestedIterations = Math.max(
            1,
            Math.min(1000, Math.floor(Number((e as any).requestedIterations) || 1)),
          );
          const name = String((e as any).name || "Loop Shortcut").trim() || "Loop Shortcut";
          const summary =
            String((e as any).summary || "").trim() || (requestedIterations + " iteration(s)");
          const opponentIds = Array.isArray((e as any).opponentIds)
            ? (e as any).opponentIds
                .map((id: any) => String(id || "").trim())
                .filter((id: string) => !!id)
            : [];

          if (proposalId && proposerId) {
            if (opponentIds.length === 0) {
              delete (ctx.state as any).pendingLoopShortcut;
            } else {
              (ctx.state as any).pendingLoopShortcut = {
                id: proposalId,
                proposerId,
                name,
                summary,
                requestedIterations,
                status: "pending",
                createdAt: Number((e as any).createdAt) || 0,
                responses: {},
              };
            }
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(proposeLoopShortcut): failed", err);
        }
        break;
      }

      case "resolveLoopShortcutConsent": {
        // Live: marks proposal approved + effectiveIterations, notifies clients, then clears pending.
        // Lasting GameContext mutation is clearing pendingLoopShortcut (consent outcome is socket-only).
        try {
          delete (ctx.state as any).pendingLoopShortcut;
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(resolveLoopShortcutConsent): failed", err);
        }
        break;
      }

      case "setTurnDirection": {
        (ctx.state as any).turnDirection = (e as any).direction;
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "claimTurn": {
        // Pregame: claim first turn. Live: game-actions claimMyTurn.
        try {
          const by = String((e as any).by || (e as any).playerId || "").trim();
          if (by) {
            (ctx.state as any).turnPlayer = by;
            // Best-effort: only set starting player if missing (mirrors live).
            if (!(ctx.state as any).startingPlayerId) {
              (ctx.state as any).startingPlayerId = by;
              (ctx.state as any).startingPlayer = by;
            }
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(claimTurn): failed", err);
        }
        break;
      }

      case "randomizeStartingPlayer": {
        // Pregame: shuffle seating / first player. Live: game-actions randomizeStartingPlayer.
        try {
          const selected = String((e as any).selectedPlayerId || "").trim();
          const rawOrder = Array.isArray((e as any).playerOrder) ? (e as any).playerOrder : [];
          const playerOrder = rawOrder
            .map((id: unknown) => String(id || "").trim())
            .filter(Boolean);
          const players = Array.isArray(ctx.state?.players) ? (ctx.state.players as any[]) : [];
          if (playerOrder.length > 0 && players.length > 0) {
            const byId = new Map(players.map((p: any) => [String(p?.id || ""), p]));
            const seen = new Set<string>();
            const ordered: any[] = [];
            for (const id of playerOrder) {
              const p = byId.get(id);
              if (!p || seen.has(id)) continue;
              seen.add(id);
              ordered.push(p);
            }
            for (const p of players) {
              const id = String(p?.id || "");
              if (!id || seen.has(id)) continue;
              ordered.push(p);
            }
            ordered.forEach((p, idx) => {
              p.seat = idx;
            });
            ctx.state.players = ordered;
            (ctx.state as any).turnOrder = ordered
              .filter((p: any) => p && !p.spectator && !p.isSpectator)
              .map((p: any) => p.id);
          }
          if (selected) {
            (ctx.state as any).turnPlayer = selected;
            (ctx.state as any).startingPlayerId = selected;
            (ctx.state as any).startingPlayer = selected;
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(randomizeStartingPlayer): failed", err);
        }
        break;
      }

      case "autoAssignTurn": {
        // Pregame/solo: auto-assign turnPlayer when only one player. Live: nextTurn path.
        try {
          const playerId = String((e as any).playerId || "").trim();
          if (playerId) {
            (ctx.state as any).turnPlayer = playerId;
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(autoAssignTurn): failed", err);
        }
        break;
      }

      case "join": {
        // Rebuild roster entries when replaying from persisted events.
        // Socket join flow handles live connections; this is strictly for replay-after-restart.
        const pid = (e as any).playerId as PlayerID | undefined;
        const name = (e as any).name as string | undefined;
        const seatToken = (e as any).seatToken as string | undefined;
        const spectator = Boolean((e as any).spectator);
        const isAI = Boolean((e as any).isAI);
        const strategy = typeof (e as any).strategy === 'string' ? String((e as any).strategy) : undefined;
        const difficulty = Number.isFinite(Number((e as any).difficulty)) ? Number((e as any).difficulty) : undefined;

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
              isAI,
              strategy,
              difficulty,
              aiStrategy: strategy,
              aiDifficulty: difficulty,
            };
            playersArr.push(existing);
          } else {
            // Ensure basic fields are set
            if (!existing.name) existing.name = name;
            if (typeof existing.spectator === "undefined")
              existing.spectator = spectator;
            if (!existing.seatToken && seatToken)
              existing.seatToken = seatToken;
            if (typeof existing.isAI === "undefined")
              existing.isAI = isAI;
            if (!existing.strategy && strategy)
              existing.strategy = strategy;
            if (typeof existing.difficulty === 'undefined' && typeof difficulty === 'number')
              existing.difficulty = difficulty;
            if (!existing.aiStrategy && strategy)
              existing.aiStrategy = strategy;
            if (typeof existing.aiDifficulty === 'undefined' && typeof difficulty === 'number')
              existing.aiDifficulty = difficulty;
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
            if (ctx.life) {
              ctx.life[pid] = ctx.life[pid] ?? startingLife;
              // Keep state + player refs in sync for consumers/tests that read player.life.
              (ctx.state as any).life = (ctx.state as any).life || {};
              (ctx.state as any).life[pid] = (ctx.state as any).life[pid] ?? ctx.life[pid];
              if (existing && typeof (existing as any).life === 'undefined') {
                (existing as any).life = ctx.life[pid];
              }
            }
            if (ctx.poison) ctx.poison[pid] = ctx.poison[pid] ?? 0;
            if (ctx.experience) ctx.experience[pid] = ctx.experience[pid] ?? 0;
            
            // Initialize zones
            const zones = ctx.state.zones = ctx.state.zones || {};
            zones[pid] = zones[pid] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            
            // Initialize landsPlayedThisTurn
            if (ctx.state.landsPlayedThisTurn) {
              ctx.state.landsPlayedThisTurn[pid] = ctx.state.landsPlayedThisTurn[pid] ?? 0;
            }

            if (isAI) {
              const stateAny = ctx.state as any;
              if (!(stateAny.autoPassPlayers instanceof Set)) {
                stateAny.autoPassPlayers = new Set();
              }
              stateAny.autoPassPlayers.add(pid);
            }
          }
          
          // Zones will be normalized by reconcileZonesConsistency after replay.
        } catch (err) {
          debugWarn(1, "applyEvent(join): failed to rebuild player", err);
        }
        break;
      }

      case "concededPlayerCleanup": {
        const playerId = String((e as any).playerId || '').trim();
        if (!playerId) break;

        try {
          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];

          const permanentIds = Array.isArray((e as any).permanentIds)
            ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];

          if (permanentIds.length > 0) {
            for (const permanentId of permanentIds) {
              const exists = battlefield.some((entry: any) => entry && String(entry.id || '') === permanentId);
              if (exists) {
                movePermanentToExile(ctx as any, permanentId);
              }
            }
          } else {
            removeLeavingPlayerGameObjects(ctx.state, playerId, { gameId: String((ctx as any).gameId || '') });
          }

          const players = Array.isArray(stateAny.players) ? stateAny.players : [];
          const player = players.find((entry: any) => entry && String(entry.id || '') === playerId);
          if (player) {
            (player as any).hasLost = true;
            (player as any).eliminated = true;
            (player as any).lossReason = String((e as any).lossReason || 'Conceded');
            markPlayerOutOfPriority(ctx as any, playerId);
          }

          if (stateAny.autoPassForTurn && typeof stateAny.autoPassForTurn === 'object') {
            delete stateAny.autoPassForTurn[playerId];
          }
          if (stateAny.autoPassPlayers instanceof Set) {
            stateAny.autoPassPlayers.delete(playerId);
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(playerId);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(concededPlayerCleanup): failed', err);
        }
        break;
      }

      case "leave": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const deferred = (e as any).deferred === true;

          if (!deferred) {
            leaveModule(ctx as any, playerId as any);
            break;
          }

          const stateAny = ctx.state as any;
          const players = Array.isArray(stateAny.players) ? stateAny.players : [];
          const player = players.find((entry: any) => entry && String(entry.id || '') === playerId);

          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Number((e as any).leftAt || Date.now());
            (player as any).departureMode = 'leave';
            (player as any).leftGame = true;
            (player as any).leftAt = Number((e as any).leftAt || Date.now());
            (player as any).connected = false;
            try { delete (player as any).socketId; } catch {}
          }

          if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== 'object') {
            stateAny.autoPassForTurn = {};
          }
          if (playerId) {
            stateAny.autoPassForTurn[playerId] = true;
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(playerId);
          }
          if (String(stateAny._pauseHumanAutoPassUntilActionFor || '') === playerId) {
            delete stateAny._pauseHumanAutoPassUntilActionFor;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(leave): failed', err);
        }
        break;
      }

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
        const shufflePlayerId = String((e as any).playerId || '').trim();
        const shuffledLibraryIds = (Array.isArray((e as any).shuffledLibraryIds) ? (e as any).shuffledLibraryIds : [])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean);
        if (shufflePlayerId && shuffledLibraryIds.length > 0) {
          const library = getPlayerLibraryFromContext(ctx, shufflePlayerId);
          const currentIds = library
            .map((card: any) => String(card?.id || '').trim())
            .filter(Boolean);
          const alreadyOrdered = currentIds.length === shuffledLibraryIds.length
            && currentIds.every((id, index) => id === shuffledLibraryIds[index]);
          if (alreadyOrdered) {
            break;
          }
          const libraryAfter = buildLibraryFromRemainingIds(library, [], shuffledLibraryIds);
          const libraryAfterCards = cloneLibraryCards(libraryAfter);
          const zones = (ctx.state as any).zones || {};
          const z = zones[shufflePlayerId] = zones[shufflePlayerId] || {};
          z.library = libraryAfterCards;
          z.libraryCount = libraryAfterCards.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(shufflePlayerId, libraryAfterCards);
          }
        } else if (shufflePlayerId) {
          shuffleLibrary(ctx as any, shufflePlayerId as any);
        }
        break;
      }

      case "drawCards": {
        const drawPlayerId = (e as any).playerId;
        const drawnCardIds = (Array.isArray((e as any).drawnCardIds) ? (e as any).drawnCardIds : [])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean);
        if (
          drawnCardIds.length > 0
          && recordedMulliganRedrawFollows(ctx, String(drawPlayerId || ''))
        ) {
          const hand = (ctx.state.zones as any)?.[drawPlayerId]?.hand;
          if (Array.isArray(hand) && hand.length > 0) {
            moveHandToLibrary(ctx as any, drawPlayerId);
          }
        }
        if (drawnCardIds.length > 0) {
          drawCardsByIds(ctx as any, drawPlayerId, drawnCardIds);
        } else {
          drawCards(
            ctx as any,
            drawPlayerId,
            (e as any).count || 1,
            { skipEventPersistence: true },
          );
        }
        clearOracleIrPendingCompoundResumeOnState(ctx.state);
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

      default:
        return false;
  }

  return true;
}
