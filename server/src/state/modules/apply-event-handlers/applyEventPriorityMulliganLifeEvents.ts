// server/src/state/modules/apply-event-handlers/applyEventPriorityMulliganLifeEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Priority passing, mulligans, life totals, cleanup/discard, mill and draw replacements.
// Public entry: applyPriorityMulliganLifeEvents(ctx, e) -> true when it handled the event.
// Also: mulliganRedrawWasAlreadyRecorded, recordedMulliganRedrawFollows (replay pairing).
//
// Handles: passPriority, mulligan, keepHand, unkeepHand, mulliganPutToBottom, setLife, adjustLife, cleanupDiscard, increasePlayerSpeed, discardEffect, mill, zursWeirdingDrawReplacementResolve, dredgeDrawReplacementResolve, skipDrawReplacementResolve, opponentLibraryDrawReplacementResolve, playOpeningHandCards, skipOpeningHandActions
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { applyDeferredGraveyardEntryTriggers, pushCardToGraveyardFromLibrary, pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import {
  shuffleLibrary,
  drawCards,
  moveHandToLibrary,
  applyDredgeDrawReplacementChoice,
  applySkipDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
  applyOpponentLibraryDrawReplacementChoice,
} from "../zones";
import { passPriority } from "../turn";
import {
  getReplayOpeningHandBattlefieldCounters,
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
  matchesDungeonRoomPaymentStep,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ensureDeferredOracleIrStackItem } from "../oracleIrDeferredStackFinalize.js";
import { consumeReplayedActivatedAbilityStackItems } from "../replay-prompt-cleanup.js";
import {
  extractLibraryCardsByIds,
  pickMutablePlayerLibrary,
  writePlayerLibrary,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

function replayEventAt(ctx: GameContext, offset: number): GameEvent | null {
  const events = (ctx as any)._replayEvents;
  const index = (ctx as any)._replayEventIndex;
  if (!Array.isArray(events) || typeof index !== 'number') return null;
  const event = events[index + offset];
  return event && typeof event === 'object' ? event as GameEvent : null;
}

/**
 * Live mulligans persist the replacement hand as `drawCards` (with ids) and then
 * append the `mulligan` marker. Replay must not draw seven more cards for that marker.
 */
export function mulliganRedrawWasAlreadyRecorded(ctx: GameContext, playerId: string): boolean {
  if (!(ctx as any).isReplaying) return false;
  const previous = replayEventAt(ctx, -1) as any;
  if (!previous || previous.type !== 'drawCards') return false;
  if (String(previous.playerId || '') !== playerId) return false;
  return Array.isArray(previous.drawnCardIds) && previous.drawnCardIds.length > 0;
}

/**
 * The hand return that precedes a mulligan redraw is not its own event. When the
 * next replay event is that player's `mulligan` marker, the current `drawCards`
 * is the replacement hand and the cards already in hand have to go back first.
 */
export function recordedMulliganRedrawFollows(ctx: GameContext, playerId: string): boolean {
  if (!(ctx as any).isReplaying) return false;
  const next = replayEventAt(ctx, 1) as any;
  if (!next || next.type !== 'mulligan') return false;
  return String(next.playerId || '') === playerId;
}

export function applyPriorityMulliganLifeEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "passPriority": {
        const by = (e as any).by;
        try {
          if (typeof passPriority === "function")
            passPriority(ctx as any, by);
        } catch {}
        break;
      }

      case "mulligan": {
        // Mulligan: move hand to library, shuffle, draw 7.
        // New logs already persisted that redraw as drawCards + ids immediately
        // before this marker. Drawing again replaces the real hand with seven
        // random cards and leaves the previous hand's cards in the library,
        // so undo replay inflates the hand.
        const pid = (e as any).playerId;
        if (!pid) break;
        if (mulliganRedrawWasAlreadyRecorded(ctx, pid)) break;
        try {
          moveHandToLibrary(ctx as any, pid);
          shuffleLibrary(ctx as any, pid);
          drawCards(ctx as any, pid, 7);
        } catch (err) {
          debugWarn(1, "applyEvent(mulligan): failed", err);
        }
        break;
      }

      case "keepHand": {
        // Mark player as having kept their hand
        // This is important for tracking mulligan state during replay
        const pid = (e as any).playerId;
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(keepHand): failed", err);
        }
        break;
      }

      case "unkeepHand": {
        const pid = (e as any).playerId;
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: false,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(unkeepHand): failed", err);
        }
        break;
      }

      case "mulliganPutToBottom": {
        // London mulligan: move selected cards from hand to bottom of library
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid || cardIds.length === 0) break;
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          const lib = pickMutablePlayerLibrary(ctx, pid);
          
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
          writePlayerLibrary(ctx, pid, lib);
          
          // Mark hand as kept after putting cards on bottom
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mulliganPutToBottom): failed", err);
        }
        break;
      }

      case "setLife":
      case "adjustLife": {
        // Set or adjust a player's life total
        const pid = (e as any).playerId;
        const life = (e as any).life ?? (e as any).newLife;
        const delta = (e as any).delta;
        if (!pid) break;
        try {
          const startingLife = (ctx.state as any)?.startingLife ?? 40;
          const current = ctx.life ? (ctx.life[pid] ?? startingLife) : startingLife;

          let next: number | null = null;
          if (typeof life === 'number') {
            // Absolute set
            next = life;
          } else if (typeof delta === 'number') {
            // Relative adjustment
            next = current + delta;
          }

          if (next !== null) {
            // Apply
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx.state as any).life[pid] = next;
            if (ctx.life) ctx.life[pid] = next;

            // Track gained/lost for this turn.
            const diff = next - current;
            const stateAny = ctx.state as any;
            if (diff > 0) {
              stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
              stateAny.lifeGainedThisTurn[pid] = (stateAny.lifeGainedThisTurn[pid] || 0) + diff;
            } else if (diff < 0) {
              stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
              stateAny.lifeLostThisTurn[pid] = (stateAny.lifeLostThisTurn[pid] || 0) + Math.abs(diff);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "cleanupDiscard": {
        // Discard cards during cleanup step
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const exiledCardIds = (e as any).exiledCardIds as string[] || [];
        if (!pid || (cardIds.length === 0 && exiledCardIds.length === 0)) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          z.exile = Array.isArray(z.exile) ? z.exile : [];
          const exile = z.exile as any[];
          
          // Move each selected card from hand to graveyard, then fire
          // from-anywhere triggers so a titan sees the rest of the discard.
          let discardedCount = 0;
          const deferredGraveyardEntries: Array<{ card: any; ownerId: string; sourceZone: string }> = [];
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              const entered = pushCardToPlayerGraveyardWithReplacements(ctx as any, String(pid), card, graveyard, {
                asDiscard: true,
                deferGraveyardTriggers: true,
              });
              if (entered) {
                deferredGraveyardEntries.push({
                  card: graveyard[graveyard.length - 1],
                  ownerId: String(pid),
                  sourceZone: 'hand',
                });
              }
              discardedCount++;
            }
          }
          applyDeferredGraveyardEntryTriggers(ctx as any, deferredGraveyardEntries);

          for (const cardId of exiledCardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              exile.push({ ...card, zone: 'exile' });
              discardedCount++;
            }
          }
          
          // Update counts. A graveyard shuffle replaces the zone array.
          z.handCount = hand.length;
          z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;
          z.exileCount = exile.length;

          // Turn-tracking for intervening-if: "if a player discarded a card this turn" / "if an opponent discarded a card this turn".
          if (discardedCount > 0) {
            const stateAny = ctx.state as any;
            stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
            stateAny.discardedCardThisTurn[String(pid)] = true;
            stateAny.anyPlayerDiscardedCardThisTurn = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cleanupDiscard): failed", err);
        }
        break;
      }

      case "increasePlayerSpeed": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const to = Number((e as any).to);
          if (!playerId || !Number.isFinite(to) || to < 1) break;
          const stateAny = ctx.state as any;
          stateAny.speed = { ...(stateAny.speed || {}), [playerId]: to };
          stateAny.speedIncreasedThisTurn = { ...(stateAny.speedIncreasedThisTurn || {}), [playerId]: true };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(increasePlayerSpeed): failed', err);
        }
        break;
      }

      case "discardEffect": {
        const pid = String((e as any).playerId || '').trim();
        const cardIds = Array.isArray((e as any).cardIds)
          ? ((e as any).cardIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const destination = String((e as any).destination || 'graveyard').toLowerCase() === 'exile' ? 'exile' : 'graveyard';
        const replayGameId = String((ctx as any).gameId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const exileTag = (e as any).exileTag as
          | {
              exiledWithSourceId?: string;
              exiledWithOracleId?: string;
              exiledWithSourceName?: string;
            }
          | undefined;
        if (!pid || cardIds.length === 0) break;

        try {
          if (replayGameId && (resolvedStepId || (e as any).dungeonRoomPayment)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPaymentStep(step, e as any);
            });
          }

          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;

          const hand = z.hand as any[];
          z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
          z.exile = Array.isArray(z.exile) ? z.exile : [];
          const graveyard = z.graveyard as any[];
          const exile = z.exile as any[];
          const currentTurn = Number((ctx.state as any)?.turnNumber ?? (ctx.state as any)?.turn ?? 0) || 0;
          let movedCount = 0;
          const deferredGraveyardEntries: Array<{ card: any; ownerId: string; sourceZone: string }> = [];

          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c && String(c.id || '') === cardId);
            if (idx === -1) continue;

            const [card] = hand.splice(idx, 1);
            if (destination === 'exile') {
              exile.push({
                ...card,
                ...(exileTag ? { ...exileTag } : null),
                zone: 'exile',
                discardedByPlayerId: pid,
                discardedOnTurn: currentTurn,
              });
              movedCount++;
              continue;
            }

            const entered = pushCardToPlayerGraveyardWithReplacements(ctx as any, pid, card, graveyard, {
              deferGraveyardTriggers: true,
              extraFields: {
                discardedByPlayerId: pid,
                discardedOnTurn: currentTurn,
              },
            });
            if (entered) {
              deferredGraveyardEntries.push({
                card: graveyard[graveyard.length - 1],
                ownerId: pid,
                sourceZone: 'hand',
              });
            }
            movedCount++;
          }
          applyDeferredGraveyardEntryTriggers(ctx as any, deferredGraveyardEntries);

          z.handCount = hand.length;
          z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;
          z.exileCount = exile.length;

          if (movedCount > 0) {
            const stateAny = ctx.state as any;
            stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
            stateAny.discardedCardThisTurn[pid] = true;
            stateAny.anyPlayerDiscardedCardThisTurn = true;
          }

          ctx.bumpSeq();
          ensureDeferredOracleIrStackItem(ctx, String((e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(discardEffect): failed', err);
        }
        break;
      }

      case "mill": {
        // Mill cards from library to graveyard
        const pid = (e as any).playerId;
        const count = (e as any).count || 1;
        if (!pid) break;
        if (
          (ctx as any).isReplaying
          && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
        ) {
          consumeReplayedActivatedAbilityStackItems(ctx, e as Record<string, unknown>);
        }
        try {
          const requestedIds = (
            Array.isArray((e as any).cardIds)
              ? (e as any).cardIds
              : Array.isArray((e as any).milledCardIds)
                ? (e as any).milledCardIds
                : []
          )
            .map((id: unknown) => String(id || '').trim())
            .filter(Boolean);
          const lib = pickMutablePlayerLibrary(ctx, pid);
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];

          let milled: any[] = [];
          let remainder = lib;
          if (requestedIds.length > 0) {
            const extracted = extractLibraryCardsByIds(lib, requestedIds);
            milled = extracted.extracted;
            remainder = extracted.remainder;
          } else {
            milled = lib.splice(0, Math.min(count, lib.length));
            remainder = lib;
          }
          writePlayerLibrary(ctx, pid, remainder);
          // Every milled card has to be in the graveyard before Kozilek or
          // Gaea's Blessing shuffles it. Firing per card would shuffle Kozilek
          // away and leave the rest of the mill in the graveyard.
          const deferredGraveyardEntries: Array<{ card: any; ownerId: string; sourceZone: string }> = [];
          for (const card of milled) {
            const before = graveyard.length;
            const entered = pushCardToGraveyardFromLibrary(ctx as any, String(pid), card, graveyard, {
              deferGraveyardTriggers: true,
            });
            if (entered && graveyard.length > before) {
              deferredGraveyardEntries.push({
                card: graveyard[graveyard.length - 1],
                ownerId: String(pid),
                sourceZone: 'library',
              });
            }
          }
          applyDeferredGraveyardEntryTriggers(ctx as any, deferredGraveyardEntries);

          z.graveyardCount = graveyard.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mill): failed", err);
        }
        break;
      }

      case "zursWeirdingDrawReplacementResolve": {
        const decidingOpponentId = String((e as any).playerId || '').trim();
        const drawingPlayerId = String((e as any).drawingPlayerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.zursWeirdingOpponentChoice === true && (!decidingOpponentId || String(step?.playerId || '').trim() === decidingOpponentId);
            });
          }

          (ctx as any)._replayNextEventType = 'zursWeirdingDrawReplacementResolve';
          applyZursWeirdingOpponentChoice(ctx as any, {
            drawingPlayerId,
            decidingOpponentId,
            opponentIndex: Number((e as any).opponentIndex || 0),
            choiceId: String((e as any).choiceId || '').trim() || 'decline',
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(zursWeirdingDrawReplacementResolve): failed', err);
        }
        break;
      }

      case "dredgeDrawReplacementResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.dredgeDrawReplacementChoice === true && (!playerId || String(step?.playerId || '').trim() === playerId);
            });
          }

          applyDredgeDrawReplacementChoice(ctx as any, {
            playerId,
            choiceId: String((e as any).choiceId || '').trim() || ((e as any).dredgeCardId ? 'dredge' : 'draw'),
            dredgeCardId: String((e as any).dredgeCardId || '').trim(),
            dredgeAmount: Number((e as any).dredgeAmount || 0),
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(dredgeDrawReplacementResolve): failed', err);
        }
        break;
      }

      case "skipDrawReplacementResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.skipDrawReplacementChoice === true && (!playerId || String(step?.playerId || '').trim() === playerId);
            });
          }

          applySkipDrawReplacementChoice(ctx as any, {
            playerId,
            choiceId: String((e as any).choiceId || '').trim() || 'draw',
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
            exceptKeywords: (e as any).exceptKeywords,
            sourcePermanentId: String((e as any).sourcePermanentId || '').trim(),
            sourceName: String((e as any).sourceName || '').trim(),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(skipDrawReplacementResolve): failed', err);
        }
        break;
      }

      case "opponentLibraryDrawReplacementResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.opponentLibraryDrawReplacement === true && (!playerId || String(step?.playerId || '').trim() === playerId);
            });
          }

          applyOpponentLibraryDrawReplacementChoice(ctx as any, {
            playerId,
            opponentId: String((e as any).opponentId || '').trim(),
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
            sourcePermanentId: String((e as any).sourcePermanentId || '').trim(),
            sourceName: String((e as any).sourceName || '').trim(),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(opponentLibraryDrawReplacementResolve): failed', err);
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
                    counters: getReplayOpeningHandBattlefieldCounters(ctx.state, card, pid),
                    card: { ...card, zone: "battlefield" },
                  } as any);
                  stampPermanentEntryTimestamp(ctx.state, ctx.state.battlefield[ctx.state.battlefield.length - 1]);
                }
              }
              z.handCount = hand.length;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playOpeningHandCards): failed", err);
        }
        break;
      }

      case "skipOpeningHandActions": {
        // Player chose to skip opening hand actions
        // Just a marker event, no state change needed
        ctx.bumpSeq();
        break;
      }

      default:
        return false;
  }

  return true;
}
