// server/src/state/modules/apply-event-handlers/applyEventReflexivePromptEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Reflexive "when you do" payment prompts and cast-from-exile/graveyard prompt resolution.
// Public entry: applyReflexivePromptEvents(ctx, e) -> true when it handled the event.
//
// Handles: mayAbilityResolve, upkeepSacrificeResolve, keywordPromptResolve, reflexiveManaPaymentResolve, reflexiveFixedPaymentResolve, reflexiveDiscardResolve, reflexiveConvertResolve, reflexiveGraveyardExileResolve, castFromExilePromptResolve, castFromGraveyardPromptResolve
import { notifyNoncombatPlayerDamage } from '../triggers/player-dealt-damage-ir.js';
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import { cleanupCardLeavingExile } from "../playable-from-exile";
import { transformPermanentToFace } from "../day-night.js";
import {
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
  ensureReplayPlayerZones,
  applyRecordedLifePayment,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { applyKeywordPromptResolveOutcome } from "../keywordPromptReplayOutcomes.js";
import { consumeManaFromPool, getOrInitManaPool, resolveManaCostForPoolPayment } from "../../../socket/util.js";
import { consumeReflexiveManaAmountFromPool } from "../reflexive-triggers.js";
import {
  findReplayedStackItemForCastCard,
  stampReplayedGraveyardCastStackFlags,
} from "../stackReplayUtils.js";

export function applyReflexivePromptEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "mayAbilityResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const effectKey = String((e as any).effectKey || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mayAbilityPrompt === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!effectKey || String((step as any)?.effectKey || '').trim() === effectKey)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mayAbilityResolve): failed', err);
        }
        break;
      }

      case "upkeepSacrificeResolve": {
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(upkeepSacrificeResolve): failed', err);
        }
        break;
      }

      case "keywordPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const stepType = String((e as any).stepType || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const permanentId = String((e as any).permanentId || (e as any).creatureId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const candidateStepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && candidateStepId === resolvedStepId) return true;

              if (stepType && String((step as any)?.type || '').trim() !== stepType) return false;
              if (playerId && String((step as any)?.playerId || '').trim() !== playerId) return false;

              const candidatePermanentId = String((step as any)?.permanentId || (step as any)?.creatureId || '').trim();
              const candidateSourceId = String((step as any)?.sourceId || '').trim();
              if (permanentId && candidatePermanentId && candidatePermanentId !== permanentId) return false;
              if (sourceId && candidateSourceId && candidateSourceId !== sourceId) return false;

              return Boolean(stepType || playerId || permanentId || sourceId);
            });
          }

          applyKeywordPromptResolveOutcome(ctx, e as Record<string, unknown>);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(keywordPromptResolve): failed', err);
        }
        break;
      }

      case "reflexiveManaPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const paidAmount = Math.max(0, Math.floor(Number((e as any).paidAmount || 0)));
          const paymentUnit = String((e as any).paymentUnit || 'mana').trim() || 'mana';

          if (playerId && paidAmount > 0) {
            consumeReflexiveManaAmountFromPool(ctx.state as any, playerId, paymentUnit as any, paidAmount);
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.reflexiveManaPaymentChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveManaPaymentResolve): failed', err);
        }
        break;
      }

      case "reflexiveFixedPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const paid = (e as any).paid === true;
          const manaCost = String((e as any).manaCost || '').trim();
          const lifeAmount = Math.max(0, Math.floor(Number((e as any).lifeAmount || 0)));

          if (paid && playerId) {
            if (manaCost) {
              const pool = getOrInitManaPool(ctx.state as any, playerId) as any;
              const resolved = resolveManaCostForPoolPayment(pool, manaCost);
              if (resolved.ok) {
                consumeManaFromPool(pool as any, resolved.coloredCost, resolved.genericCost, `[replay:reflexiveFixedPayment:${manaCost}]`);
              }
            }

            if (lifeAmount > 0) {
              applyRecordedLifePayment(ctx, playerId, lifeAmount);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.reflexiveFixedPaymentChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveFixedPaymentResolve): failed', err);
        }
        break;
      }

      case "reflexiveDiscardResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? ((e as any).cardIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (playerId && cardIds.length > 0) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, playerId);
            const hand = Array.isArray(playerZones.hand) ? playerZones.hand as any[] : [];
            playerZones.hand = hand;
            playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
            const graveyard = playerZones.graveyard as any[];
            let movedCount = 0;

            for (const cardId of cardIds) {
              const handIndex = hand.findIndex((card: any) => card && String(card.id || '') === cardId);
              if (handIndex === -1) continue;
              const [card] = hand.splice(handIndex, 1);
              pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, graveyard, {
                extraFields: {
                  discardedByPlayerId: playerId,
                  discardedOnTurn: Number((ctx.state as any)?.turnNumber ?? (ctx.state as any)?.turn ?? 0) || 0,
                },
              });
              movedCount++;
            }

            playerZones.handCount = hand.length;
            playerZones.graveyardCount = graveyard.length;
            if (movedCount > 0) {
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[playerId] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                (step as any)?.reflexiveDiscardWhenYouDo === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveDiscardResolve): failed', err);
        }
        break;
      }

      case "reflexiveConvertResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const converted = (e as any).converted === true;
          const faceIndex = Math.max(0, Math.min(1, Math.floor(Number((e as any).faceIndex ?? 1)))) as 0 | 1;

          if (converted && sourceId) {
            const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
            const permanent = battlefield.find((entry: any) => String(entry?.id || '') === sourceId);
            if (permanent) {
              transformPermanentToFace(permanent, faceIndex, ctx as any);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                (step as any)?.reflexiveConvertWhenYouDo === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveConvertResolve): failed', err);
        }
        break;
      }

      case "reflexiveGraveyardExileResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const zoneOwnerId = String((e as any).zoneOwnerId || (e as any).targetPlayerId || playerId).trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? ((e as any).cardIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (zoneOwnerId && cardIds.length > 0) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, zoneOwnerId);
            const graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard as any[] : [];
            playerZones.graveyard = graveyard;
            playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
            const exile = playerZones.exile as any[];
            let movedCard: any | undefined;

            for (const cardId of cardIds) {
              const graveyardIndex = graveyard.findIndex((card: any) => card && String(card.id || '') === cardId);
              if (graveyardIndex === -1) continue;
              const [card] = graveyard.splice(graveyardIndex, 1);
              exile.push({ ...card, zone: 'exile' });
              movedCard = movedCard || card;
            }

            playerZones.graveyardCount = graveyard.length;
            playerZones.exileCount = exile.length;
            if (movedCard) {
              recordCardLeftGraveyardThisTurn(ctx as any, zoneOwnerId, movedCard);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                ((step as any)?.reflexiveGraveyardExileWhenYouDo === true ||
                  (step as any)?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveGraveyardExileResolve): failed', err);
        }
        break;
      }

      case "castFromExilePromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const choice = String((e as any).choice || 'decline').trim().toLowerCase();
          const declineDestination = String((e as any).declineDestination || 'exile').trim().toLowerCase();
          const declineDamageEachOpponent = Number((e as any).declineDamageEachOpponent || 0);
          const declineDamageSourcePermanentId = String((e as any).declineDamageSourcePermanentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                cardId.length > 0 &&
                String((step as any)?.castFromExileCardId || '').trim() === cardId &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          if (choice === 'cast') {
            ctx.bumpSeq();
            break;
          }

          const zones = ((ctx.state as any)?.zones || {})[playerId];
          const exile = Array.isArray(zones?.exile) ? zones.exile : undefined;
          if (!zones || !exile || !cardId) {
            ctx.bumpSeq();
            break;
          }

          const exileIndex = exile.findIndex((card: any) => card && String(card.id || '').trim() === cardId);
          if (exileIndex === -1) {
            ctx.bumpSeq();
            break;
          }

          let exiledCard = exile[exileIndex];

          if (declineDestination === 'exile') {
            cleanupCardLeavingExile((ctx.state as any) as any, exiledCard);
          } else {
            const [removedCard] = exile.splice(exileIndex, 1);
            exiledCard = removedCard;
            zones.exileCount = exile.length;
            cleanupCardLeavingExile((ctx.state as any) as any, exiledCard);
          }

          if (declineDestination === 'graveyard') {
            zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
            pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, exiledCard, zones.graveyard);
            zones.graveyardCount = zones.graveyard.length;
          } else if (declineDestination === 'hand') {
            const toHand = { ...exiledCard, zone: 'hand' };
            delete (toHand as any).canBePlayedBy;
            delete (toHand as any).playableUntilTurn;
            delete (toHand as any).withoutPayingManaCost;
            delete (toHand as any).castWithoutPayingManaCost;
            zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
            zones.hand.push(toHand);
            zones.handCount = zones.hand.length;
            const player = ((ctx.state as any)?.players || []).find(
              (entry: any) => String(entry?.id || '').trim() === playerId,
            );
            if (player) {
              player.hand = Array.isArray(player.hand) ? player.hand : [];
              player.hand.push({ ...toHand });
              if (Array.isArray(player.exile)) {
                const playerExileIndex = player.exile.findIndex(
                  (card: any) => String(card?.id || '').trim() === cardId,
                );
                if (playerExileIndex !== -1) player.exile.splice(playerExileIndex, 1);
              }
            }
          } else if (declineDestination === 'library_bottom_random') {
            const bottomed = { ...exiledCard, zone: 'library' };
            zones.library = Array.isArray(zones.library) ? zones.library : [];
            zones.library.push(bottomed);
            zones.libraryCount = zones.library.length;
            const lib = ctx.libraries?.get?.(playerId as any);
            if (Array.isArray(lib)) {
              lib.push({ ...bottomed });
              ctx.libraries.set(playerId as any, lib);
            } else if (ctx.libraries?.set) {
              ctx.libraries.set(playerId as any, [{ ...bottomed }]);
            }
          }

          if (Number.isFinite(declineDamageEachOpponent) && declineDamageEachOpponent > 0) {
            const startingLife = Number((ctx.state as any).startingLife || 40);
            (ctx.state as any).life = (ctx.state as any).life || {};

            const battlefield = Array.isArray((ctx.state as any).battlefield) ? (ctx.state as any).battlefield : [];
            const sourceCreature = declineDamageSourcePermanentId
              ? battlefield.find((perm: any) => perm && String(perm.id || '').trim() === declineDamageSourcePermanentId)
              : undefined;
            const sourceIsCreature = Boolean(String(sourceCreature?.card?.type_line || '').toLowerCase().includes('creature'));

            for (const player of (ctx.state as any).players || []) {
              const opponentId = String(player?.id || '').trim();
              if (!opponentId || opponentId === playerId) continue;

              const currentLife = Number((ctx.state as any).life[opponentId] ?? startingLife);
              (ctx.state as any).life[opponentId] = currentLife - declineDamageEachOpponent;

              (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
              (ctx.state as any).damageTakenThisTurnByPlayer[opponentId] =
                ((ctx.state as any).damageTakenThisTurnByPlayer[opponentId] || 0) + declineDamageEachOpponent;
              notifyNoncombatPlayerDamage(ctx, opponentId, declineDamageEachOpponent, sourceCreature);

              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[opponentId] =
                ((ctx.state as any).lifeLostThisTurn[opponentId] || 0) + declineDamageEachOpponent;

              if (sourceIsCreature && sourceCreature) {
                const sourcePermanentId = String(sourceCreature.id || '').trim();
                if (sourcePermanentId) {
                  (ctx.state as any).creaturesThatDealtDamageToPlayer = (ctx.state as any).creaturesThatDealtDamageToPlayer || {};
                  const perPlayer = (((ctx.state as any).creaturesThatDealtDamageToPlayer[opponentId] =
                    (ctx.state as any).creaturesThatDealtDamageToPlayer[opponentId] || {}) as any);
                  perPlayer[sourcePermanentId] = {
                    creatureName: String(sourceCreature.card?.name || 'Unknown Creature'),
                    totalDamage: (perPlayer[sourcePermanentId]?.totalDamage || 0) + declineDamageEachOpponent,
                    lastDamageTime: Date.now(),
                  };
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castFromExilePromptResolve): failed', err);
        }
        break;
      }

      case "castFromGraveyardPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardId = String((e as any).cardId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                cardId.length > 0 &&
                String((step as any)?.castFromGraveyardCardId || '').trim() === cardId &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          const choice = String((e as any).choice || '').trim().toLowerCase();
          if (cardId && (choice === 'cast' || choice === 'play')) {
            const stackItem = findReplayedStackItemForCastCard(ctx, cardId);
            if (stackItem) {
              stampReplayedGraveyardCastStackFlags(stackItem, e);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castFromGraveyardPromptResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
