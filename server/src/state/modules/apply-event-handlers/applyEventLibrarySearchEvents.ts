// server/src/state/modules/apply-event-handlers/applyEventLibrarySearchEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Library search selection/resolution, chosen creature type, and permanent copy resolution.
// Public entry: applyLibrarySearchEvents(ctx, e) -> true when it handled the event.
//
// Handles: librarySearchSelect, librarySearchResolve, creatureTypeSelected, permanentBecomeCopyResolve
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { applyArcaneAdaptationToControllerCreatures } from "../chosen-creature-type.js";
import { runSBA } from "../counters_tokens.js";
import { applyPermanentBecomeCopyOfTargetPermanent } from "../permanent-copy.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../durable-permissions.js";
import { generateDeterministicId, clearReplayQueuedSteps } from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  resolveReplayPermanentByEvent,
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterSearchResolve,
  eventHasOwnField,
  pickMutablePlayerLibrary,
  writePlayerLibrary,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import {
  restoreOracleIrLedgerOnState,
  restoreOracleIrPendingCompoundResumeOnState,
  clearOracleIrPendingCompoundResumeOnState,
} from "../oracleIrTransitionPipeline.js";
import { ensureDeferredOracleIrStackItem } from "../oracleIrDeferredStackFinalize.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export function applyLibrarySearchEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "librarySearchSelect": {
        // Select cards from library search (tutor effects)
        const pid = (e as any).playerId;
        // Support both field names for backward compatibility
        const cardIds = (e as any).selectedCardIds as string[] || (e as any).cardIds as string[] || [];
        const destination = (e as any).moveTo || (e as any).destination || "hand";
        try {
          if (pid && cardIds.length > 0) {
            const lib = pickMutablePlayerLibrary(ctx, pid);
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
                  stampPermanentEntryTimestamp(ctx.state, ctx.state.battlefield[ctx.state.battlefield.length - 1]);
                } else if (destination === "top") {
                  lib.unshift({ ...card, zone: "library" });
                }
              }
            }
            
            z.handCount = (z.hand as any[]).length;
            writePlayerLibrary(ctx, pid, lib);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(librarySearchSelect): failed", err);
        }
        break;
      }

      case "librarySearchResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const searchOwnerId = String((e as any).searchOwnerId || pid).trim() || pid;
        const destination = String((e as any).destination || 'hand');
        const sourceId = String((e as any).sourceId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const abilityId = String((e as any).abilityId || '').trim();
        const entersTapped = (e as any).entersTapped === true;
        const splitAssignments = (e as any).splitAssignments as { toBattlefield?: string[]; toHand?: string[] } | undefined;
        const destinationFaceDown = (e as any).destinationFaceDown === true;
        const grantPlayableFromExileToController = (e as any).grantPlayableFromExileToController === true;
        const grantPlayableFromExileControllerId = String((e as any).grantPlayableFromExileControllerId || searchOwnerId).trim() || searchOwnerId;
        const grantPlayableFromExileSpendManaAsThoughAnyType = (e as any).grantPlayableFromExileSpendManaAsThoughAnyType === true;
        const playableFromExileTypeKey = String((e as any).playableFromExileTypeKey || '').toLowerCase();
        const pendingBottomOrder = (e as any).pendingBottomOrder && typeof (e as any).pendingBottomOrder === 'object'
          ? (e as any).pendingBottomOrder as Record<string, any>
          : undefined;
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const selectedCards = Array.isArray((e as any).selectedCards) ? (e as any).selectedCards as any[] : [];
        const selectedCardMap = new Map(selectedCards.map((card: any) => [String(card?.id || ''), card]));
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const selectedIds = Array.isArray((e as any).selectedCardIds)
          ? ((e as any).selectedCardIds as any[]).map((id: any) => String(id)).filter(Boolean)
          : selectedCards.map((card: any) => String(card?.id || '')).filter(Boolean);
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryAfterSearchResolve(
              getPlayerLibraryFromContext(ctx, searchOwnerId),
              selectedIds,
              eventHasOwnField(e, 'remainingLibraryIds') ? remainingLibraryIds : undefined,
            );

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();

          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesResolvedSearchStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) {
                  return true;
                }
                if (!step || String(step?.type || '') !== String(ResolutionStepType.LIBRARY_SEARCH)) {
                  return false;
                }

                if (String(step?.playerId || '') !== pid) {
                  return false;
                }

                const queuedSourceId = String(step?.sourceId || '').trim();
                const queuedSourceName = String(step?.sourceName || '').trim();
                const queuedAbilityId = String(step?.persistLibrarySearchResolveAbilityId || step?.abilityId || '').trim();

                if (sourceId && queuedSourceId === sourceId) {
                  return true;
                }

                if (abilityId && queuedAbilityId === abilityId) {
                  return true;
                }

                return Boolean(sourceName) && queuedSourceName === sourceName;
              };

              const activeStepMatched = matchesResolvedSearchStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }

              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesResolvedSearchStep(step));
              }

              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const zones = ctx.state.zones || {};
          const z = zones[searchOwnerId] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          zones[searchOwnerId] = z;

          if (Array.isArray(ctx.state.stack) && ctx.state.stack.length > 0) {
            ctx.state.stack = ctx.state.stack.filter((item: any) => {
              if (!item || String(item.abilityType || '') !== 'fetch-land') {
                return true;
              }

              const sameController = String(item.controller || '') === pid;
              const sameSource = sourceId.length > 0 && String(item.source || '') === sourceId;
              const sameName = sourceName.length > 0 && String(item.sourceName || '') === sourceName;
              const sameAbilityId = abilityId.length > 0 && String(item.abilityId || '') === abilityId;

              if (!sameController) {
                return true;
              }

              if (sameSource || sameAbilityId) {
                return false;
              }

              if (sameName && sourceId.length === 0 && abilityId.length === 0) {
                return false;
              }

              return true;
            });
          }

          (z as any).library = libraryAfter;
          writePlayerLibrary(ctx, searchOwnerId, cloneLibraryCards(libraryAfter));

          const moveToBattlefield = (card: any) => {
            if (!card) return;
            const typeLine = String(card?.type_line || '').toLowerCase();
            const isCreature = typeLine.includes('creature');
            ctx.state.battlefield = ctx.state.battlefield || [];
            const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(card?.id || 'library_search'));
            (ctx.state.battlefield as any[]).push({
              id: createdPermanentId,
              controller: pid,
              owner: pid,
              tapped: entersTapped,
              counters: {},
              basePower: isCreature ? parseInt(card?.power || '0', 10) : undefined,
              baseToughness: isCreature ? parseInt(card?.toughness || '0', 10) : undefined,
              summoningSickness: isCreature,
              card: { ...card, zone: 'battlefield' },
            } as any);
          };

          const moveToHand = (card: any) => {
            if (!card) return;
            z.hand = Array.isArray(z.hand) ? z.hand : [];
            (z.hand as any[]).push({ ...card, zone: 'hand' });
            z.handCount = (z.hand as any[]).length;
          };

          const moveToGraveyardZone = (card: any) => {
            if (!card) return;
            z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
            (z.graveyard as any[]).push({ ...card, zone: 'graveyard' });
            z.graveyardCount = (z.graveyard as any[]).length;
          };

          const moveToExileZone = (card: any) => {
            if (!card) return;
            z.exile = Array.isArray(z.exile) ? z.exile : [];
            const exiledCard = {
              ...card,
              zone: 'exile',
              ...(destinationFaceDown ? { faceDown: true } : {}),
              ...(grantPlayableFromExileToController ? {
                canBePlayedBy: grantPlayableFromExileControllerId,
                playableUntilTurn: true,
                ...(grantPlayableFromExileSpendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
              } : null),
            };
            (z.exile as any[]).push(exiledCard);
            z.exileCount = (z.exile as any[]).length;

            if (grantPlayableFromExileToController) {
              const typeLine = String(exiledCard?.type_line || '').toLowerCase();
              const passesTypeGate = !playableFromExileTypeKey || typeLine.includes(playableFromExileTypeKey);
              if (passesTypeGate) {
                const stateAny = ctx.state as any;
                stateAny.playableFromExile = stateAny.playableFromExile || {};
                const entry = (stateAny.playableFromExile[grantPlayableFromExileControllerId] = stateAny.playableFromExile[grantPlayableFromExileControllerId] || {});
                entry[String(exiledCard.id)] = true;
                upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
                  playerId: grantPlayableFromExileControllerId as PlayerID,
                  cardIds: [String(exiledCard.id)],
                  action: 'play',
                  duration: 'static',
                  turnApplied: Number(stateAny.turnNumber || 0),
                  sourceId,
                  sourceName,
                  spendManaAsThoughAnyType: grantPlayableFromExileSpendManaAsThoughAnyType,
                }));
              }
            }
          };

          if (splitAssignments) {
            for (const cardId of splitAssignments.toBattlefield || []) {
              moveToBattlefield(selectedCardMap.get(String(cardId)));
            }
            for (const cardId of splitAssignments.toHand || []) {
              moveToHand(selectedCardMap.get(String(cardId)));
            }
          } else {
            for (const cardId of selectedIds) {
              const card = selectedCardMap.get(cardId);
              if (!card) continue;
              if (destination === 'battlefield') {
                moveToBattlefield(card);
              } else if (destination === 'hand') {
                moveToHand(card);
              } else if (destination === 'graveyard') {
                moveToGraveyardZone(card);
              } else if (destination === 'exile') {
                moveToExileZone(card);
              }
            }
          }

          const lifeLoss = Number((e as any).lifeLoss || 0);
          if (Number.isFinite(lifeLoss) && lifeLoss > 0) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            const currentLife = Number((ctx.state as any).life?.[pid] ?? 40);
            (ctx.state as any).life[pid] = currentLife - lifeLoss;
          }

          if (pendingBottomOrder) {
            const stateAny = ctx.state as any;
            stateAny.pendingBottomOrder = stateAny.pendingBottomOrder || {};
            const pendingList = Array.isArray(stateAny.pendingBottomOrder[pid]) ? stateAny.pendingBottomOrder[pid] : [];
            pendingList.push({
              effectId: String(pendingBottomOrder.effectId || ''),
              sourceId: String(pendingBottomOrder.sourceId || sourceId || ''),
              sourceName: String(pendingBottomOrder.sourceName || sourceName || ''),
              sourceImage: pendingBottomOrder.sourceImage,
              description: String(pendingBottomOrder.description || `${sourceName || 'Effect'}: Put cards on the bottom in any order.`),
              cards: cloneLibraryCards(Array.isArray(pendingBottomOrder.cards) ? pendingBottomOrder.cards as any[] : []),
              shuffleAfter: pendingBottomOrder.shuffleAfter === true,
              queued: false,
            });
            stateAny.pendingBottomOrder[pid] = pendingList;
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          if (hasLibraryAfterField && libraryAfterSnapshot.length > 0) {
            // Shuffle-only compound resume is already captured in libraryAfter; do not
            // restore pending resume or finalizeGameStateAfterReplay will re-shuffle.
            clearOracleIrPendingCompoundResumeOnState(ctx.state);
          } else {
            restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          }

          ctx.bumpSeq();
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(librarySearchResolve): failed', err);
        }
        break;
      }

      case "creatureTypeSelected": {
        // Creature type selection (e.g., Cavern of Souls, Metallic Mimic)
        const permId = (e as any).permanentId;
        const playerId = (e as any).playerId;
        const creatureType = (e as any).creatureType;
        const cardName = (e as any).cardName;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.CREATURE_TYPE_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              if (String((step as any)?.type || '').trim() !== resolvedStepType) return false;
              if (playerId && String((step as any)?.playerId || '').trim() !== String(playerId || '').trim()) return false;
              const stepPermanentId = String((step as any)?.permanentId || (step as any)?.sourceId || '').trim();
              if (permId && stepPermanentId && stepPermanentId === String(permId || '').trim()) return true;
              if (!cardName) return !permId;
              const stepCardName = String((step as any)?.cardName || (step as any)?.sourceName || '').trim().toLowerCase();
              return stepCardName !== '' && stepCardName === String(cardName || '').trim().toLowerCase();
            });
          }

          const spellId = String((e as any).spellId || '').trim();
          if (spellId && creatureType) {
            const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
            const spellOnStack = stack.find((item: any) => item && (String(item.id || '') === spellId || String(item.cardId || '') === spellId));
            if (spellOnStack) {
              (spellOnStack as any).chosenCreatureType = creatureType;
              if (spellOnStack.card && typeof spellOnStack.card === 'object') {
                (spellOnStack.card as any).chosenCreatureType = creatureType;
              }
            }
          } else if (permId && creatureType) {
            const perm = resolveReplayPermanentByEvent(ctx, {
              permanentId: permId,
              playerId,
              cardName,
            });
            if (perm) {
              (perm as any).chosenCreatureType = creatureType;
              if (perm.card && typeof perm.card === 'object') {
                (perm.card as any).chosenCreatureType = creatureType;
              }

              const permCardName = String((perm as any)?.card?.name || '').toLowerCase();
              if (permCardName.includes('arcane adaptation')) {
                const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
                applyArcaneAdaptationToControllerCreatures(
                  battlefield,
                  String((perm as any)?.controller || playerId || ''),
                  String(creatureType),
                );
              }
              if (permCardName.includes('morophon')) {
                const stateAny = ctx.state as any;
                const morophonChosenType = (stateAny.morophonChosenType || {}) as Record<string, string>;
                morophonChosenType[String((perm as any)?.id || permId)] = String(creatureType);
                if (permId && String((perm as any)?.id || '') !== String(permId)) {
                  morophonChosenType[String(permId)] = String(creatureType);
                }
                stateAny.morophonChosenType = morophonChosenType;
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(creatureTypeSelected): failed", err);
        }
        break;
      }

      case "permanentBecomeCopyResolve": {
        const copyOntoPermanentId = String((e as any).copyOntoPermanentId || '').trim();
        const copyFromPermanentId = String((e as any).copyFromPermanentId || '').trim();
        const retainedAbilityText = String((e as any).retainedAbilityText || '').trim() || undefined;
        const playerId = (e as any).playerId;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepAction = String((step as any)?.action || '').trim();
              if (
                stepAction !== 'self_become_copy_of_creature' &&
                stepAction !== 'other_become_copy_of_creature'
              ) {
                return false;
              }
              return (
                String((step as any)?.type || '').trim() === ResolutionStepType.TARGET_SELECTION &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!copyOntoPermanentId || String((step as any)?.selfBecomeCopySourcePermanentId || (step as any)?.sourceId || '').trim() === copyOntoPermanentId)
              );
            });
          }

          if (copyOntoPermanentId && copyFromPermanentId) {
            applyPermanentBecomeCopyOfTargetPermanent(
              ctx.state,
              copyOntoPermanentId,
              copyFromPermanentId,
              retainedAbilityText,
            );
            if ((e as any).enterTappedIfCopied === true) {
              const copiedPermanent = (Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [])
                .find((permanent: any) => String(permanent?.id || '') === copyOntoPermanentId);
              if (copiedPermanent) copiedPermanent.tapped = true;
            }
            runSBA(ctx);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(permanentBecomeCopyResolve): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
