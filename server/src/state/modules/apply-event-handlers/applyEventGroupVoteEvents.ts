// server/src/state/modules/apply-event-handlers/applyEventGroupVoteEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Multiplayer group decisions: Kynaios, Join Forces and Tempting Offer sequences.
// Public entry: applyGroupVoteEvents(ctx, e) -> true when it handled the event.
//
// Handles: kynaiosChoiceInitiated, kynaiosChoiceResponse, kynaiosChoiceComplete, joinForcesInitiated, joinForcesContribution, joinForcesComplete, temptingOfferInitiated, temptingOfferResponse, temptingOfferComplete
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { drawCards } from "../zones";
import { triggerETBEffectsForToken } from "../triggerEtbEntryEffects.js";
import { generateDeterministicId, clearReplayQueuedStepById } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { applyJoinForcesPaidManaPowerPump } from "../joinForcesResolutionQueue.js";
import { moveKynaiosLandFromHandToBattlefield } from "../../resolution/handlers/kynaiosChoice.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export function applyGroupVoteEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "kynaiosChoiceInitiated":
      case "kynaiosChoiceResponse":
      case "kynaiosChoiceComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();

          if ((e as any).type === 'kynaiosChoiceInitiated') {
            const sourceController = String((e as any).sourceController || '').trim();
            const controllerDrawCount = Math.max(0, Number((e as any).controllerDrawCount ?? 1) || 0);
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            if (sourceController && controllerDrawCount > 0) {
              drawCards(ctx, sourceController as any, controllerDrawCount);
            }

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.KYNAIOS_CHOICE,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                kynaiosBatchId: String((rawStep as any).kynaiosBatchId || batchId || stepId),
                isController: (rawStep as any).isController === true,
                sourceController: (rawStep as any).sourceController ? String((rawStep as any).sourceController) : undefined,
                canPlayLand: (rawStep as any).canPlayLand !== false,
                landsInHand: Array.isArray((rawStep as any).landsInHand) ? (rawStep as any).landsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                options: Array.isArray((rawStep as any).options) ? (rawStep as any).options.map((option: any) => String(option)) : [],
                landPlayOrFallbackIsController: (rawStep as any).landPlayOrFallbackIsController === true,
                landPlayOrFallbackSourceController: (rawStep as any).landPlayOrFallbackSourceController ? String((rawStep as any).landPlayOrFallbackSourceController) : undefined,
                landPlayOrFallbackCanPlayLand: (rawStep as any).landPlayOrFallbackCanPlayLand !== false,
                landPlayOrFallbackLandsInHand: Array.isArray((rawStep as any).landPlayOrFallbackLandsInHand) ? (rawStep as any).landPlayOrFallbackLandsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                landPlayOrFallbackOptions: Array.isArray((rawStep as any).landPlayOrFallbackOptions) ? (rawStep as any).landPlayOrFallbackOptions.map((option: any) => String(option)) : [],
              } as any, { allowDuringReplay: true, skipEmit: true });
            }
          } else if ((e as any).type === 'kynaiosChoiceResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const stepId = String((e as any).stepId || '').trim();
            const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();
            const choice = String((e as any).choice || 'decline').trim();
            const landCardId = String((e as any).landCardId || '').trim();
            const createdPermanentId = String((e as any).createdPermanentId || '').trim();

            if (choice === 'play_land' && playerId && landCardId) {
              moveKynaiosLandFromHandToBattlefield(ctx as any, playerId as any, landCardId, createdPermanentId || undefined);
            }

            if (gameId && resolvedStepId) {
              clearReplayQueuedStepById(gameId, resolvedStepId);
            }
          } else {
            const sourceController = String((e as any).sourceController || '').trim();
            const drawnPlayerIds = Array.isArray((e as any).drawnPlayerIds)
              ? ((e as any).drawnPlayerIds as any[]).map((playerId: any) => String(playerId || '').trim()).filter(Boolean)
              : [];
            const stateAny = ctx.state as any;
            stateAny.kynaiosFinalizedBatches = stateAny.kynaiosFinalizedBatches || {};
            stateAny.kynaiosFinalizedBatches[batchId] = true;

            for (const playerId of drawnPlayerIds) {
              if (playerId && playerId !== sourceController) {
                drawCards(ctx, playerId as any, 1);
              }
            }

            if (gameId && batchId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.KYNAIOS_CHOICE) &&
                String((step as any).kynaiosBatchId || '') === batchId
              );
              for (const pendingStep of pendingSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(kynaiosChoice*): failed', err);
        }
        break;
      }

      case "joinForcesInitiated":
      case "joinForcesContribution":
      case "joinForcesComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'joinForcesInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.JOIN_FORCES,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                availableMana: Number((rawStep as any).availableMana || 0),
                isInitiator: (rawStep as any).isInitiator === true,
                priority: Number((rawStep as any).priority || 0),
                oracleIrResumeStepsJson: (rawStep as any).oracleIrResumeStepsJson
                  ? String((rawStep as any).oracleIrResumeStepsJson)
                  : undefined,
                oracleIrControllerId: (rawStep as any).oracleIrControllerId
                  ? String((rawStep as any).oracleIrControllerId)
                  : undefined,
                oracleIrSourceId: (rawStep as any).oracleIrSourceId
                  ? String((rawStep as any).oracleIrSourceId)
                  : undefined,
                oracleIrSourceName: (rawStep as any).oracleIrSourceName
                  ? String((rawStep as any).oracleIrSourceName)
                  : undefined,
              } as any);
            }
          } else if ((e as any).type === 'joinForcesContribution') {
            const playerId = String((e as any).playerId || '').trim();
            const contribution = Math.max(0, Math.floor(Number((e as any).contribution || 0)));
            const stepId = String((e as any).stepId || '').trim();
            const tappedPermanentIds = Array.isArray((e as any).tappedPermanentIds)
              ? ((e as any).tappedPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];

            for (const permanentId of tappedPermanentIds) {
              const permanent = (ctx.state.battlefield || []).find((perm: any) => String(perm?.id || '') === permanentId);
              if (permanent) permanent.tapped = true;
            }

            const stateAny = ctx.state as any;
            stateAny.joinForcesContributions = stateAny.joinForcesContributions || {};
            stateAny.joinForcesContributions[cardName] = stateAny.joinForcesContributions[cardName] || {
              total: 0,
              byPlayer: {},
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            stateAny.joinForcesContributions[cardName].total += contribution;
            stateAny.joinForcesContributions[cardName].byPlayer[playerId] = contribution;

            if (gameId && stepId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
                ResolutionQueueManager.completeStep(gameId, stepId, {
                  stepId,
                  playerId: playerId as any,
                  selections: contribution,
                  cancelled: false,
                  timestamp: Date.now(),
                } as any);
              }
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const totalContributions = Math.max(0, Math.floor(Number((e as any).totalContributions || 0)));
            const byPlayer = ((e as any).byPlayer && typeof (e as any).byPlayer === 'object')
              ? { ...((e as any).byPlayer as any) }
              : {};
            const players = (ctx.state.players || []) as any[];
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingJoinForcesSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.JOIN_FORCES) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingJoinForcesSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if ((e as any).oracleIrResumed !== true) {
              if (cardNameLower.includes('minds aglow')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                drawCards(ctx as any, player.id, totalContributions);
              }
            } else if (cardNameLower.includes('collective voyage')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;

                const existingSearch = gameId
                  ? ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                      String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                      String(step?.playerId || '') === playerId &&
                      String(step?.sourceName || '') === 'Collective Voyage')
                  : undefined;
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: `up to ${totalContributions} basic land card(s) (enters tapped)`,
                  mandatory: false,
                  sourceName: 'Collective Voyage',
                  searchCriteria: `up to ${totalContributions} basic land card(s)`,
                  minSelections: 0,
                  maxSelections: totalContributions,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: true,
                  filter: { types: ['land'], supertypes: ['basic'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('alliance of arms')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < totalContributions; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `alliance_of_arms_${playerId}_${index}`);
                  battlefield.push({
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: true,
                    card: {
                      id: tokenId,
                      name: 'Soldier Token',
                      type_line: 'Token Creature — Soldier',
                      power: '1',
                      toughness: '1',
                      colors: ['W'],
                    },
                  });
                  stampPermanentEntryTimestamp(ctx.state, battlefield[battlefield.length - 1]);
                }
              }
            } else if (cardNameLower.includes('shared trauma')) {
              const stateAny = ctx.state as any;
              stateAny.pendingMill = stateAny.pendingMill || {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;
                stateAny.pendingMill[playerId] = (stateAny.pendingMill[playerId] || 0) + totalContributions;
              }
            } else {
              applyJoinForcesPaidManaPowerPump(battlefield, {
                cardName,
                totalContributions,
                effectDescription: String((e as any).effectDescription || ''),
                sourcePermanentId: String((e as any).sourcePermanentId || '').trim() || undefined,
              });
            }

            }

            const stateAny = ctx.state as any;
            if (stateAny.joinForcesContributions && cardName) {
              delete stateAny.joinForcesContributions[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(joinForces*): failed', err);
        }
        break;
      }

      case "temptingOfferInitiated":
      case "temptingOfferResponse":
      case "temptingOfferComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'temptingOfferInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.TEMPTING_OFFER,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                isOpponent: (rawStep as any).isOpponent === true,
                priority: Number((rawStep as any).priority || 0),
              } as any);
            }
          } else if ((e as any).type === 'temptingOfferResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const accepted = (e as any).accepted === true;
            const stepId = String((e as any).stepId || '').trim();
            const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();

            const stateAny = ctx.state as any;
            stateAny.temptingOfferResponses = stateAny.temptingOfferResponses || {};
            stateAny.temptingOfferResponses[cardName] = stateAny.temptingOfferResponses[cardName] || {
              acceptedBy: [],
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            if (accepted) {
              const acceptedBy = stateAny.temptingOfferResponses[cardName].acceptedBy;
              if (!acceptedBy.includes(playerId)) {
                acceptedBy.push(playerId);
              }
            }

            if (gameId && resolvedStepId) {
              clearReplayQueuedStepById(gameId, resolvedStepId);
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const acceptedBy = Array.isArray((e as any).acceptedBy)
              ? ((e as any).acceptedBy as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];
            const initiatorBonusCount = Math.max(1, Math.floor(Number((e as any).initiatorBonusCount || (1 + acceptedBy.length))));
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const players = (ctx.state.players || []) as any[];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingTemptingOfferSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.TEMPTING_OFFER) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingTemptingOfferSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if (cardNameLower.includes('discovery')) {
              const targets = [initiator, ...acceptedBy].filter(Boolean);
              for (const playerId of targets) {
                if (!gameId) continue;
                const maxSelections = playerId === initiator ? initiatorBonusCount : 1;
                const existingSearch = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                  String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                  String(step?.playerId || '') === playerId &&
                  String(step?.sourceName || '') === 'Tempt with Discovery'
                );
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: playerId === initiator ? `up to ${maxSelections} land card(s) (enters untapped)` : 'a land card (enters untapped)',
                  mandatory: false,
                  sourceName: 'Tempt with Discovery',
                  searchCriteria: playerId === initiator ? `up to ${maxSelections} land card(s)` : 'a land card',
                  minSelections: 0,
                  maxSelections,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: false,
                  filter: { types: ['land'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('glory')) {
              const initiatorCreatures = battlefield.filter((perm: any) =>
                String(perm?.controller || '') === initiator && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
              );
              for (const creature of initiatorCreatures) {
                const counters = { ...(creature.counters || {}) } as Record<string, number>;
                counters['+1/+1'] = (counters['+1/+1'] || 0) + initiatorBonusCount;
                creature.counters = counters;
              }

              for (const opponentId of acceptedBy) {
                const opponentCreatures = battlefield.filter((perm: any) =>
                  String(perm?.controller || '') === opponentId && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
                );
                for (const creature of opponentCreatures) {
                  const counters = { ...(creature.counters || {}) } as Record<string, number>;
                  counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                  creature.counters = counters;
                }
              }
            } else if (cardNameLower.includes('vengeance') || cardNameLower.includes('bunnies')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              const xValue = Math.max(1, Math.floor(Number((e as any).xValue || 3)));
              const isVengeance = cardNameLower.includes('vengeance');
              const tokenName = isVengeance ? 'Elemental' : 'Rabbit';
              const colors = isVengeance ? ['R'] : ['W'];
              const oracleText = isVengeance ? 'Haste' : '';
              const keywords = isVengeance ? ['Haste'] : undefined;
              const typeLine = isVengeance ? 'Token Creature — Elemental' : 'Token Creature — Rabbit';
              const initiatorCount = isVengeance ? xValue * initiatorBonusCount : initiatorBonusCount;

              const tokenCountsByPlayer: Record<string, number> = { [initiator]: initiatorCount };
              for (const opponentId of acceptedBy) {
                tokenCountsByPlayer[opponentId] = isVengeance ? xValue : 1;
              }

              for (const [playerId, count] of Object.entries(tokenCountsByPlayer)) {
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < count; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `${tokenName.toLowerCase()}_${playerId}_${index}`);
                  const token = {
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: !isVengeance,
                    card: {
                      id: tokenId,
                      name: tokenName,
                      type_line: typeLine,
                      power: '1',
                      toughness: '1',
                      colors,
                      oracle_text: oracleText,
                      ...(keywords ? { keywords } : {}),
                    },
                  } as any;
                  battlefield.push(token);
                  stampPermanentEntryTimestamp(ctx.state, battlefield[battlefield.length - 1]);
                  triggerETBEffectsForToken(ctx as any, token, playerId as PlayerID);
                }
              }
            }

            const stateAny = ctx.state as any;
            if (stateAny.temptingOfferResponses && cardName) {
              delete stateAny.temptingOfferResponses[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(temptingOffer*): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
