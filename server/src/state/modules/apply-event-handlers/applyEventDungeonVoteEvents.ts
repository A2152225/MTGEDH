// server/src/state/modules/apply-event-handlers/applyEventDungeonVoteEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Dungeon venture/room progression plus Divine Reckoning and Prisoner's Dilemma batches.
// Public entry: applyDungeonVoteEvents(ctx, e) -> true when it handled the event.
//
// Handles: divineReckoningChoiceResolve, divineReckoningBatchResolve, prisonersDilemmaChoiceResolve, prisonersDilemmaBatchResolve, dungeonRoomPenaltyChoiceResolve, dungeonRoomFreeCastChoiceResolve, dungeonRoomThroneResolve, ventureChooseDungeonResolve, ventureChooseRoomResolve, dungeonTargetPlayerResolve, dungeonTargetCreatureResolve, choosePileFromSplitResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { movePermanentToGraveyard } from "../counters_tokens";
import {
  applyDivineReckoningBatchResult,
  applyPrisonersDilemmaBatchResult,
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
  recordDivineReckoningChoice,
  recordPrisonersDilemmaChoice,
} from "../spellLegacyChoiceBatchUtils.js";
import {
  clearReplayQueuedSteps,
  matchesDungeonRoomPenaltyChoiceStep,
  matchesDungeonRoomFreeCastChoiceStep,
  matchesDungeonRoomThroneChoiceStep,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterSearchResolve,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { markDungeonCompleted, normalizeDungeonProgress } from "../dungeons.js";
import {
  applyAutomaticDungeonRoomEffect,
  applyDungeonTargetCreatureEffect,
  applyDungeonTargetPlayerEffect,
} from "../dungeon-effects.js";
import { maybeResumeDeferredOracleIrStackSpell } from "../oracleIrDeferredStackFinalize.js";

export function applyDungeonVoteEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "choosePileFromSplitResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return false;
            });
          }

          const action = String((e as any).action || '').trim();
          if (action === 'move_cards') {
            const movePlayerId = String((e as any).movePlayerId || '').trim();
            const chosenDestination = String((e as any).chosenDestination || '').trim();
            const otherDestination = String((e as any).otherDestination || '').trim();
            const chosenCards = Array.isArray((e as any).chosenCards)
              ? ((e as any).chosenCards as any[]).map((card: any) => ({ ...card }))
              : [];
            const otherCards = Array.isArray((e as any).otherCards)
              ? ((e as any).otherCards as any[]).map((card: any) => ({ ...card }))
              : [];
            if (!movePlayerId || !chosenDestination || !otherDestination) break;

            const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
            const z = (zones[movePlayerId] = zones[movePlayerId] || {
              library: [],
              libraryCount: 0,
              hand: [],
              handCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            });

            const chosenZone: any[] = Array.isArray((z as any)[chosenDestination]) ? (z as any)[chosenDestination] : [];
            const otherZone: any[] = Array.isArray((z as any)[otherDestination]) ? (z as any)[otherDestination] : [];

            for (const card of chosenCards) chosenZone.push({ ...card, zone: chosenDestination });
            for (const card of otherCards) otherZone.push({ ...card, zone: otherDestination });

            (z as any)[chosenDestination] = chosenZone;
            (z as any)[otherDestination] = otherZone;
            if (chosenDestination === 'hand') z.handCount = chosenZone.length;
            if (chosenDestination === 'library') z.libraryCount = chosenZone.length;
            if (otherDestination === 'hand') z.handCount = otherZone.length;
            if (otherDestination === 'library') z.libraryCount = otherZone.length;
          } else if (action === 'sacrifice_permanents') {
            const permanentIds = Array.isArray((e as any).permanentIds)
              ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
              : [];
            for (const permanentId of permanentIds) {
              const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
              if (!permanent) continue;
              const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                ? { ...(permanent.card || {}), zone: 'graveyard' }
                : null;
              const graveyardOwnerId = String(permanent?.owner || permanent?.controller || (e as any).targetPlayerId || '').trim();
              movePermanentToGraveyard(ctx as any, permanentId, true);

              if (tokenGraveyardSnapshot && graveyardOwnerId) {
                const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                  hand: [],
                  handCount: 0,
                  libraryCount: 0,
                  graveyard: [],
                  graveyardCount: 0,
                  exile: [],
                  exileCount: 0,
                });
                playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                  if (!card) return false;
                  const cardId = String((card as any).id || '').trim();
                  const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                  if (cardId && snapshotId) return cardId === snapshotId;
                  return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                });

                if (!alreadyPresent) {
                  (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                  playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePileFromSplitResolve): failed', err);
        }
        break;
      }

      case "divineReckoningChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const selectedPermanentId = String((e as any).selectedPermanentId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim() || undefined;
          const sourceName = String((e as any).sourceName || 'Divine Reckoning').trim() || 'Divine Reckoning';
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && resolvedStepId) {
            clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === resolvedStepId);
          }

          if (batchId) {
            createDivineReckoningChoiceBatch(ctx.state, {
              id: batchId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          if (batchId && playerId && selectedPermanentId) {
            recordDivineReckoningChoice(ctx.state, batchId, {
              playerId,
              permanentId: selectedPermanentId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          ctx.bumpSeq();
          maybeResumeDeferredOracleIrStackSpell(ctx);
        } catch (err) {
          debugWarn(1, 'applyEvent(divineReckoningChoiceResolve): failed', err);
        }
        break;
      }

      case "divineReckoningBatchResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const survivorIds = Array.isArray((e as any).survivorIds)
            ? ((e as any).survivorIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && batchId) {
            clearReplayQueuedSteps(gameId, (step: any) => String((step as any)?.divineReckoningBatchId || '').trim() === batchId);
          }

          applyDivineReckoningBatchResult(ctx as any, survivorIds);
          clearDivineReckoningChoiceBatch(ctx.state, batchId);

          ctx.bumpSeq();
          maybeResumeDeferredOracleIrStackSpell(ctx);
        } catch (err) {
          debugWarn(1, 'applyEvent(divineReckoningBatchResolve): failed', err);
        }
        break;
      }

      case "prisonersDilemmaChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const choice = String((e as any).choice || '').trim().toLowerCase();
          const sourceId = String((e as any).sourceId || '').trim() || undefined;
          const sourceName = String((e as any).sourceName || "Prisoner's Dilemma").trim() || "Prisoner's Dilemma";
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && resolvedStepId) {
            clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === resolvedStepId);
          }

          if (batchId) {
            createPrisonersDilemmaChoiceBatch(ctx.state, {
              id: batchId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          if (batchId && playerId && (choice === 'silence' || choice === 'snitch')) {
            recordPrisonersDilemmaChoice(ctx.state, batchId, {
              playerId,
              choice,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          ctx.bumpSeq();
          maybeResumeDeferredOracleIrStackSpell(ctx);
        } catch (err) {
          debugWarn(1, 'applyEvent(prisonersDilemmaChoiceResolve): failed', err);
        }
        break;
      }

      case "prisonersDilemmaBatchResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          const choices = (e as any).choices && typeof (e as any).choices === 'object' && !Array.isArray((e as any).choices)
            ? Object.fromEntries(
                Object.entries((e as any).choices)
                  .map(([playerId, choice]) => [String(playerId || '').trim(), String(choice || '').trim().toLowerCase()])
                  .filter(([playerId, choice]) => Boolean(playerId) && (choice === 'silence' || choice === 'snitch')),
              ) as Record<string, string>
            : {};
          const damageByPlayerId = (e as any).damageByPlayerId && typeof (e as any).damageByPlayerId === 'object' && !Array.isArray((e as any).damageByPlayerId)
            ? Object.fromEntries(
                Object.entries((e as any).damageByPlayerId)
                  .map(([playerId, amount]) => [String(playerId || '').trim(), Number(amount || 0)])
                  .filter(([playerId, amount]) => Boolean(playerId) && Number(amount) > 0),
              ) as Record<string, number>
            : undefined;

          if (gameId && batchId) {
            clearReplayQueuedSteps(gameId, (step: any) => String((step as any)?.prisonersDilemmaBatchId || '').trim() === batchId);
          }

          applyPrisonersDilemmaBatchResult(ctx as any, {
            expectedPlayerIds,
            choices,
            damageByPlayerId,
          });
          clearPrisonersDilemmaChoiceBatch(ctx.state, batchId);

          ctx.bumpSeq();
          maybeResumeDeferredOracleIrStackSpell(ctx);
        } catch (err) {
          debugWarn(1, 'applyEvent(prisonersDilemmaBatchResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomPenaltyChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choice = String((e as any).choice || '').trim().toLowerCase();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPenaltyChoiceStep(step, e as any);
            });
          }

          if (choice === 'lose_life') {
            applyDungeonTargetPlayerEffect(ctx as any, String((e as any).playerId || '').trim() as any, {
              dungeonId: String((e as any).dungeonId || '').trim(),
              roomId: String((e as any).currentRoomId || '').trim(),
              amount: Number((e as any).amount || 0),
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomPenaltyChoiceResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomFreeCastChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomFreeCastChoiceStep(step, e as any);
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomFreeCastChoiceResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomThroneResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const selectedCard = (e as any).selectedCard;
          const createdPermanentId = String((e as any).createdPermanentId || '').trim();
          const selectedCardId = String((e as any).selectedCardId || selectedCard?.id || '').trim();
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const libraryAfterSnapshot = hasLibraryAfterField
            ? cloneLibraryCards((e as any).libraryAfter as any[])
            : [];
          const libraryAfter = hasLibraryAfterField
            ? libraryAfterSnapshot
            : buildLibraryAfterSearchResolve(
                getPlayerLibraryFromContext(ctx, playerId),
                selectedCardId ? [selectedCardId] : [],
                remainingLibraryIds.length > 0 ? remainingLibraryIds : undefined,
              );
          const turnApplied = Number((e as any).turnApplied || 0);
          const sourceName = String((e as any).sourceName || 'Throne of the Dead Three').trim() || 'Throne of the Dead Three';

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomThroneChoiceStep(step, e as any);
            });
          }

          if (playerId) {
            const zones = ctx.state.zones = ctx.state.zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            z.libraryCount = libraryAfter.length;
            if (ctx.libraries?.set) {
              ctx.libraries.set(playerId, cloneLibraryCards(libraryAfter));
            }
          }

          if (playerId && selectedCard && createdPermanentId) {
            ctx.state.battlefield = ctx.state.battlefield || [];
            const existingPermanent = (ctx.state.battlefield as any[]).find((permanent: any) => String(permanent?.id || '') === createdPermanentId);
            if (!existingPermanent) {
              const typeLine = String(selectedCard?.type_line || '');
              const isCreature = typeLine.toLowerCase().includes('creature');
              const rawPower = selectedCard?.power;
              const rawToughness = selectedCard?.toughness;
              const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
              const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;

              (ctx.state.battlefield as any[]).push({
                id: createdPermanentId,
                controller: playerId,
                owner: playerId,
                tapped: false,
                counters: { '+1/+1': 3 },
                ...(power != null ? { basePower: power } : {}),
                ...(toughness != null ? { baseToughness: toughness } : {}),
                summoningSickness: isCreature,
                grantedAbilities: ['Hexproof'],
                untilNextTurnGrants: [{
                  controllerId: playerId,
                  turnApplied,
                  grantedAbilities: ['Hexproof'],
                  sourceName,
                  kind: 'hexproof',
                }],
                card: { ...selectedCard, zone: 'battlefield' },
              } as any);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomThroneResolve): failed', err);
        }
        break;
      }

      case "ventureChooseDungeonResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          if (!playerId) break;

          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.ventureChooseDungeon === true &&
                String(step?.playerId || '').trim() === playerId
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.dungeonProgress = stateAny.dungeonProgress || {};
          const normalizedProgress = normalizeDungeonProgress(e);
          if (!normalizedProgress) break;
          stateAny.dungeonProgress[playerId] = normalizedProgress;
          applyAutomaticDungeonRoomEffect(ctx as any, playerId as any, normalizedProgress);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ventureChooseDungeonResolve): failed', err);
        }
        break;
      }

      case "ventureChooseRoomResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          if (!playerId) break;

          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const dungeonId = String((e as any).dungeonId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.ventureChooseRoom === true &&
                String(step?.playerId || '').trim() === playerId &&
                (!dungeonId || String((step as any)?.ventureDungeonId || '').trim() === dungeonId)
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.dungeonProgress = stateAny.dungeonProgress || {};
          const normalizedProgress = normalizeDungeonProgress(e);
          if (!normalizedProgress) break;
          applyAutomaticDungeonRoomEffect(ctx as any, playerId as any, normalizedProgress);

          if ((e as any).completed === true) {
            markDungeonCompleted(stateAny, playerId, String(normalizedProgress.dungeonName || '').trim());
            delete stateAny.dungeonProgress[playerId];
          } else {
            stateAny.dungeonProgress[playerId] = normalizedProgress;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ventureChooseRoomResolve): failed', err);
        }
        break;
      }

      case "dungeonTargetPlayerResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const selectedPlayerId = String((e as any).selectedPlayerId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                (step as any)?.dungeonTargetPlayerEffect != null &&
                String(step?.playerId || '').trim() === String((e as any).playerId || '').trim() &&
                String((step as any)?.dungeonTargetPlayerEffect?.dungeonId || '').trim() === String((e as any).dungeonId || '').trim() &&
                String((step as any)?.dungeonTargetPlayerEffect?.roomId || '').trim() === String((e as any).currentRoomId || '').trim()
              );
            });
          }

          applyDungeonTargetPlayerEffect(ctx as any, selectedPlayerId as any, {
            dungeonId: String((e as any).dungeonId || '').trim(),
            roomId: String((e as any).currentRoomId || '').trim(),
            amount: Number((e as any).amount || 0),
          });

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonTargetPlayerResolve): failed', err);
        }
        break;
      }

      case "dungeonTargetCreatureResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const selectedPermanentId = String((e as any).selectedPermanentId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                (step as any)?.dungeonTargetCreatureEffect != null &&
                String(step?.playerId || '').trim() === String((e as any).playerId || '').trim() &&
                String((step as any)?.dungeonTargetCreatureEffect?.dungeonId || '').trim() === String((e as any).dungeonId || '').trim() &&
                String((step as any)?.dungeonTargetCreatureEffect?.roomId || '').trim() === String((e as any).currentRoomId || '').trim()
              );
            });
          }

          applyDungeonTargetCreatureEffect(
            ctx as any,
            selectedPermanentId,
            String((e as any).goadedByPlayerId || (e as any).playerId || '').trim() as any,
            {
              dungeonId: String((e as any).dungeonId || '').trim(),
              roomId: String((e as any).currentRoomId || '').trim(),
              amount: Number((e as any).amount || 0),
              counterType: String((e as any).counterType || '').trim() || undefined,
              powerDelta: Number((e as any).powerDelta || 0),
              toughnessDelta: Number((e as any).toughnessDelta || 0),
              grantText: String((e as any).grantText || '').trim() || undefined,
              sourceName: String((e as any).sourceName || '').trim() || undefined,
            },
          );

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonTargetCreatureResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
