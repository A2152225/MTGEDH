// server/src/state/modules/apply-event-handlers/applyEventTurnPhaseTopLibraryEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Turn/step advancement plus scry, surveil, ponder and bottom-ordering of the library top.
// Public entry: applyTurnPhaseTopLibraryEvents(ctx, e) -> true when it handled the event.
//
// Handles: nextTurn, nextStep, skipToPhase, reorderHand, updatePermanentPos, shuffleHand, scryResolve, surveilResolve, ponderEffectResolve, bottomOrderResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { reorderHand as zonesReorderHand, shuffleHand as zonesShuffleHand, applyScry, applySurveil } from "../zones";
import { nextTurn, nextStep } from "../turn";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterAppendOrderedBottom,
  reorderLibraryByIdList,
  buildLibraryAfterPonderResolve,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import {
  restoreOracleIrLedgerOnState,
  restoreOracleIrPendingCompoundResumeOnState,
} from "../oracleIrTransitionPipeline.js";
import { ensureDeferredOracleIrStackItem } from "../oracleIrDeferredStackFinalize.js";

export function applyTurnPhaseTopLibraryEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "nextTurn": {
        nextTurn(ctx as any);
        break;
      }

      case "nextStep": {
        nextStep(ctx as any);
        break;
      }

      case "skipToPhase": {
        // Skip to a specific phase/step - used when player clicks on phase buttons
        // Note: This is a simplified replay that just sets the phase/step directly
        // The full skipToPhase handler in socket/game-actions.ts handles triggers, draws, etc.
        // But those effects are persisted as separate events (drawCards, etc.)
        const targetStep = String((e as any).targetStep || (e as any).to || '').trim();
        const pendingPhaseSkip = ((e as any).pendingPhaseSkip && typeof (e as any).pendingPhaseSkip === 'object')
          ? { ...((e as any).pendingPhaseSkip as any) }
          : undefined;
        const triggerOrderRequests = Array.isArray((e as any).triggerOrderRequests)
          ? ((e as any).triggerOrderRequests as any[])
          : [];
        const untappedPermanentIds = Array.isArray((e as any).untappedPermanentIds)
          ? ((e as any).untappedPermanentIds as any[])
              .map((value: any) => String(value || '').trim())
              .filter((value: string) => value.length > 0)
          : [];
        const inferPhaseFromStep = (step: string): string | undefined => {
          switch (String(step || '').trim().toUpperCase()) {
            case 'UNTAP':
            case 'UPKEEP':
            case 'DRAW':
              return 'beginning';
            case 'MAIN1':
              return 'precombatMain';
            case 'BEGIN_COMBAT':
            case 'DECLARE_ATTACKERS':
            case 'DECLARE_BLOCKERS':
            case 'COMBAT_DAMAGE':
            case 'END_COMBAT':
              return 'combat';
            case 'MAIN2':
              return 'postcombatMain';
            case 'END_STEP':
            case 'CLEANUP':
              return 'ending';
            default:
              return undefined;
          }
        };
        const targetPhase = String(
          (e as any).targetPhase ||
          pendingPhaseSkip?.targetPhase ||
          inferPhaseFromStep(targetStep) ||
          ''
        ).trim();
        try {
          if (targetPhase) {
            (ctx.state as any).phase = targetPhase;
          }
          if (targetStep) {
            (ctx.state as any).step = targetStep;
          }
          if (pendingPhaseSkip) {
            (ctx.state as any).pendingPhaseSkip = pendingPhaseSkip;
          } else {
            delete (ctx.state as any).pendingPhaseSkip;
          }
          if ((e as any).priority) {
            (ctx.state as any).priority = (e as any).priority;
          }
          if (untappedPermanentIds.length > 0) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const untappedIdSet = new Set(untappedPermanentIds);
            for (const permanent of battlefield as any[]) {
              if (!permanent) continue;
              if (!untappedIdSet.has(String(permanent.id || ''))) continue;
              (permanent as any).tapped = false;
            }
          }
          if (!pendingPhaseSkip) {
            try {
              (ctx.state as any).combat = undefined;
              const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
              for (const permanent of battlefield as any[]) {
                if (!permanent) continue;
                if ((permanent as any).attacking !== undefined) (permanent as any).attacking = undefined;
                if ((permanent as any).blocking !== undefined) (permanent as any).blocking = undefined;
                if ((permanent as any).blockedBy !== undefined) (permanent as any).blockedBy = undefined;
              }
            } catch {
              // best-effort only
            }

            if (!(e as any).priority && (ctx.state as any).turnPlayer) {
              (ctx.state as any).priority = (ctx.state as any).turnPlayer;
            }
          }
          for (const request of triggerOrderRequests) {
            if (!request || typeof request !== 'object') continue;
            const requestPlayerId = String((request as any).playerId || '').trim();
            const requestTriggers = Array.isArray((request as any).triggers)
              ? ((request as any).triggers as any[]).filter((trigger: any) => trigger && String(trigger.id || '').trim())
              : [];
            if (!requestPlayerId || requestTriggers.length === 0) continue;

            const queue = ResolutionQueueManager.getQueue(ctx.gameId);
            const requestIds = requestTriggers.map((trigger: any) => String(trigger.id || '')).filter(Boolean);
            const alreadyPresent = queue.steps.some((step: any) => {
              if (!step || String((step as any).type || '') !== String(ResolutionStepType.TRIGGER_ORDER)) {
                return false;
              }
              if (String((step as any).playerId || '') !== requestPlayerId) {
                return false;
              }
              const existingIds = Array.isArray((step as any).triggers)
                ? ((step as any).triggers as any[]).map((trigger: any) => String(trigger?.id || '')).filter(Boolean)
                : [];
              return existingIds.length === requestIds.length && existingIds.every((id: string, index: number) => id === requestIds[index]);
            });

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(ctx.gameId, {
                type: ResolutionStepType.TRIGGER_ORDER,
                playerId: requestPlayerId as any,
                description: String((request as any).description || `Choose the order to put ${requestTriggers.length} triggered abilities on the stack`),
                mandatory: true,
                triggers: requestTriggers.map((trigger: any) => ({
                  id: String(trigger.id),
                  sourceName: String(trigger.sourceName || ''),
                  effect: String(trigger.effect || ''),
                  imageUrl: trigger.imageUrl,
                })),
                requireAll: (request as any).requireAll !== false,
              } as any);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(skipToPhase): failed", err);
        }
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

      case "updatePermanentPos": {
        const permanentId = String((e as any).permanentId || '').trim();
        if (!permanentId) break;

        const battlefield = Array.isArray((ctx.state as any)?.battlefield)
          ? (ctx.state as any).battlefield
          : [];
        const permanent = battlefield.find(
          (entry: any) => String(entry?.id || '') === permanentId
        );
        if (!permanent) break;

        const pos = {
          x: Math.round(Number((e as any).x || 0)),
          y: Math.round(Number((e as any).y || 0)),
          ...(typeof (e as any).z === 'number' && Number.isFinite((e as any).z)
            ? { z: Math.round((e as any).z) }
            : {}),
        };

        (permanent as any).pos = pos;
        (permanent as any).posX = pos.x;
        (permanent as any).posY = pos.y;
        if (typeof pos.z === 'number') {
          (permanent as any).posZ = pos.z;
        } else {
          delete (permanent as any).posZ;
        }
        ctx.bumpSeq();
        break;
      }

      case "shuffleHand": {
        zonesShuffleHand(ctx as any, (e as any).playerId);
        break;
      }

      case "scryResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesScryStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.SCRY)
                  && String(step?.playerId || '') === pid;
              };

              const activeStepMatched = matchesScryStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesScryStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          applyScry(
            ctx as any,
            pid,
            Array.isArray((e as any).keepTopOrder)
              ? ((e as any).keepTopOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : [],
            Array.isArray((e as any).bottomOrder)
              ? ((e as any).bottomOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : []
          );

          const pendingScry = (ctx.state as any).pendingScry;
          if (pendingScry && typeof pendingScry === 'object') {
            delete pendingScry[pid];
            if (Object.keys(pendingScry).length === 0) {
              delete (ctx.state as any).pendingScry;
            }
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(scryResolve): failed', err);
        }
        break;
      }

      case "surveilResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesSurveilStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.SURVEIL)
                  && String(step?.playerId || '') === pid;
              };

              const activeStepMatched = matchesSurveilStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesSurveilStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          applySurveil(
            ctx as any,
            pid,
            Array.isArray((e as any).toGraveyard)
              ? ((e as any).toGraveyard as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : [],
            Array.isArray((e as any).keepTopOrder)
              ? ((e as any).keepTopOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : []
          );

          const pendingSurveil = (ctx.state as any).pendingSurveil;
          if (pendingSurveil && typeof pendingSurveil === 'object') {
            delete pendingSurveil[pid];
            if (Object.keys(pendingSurveil).length === 0) {
              delete (ctx.state as any).pendingSurveil;
            }
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(surveilResolve): failed', err);
        }
        break;
      }

      case "ponderEffectResolve": {
        const pid = String((e as any).playerId || '').trim();
        const targetPid = String((e as any).targetPlayerId || pid).trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const variant = String((e as any).variant || '').trim();
        const cancelled = (e as any).cancelled === true;
        const shouldShuffle = (e as any).shouldShuffle === true;
        const lookedAtCardIds = Array.isArray((e as any).lookedAtCardIds)
          ? ((e as any).lookedAtCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const libraryTopOrder = Array.isArray((e as any).libraryTopOrder)
          ? ((e as any).libraryTopOrder as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffledLibraryIds = Array.isArray((e as any).shuffledLibraryIds)
          ? ((e as any).shuffledLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const toHandCardIds = Array.isArray((e as any).toHandCardIds)
          ? ((e as any).toHandCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const lookedAtCards = Array.isArray((e as any).lookedAtCards) ? (e as any).lookedAtCards as any[] : [];
        const toHandCards = Array.isArray((e as any).toHandCards) ? (e as any).toHandCards as any[] : [];
        const drawnCard = (e as any).drawnCard && typeof (e as any).drawnCard === 'object'
          ? { ...(e as any).drawnCard, zone: 'hand' }
          : null;
        const drawnCardId = String((e as any).drawnCardId || drawnCard?.id || '').trim();
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : cancelled
            ? cloneLibraryCards(getPlayerLibraryFromContext(ctx, targetPid))
            : buildLibraryAfterPonderResolve(getPlayerLibraryFromContext(ctx, targetPid), {
                lookedAtCardIds,
                libraryTopOrder,
                shuffledLibraryIds,
                shouldShuffle,
                toHandCardIds: toHandCardIds.length > 0
                  ? toHandCardIds
                  : toHandCards.map((card: any) => String(card?.id || '')).filter(Boolean),
                drawnCardId,
                lookedAtCards,
              });

        try {
          if (!pid || !targetPid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesPonderStep = (step: any): boolean => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.PONDER_EFFECT)) {
                  return false;
                }
                if (String(step?.playerId || '') !== pid) {
                  return false;
                }
                if (effectId && String(step?.effectId || '') === effectId) {
                  return true;
                }
                if (targetPid && String(step?.targetPlayerId || pid) !== targetPid) {
                  return false;
                }
                if (sourceName && String(step?.sourceName || '') === sourceName) {
                  return true;
                }
                return Boolean(variant) && String(step?.variant || '') === variant;
              };

              const activeStepMatched = matchesPonderStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesPonderStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const targetZones = zones[targetPid] = zones[targetPid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          targetZones.library = libraryAfter;
          targetZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(targetPid, cloneLibraryCards(libraryAfter));
          }

          if (toHandCards.length > 0) {
            playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
            for (const card of toHandCards) {
              (playerZones.hand as any[]).push({ ...card, zone: 'hand' });
            }
            playerZones.handCount = (playerZones.hand as any[]).length;
          }

          if (drawnCard) {
            playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
            (playerZones.hand as any[]).push({ ...drawnCard, zone: 'hand' });
            playerZones.handCount = (playerZones.hand as any[]).length;
          }

          if (stateAny.pendingPonder && typeof stateAny.pendingPonder === 'object') {
            delete stateAny.pendingPonder[pid];
            if (Object.keys(stateAny.pendingPonder).length === 0) {
              delete stateAny.pendingPonder;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ponderEffectResolve): failed', err);
        }
        break;
      }

      case "bottomOrderResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const orderedCardIds = Array.isArray((e as any).orderedCardIds)
          ? ((e as any).orderedCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffleAfter = (e as any).shuffleAfter === true;
        const bottomCards = Array.isArray((e as any).bottomCards) ? (e as any).bottomCards as any[] : [];
        const shuffledLibraryIds = Array.isArray((e as any).shuffledLibraryIds)
          ? ((e as any).shuffledLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        let libraryAfter = libraryAfterSnapshot;
        if (!hasLibraryAfterField) {
          libraryAfter = buildLibraryAfterAppendOrderedBottom(
            getPlayerLibraryFromContext(ctx, pid),
            orderedCardIds,
            bottomCards,
          );
          if (shuffleAfter && shuffledLibraryIds.length > 0) {
            libraryAfter = reorderLibraryByIdList(libraryAfter, shuffledLibraryIds);
          }
        }
        const matchesCardSet = (cards: any): boolean => {
          const candidateIds = Array.isArray(cards)
            ? cards.map((card: any) => String(card?.id || '')).filter(Boolean)
            : [];
          return orderedCardIds.length > 0
            && candidateIds.length === orderedCardIds.length
            && candidateIds.every((id: string) => orderedCardIds.includes(id));
        };

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesBottomOrderStep = (step: any): boolean => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.BOTTOM_ORDER)) {
                  return false;
                }
                if (String(step?.playerId || '') !== pid) {
                  return false;
                }
                if (effectId && String(step?.effectId || '') === effectId) {
                  return true;
                }
                if (sourceId && String(step?.sourceId || '') === sourceId && matchesCardSet(step?.cards)) {
                  return true;
                }
                if (sourceName && String(step?.sourceName || '') === sourceName && matchesCardSet(step?.cards)) {
                  return true;
                }
                return false;
              };

              const activeStepMatched = matchesBottomOrderStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesBottomOrderStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          if (stateAny.pendingBottomOrder && typeof stateAny.pendingBottomOrder === 'object') {
            const existing = Array.isArray(stateAny.pendingBottomOrder[pid]) ? stateAny.pendingBottomOrder[pid] : [];
            stateAny.pendingBottomOrder[pid] = existing.filter((entry: any) => {
              if (!entry || typeof entry !== 'object') {
                return false;
              }
              if (effectId && String(entry.effectId || '') === effectId) {
                return false;
              }
              if (sourceId && String(entry.sourceId || '') === sourceId && matchesCardSet(entry.cards)) {
                return false;
              }
              if (sourceName && String(entry.sourceName || '') === sourceName && matchesCardSet(entry.cards)) {
                return false;
              }
              return true;
            });

            if (!Array.isArray(stateAny.pendingBottomOrder[pid]) || stateAny.pendingBottomOrder[pid].length === 0) {
              delete stateAny.pendingBottomOrder[pid];
            }
            if (Object.keys(stateAny.pendingBottomOrder).length === 0) {
              delete stateAny.pendingBottomOrder;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(bottomOrderResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
