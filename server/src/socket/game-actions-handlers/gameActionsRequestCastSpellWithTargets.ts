/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: requestCastSpellForSocket with-targets additional-cost
 * prompts plus TARGET_SELECTION queue (CR 601.2c).
 *
 * Public entry symbols: tryQueueRequestCastSpellWithTargets.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../../state/context.js";
import { buildCounterRemovalCostOptions } from "../../state/modules/counter-removal-costs.js";
import { canPlayerPayLife } from "../../state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js";
import { getDeclarativeLeaveBattlefieldReplacementHint as getLeaveBattlefieldReplacementHint } from "../../state/modules/leaveBattlefieldReplacementHint.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getEffectivePower, getPlayerName } from "../util";
import {
  getEffectiveAdditionalCost,
  getPendingSquadTimesPaidFields,
  getRevealAdditionalCostCards,
  getSquadDisplayedCost,
} from "./gameActionsAdditionalCastCosts.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { buildPendingCastCostMetadata } from "./gameActionsCastCostFormatting.js";
import {
  buildAlternateCostPaymentExtrasForCast,
  buildCommandZonePaymentCostAdjustment,
  getPendingCastPaymentFields,
} from "./gameActionsCommandZoneAndAlternateCastCosts.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type RequestCastSpellWithTargetsArgs = {
  io: Server;
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  cardInHand: any;
  cardForCast: any;
  oracleText: string;
  oracleTextRaw: string;
  effectId: string;
  resolvedManaCost: string;
  manaCost: string;
  entwineCost: string | undefined;
  chosenXValue: number | undefined;
  selectedFaceIndex: number | undefined;
  castSourceZone: SpellCastSourceZone;
  commanderCandidate: any;
  isFreeCast: boolean;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  options: any;
  hand: any[];
  giftInfo: any;
  giftPromised: boolean;
  giftRecipient: string | undefined;
  giftType: string | undefined;
  validTargetList: any[];
  targetGrouping: any;
  groupedMinTargets: number;
  groupedMaxTargets: number;
  isAura: boolean;
  preferParsedTargetReqs: boolean;
  targetReqs: any;
  spellSpec: any;
  multiTargetClauses: any[];
};

export type RequestCastSpellWithTargetsContinue = {
  kind: "continue";
};

export function tryQueueRequestCastSpellWithTargets(
  args: RequestCastSpellWithTargetsArgs,
): RequestCastSpellWithTargetsContinue | void {
  const {
    io,
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardName,
    cardInHand,
    cardForCast,
    oracleText,
    oracleTextRaw,
    effectId,
    resolvedManaCost,
    manaCost,
    entwineCost,
    chosenXValue,
    selectedFaceIndex,
    castSourceZone,
    commanderCandidate,
    isFreeCast,
    bypassExilePermissionCheck,
    ignoreTimingRestrictions,
    options,
    hand,
    giftInfo,
    giftPromised,
    giftRecipient,
    giftType,
    validTargetList,
    targetGrouping,
    groupedMinTargets,
    groupedMaxTargets,
    isAura,
    preferParsedTargetReqs,
    targetReqs,
    spellSpec,
    multiTargetClauses,
  } = args;

      if (validTargetList.length > 0) {
        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        const requestCastAdditionalCostPaid = (cardInHand as any).additionalCostPaid === true;
        const requestCastAdditionalCostMethod = typeof (cardInHand as any).additionalCostMethod === 'string'
          ? String((cardInHand as any).additionalCostMethod)
          : undefined;
        const paymentMetadata = buildPendingCastCostMetadata(game, playerId, cardForCast, castSourceZone);
        const paymentCostAdjustment = castSourceZone === 'command'
          ? buildCommandZonePaymentCostAdjustment(game, playerId, cardForCast, commanderCandidate, resolvedManaCost)
          : undefined;
        const warpPaymentExtras = buildAlternateCostPaymentExtrasForCast(oracleText, castSourceZone, paymentMetadata, chosenXValue, { game, playerId });

        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName,
          manaCost: resolvedManaCost,
          rawManaCost: manaCost,
          entwineCost,
          fromZone: castSourceZone,
          playerId,
          faceIndex: selectedFaceIndex,
          xValue: chosenXValue,
          ...getPendingSquadTimesPaidFields(cardInHand),
          selectedModes: Array.isArray((cardForCast as any).selectedModes) ? [...((cardForCast as any).selectedModes as string[])] : undefined,
          selectedAdditionalCostModes: Array.isArray((cardForCast as any).selectedAdditionalCostModes)
            ? [...((cardForCast as any).selectedAdditionalCostModes as string[])]
            : (Array.isArray((cardForCast as any).selectedSpreeModes)
              ? [...((cardForCast as any).selectedSpreeModes as string[])]
              : undefined),
          selectedSpreeModes: Array.isArray((cardForCast as any).selectedSpreeModes) ? [...((cardForCast as any).selectedSpreeModes as string[])] : undefined,
          castWithEntwine: (cardForCast as any).castWithEntwine === true,
          validTargetIds: validTargetList.map((t: any) => t.id),
          ...(targetGrouping ? { targetGrouping } : {}),
          card: { ...cardForCast },
          ...warpPaymentExtras,
          ...getPendingCastPaymentFields(paymentMetadata, paymentCostAdjustment),
          forcedAlternateCostId: options?.forcedAlternateCostId,
          castWithoutPayingManaCost: isFreeCast,
          bypassExilePermissionCheck,
          ignoreTimingRestrictions,
          additionalCostPaid: requestCastAdditionalCostPaid,
          ...(requestCastAdditionalCostMethod ? { additionalCostMethod: requestCastAdditionalCostMethod } : {}),
          ...(giftInfo.hasGift
            ? {
                giftPromised,
                giftRecipient,
                giftType,
              }
            : {}),
          ...(options?.librarySearchStepToResume ? { librarySearchStepToResume: options.librarySearchStepToResume } : {}),
        };

        const preTargetQueuedSteps: any[] = [];
        const additionalCost = getEffectiveAdditionalCost(cardInHand, oracleText);
        if (!requestCastAdditionalCostPaid && additionalCost?.type === 'pay_life') {
          const startingLife = game.state.startingLife || 40;
          const currentLife = game.state.life?.[playerId] ?? startingLife;
          if (!canPlayerPayLife(game as GameContext, String(playerId))) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: players can't pay life.`,
            });
            return;
          }
          if (currentLife < additionalCost.amount) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: You need to pay ${additionalCost.amount} life but only have ${currentLife} life.`,
            });
            return;
          }

          game.state.life = game.state.life || {};
          game.state.life[playerId] = currentLife - additionalCost.amount;

          try {
            (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
            (game.state as any).lifeLostThisTurn[String(playerId)] =
              ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + Number(additionalCost.amount || 0);
          } catch {}
          queueLifePaymentTriggers(game as any, String(playerId), Number(additionalCost.amount || 0), { sourceId: cardId, sourceName: cardName });

          (cardInHand as any).additionalCostPaid = true;
          (cardInHand as any).additionalCostMethod = 'pay_life';

          const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
          if (pendingCast) {
            pendingCast.additionalCostPaid = true;
            pendingCast.additionalCostMethod = 'pay_life';
          }

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}`,
            gameId,
            from: 'system',
            message: `${getPlayerName(game, playerId)} pays ${additionalCost.amount} life to cast ${cardName}. (${currentLife} -> ${game.state.life[playerId]})`,
            ts: Date.now(),
          });
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'discard') {
          const discardableHandCards = hand.filter((c: any) => (castSourceZone === 'hand' ? c.id !== cardId : true));
          if (discardableHandCards.length < additionalCost.amount) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: You need to discard ${additionalCost.amount} card(s) but only have ${discardableHandCards.length} other card(s) in hand.`,
            });
            return;
          }

          const discardCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `As an additional cost to cast ${cardName}, discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''}.`,
            mandatory: true,
            cardId,
            cardName,
            costType: 'discard',
            amount: additionalCost.amount,
            title: `Discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''} to cast ${cardName}`,
            imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableCards: discardableHandCards.map((c: any) => ({
              id: c.id,
              name: c.name,
              imageUrl: c.image_uris?.small || c.image_uris?.normal,
              typeLine: c.type_line,
            })),
            castSpellFromHandArgs: {
              cardId,
              faceIndex: selectedFaceIndex,
              fromZone: castSourceZone,
              xValue: chosenXValue,
              alternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              ignoreTimingRestrictions,
              skipPriorityCheck: true,
            },
          } as any);
          preTargetQueuedSteps.push({ ...(discardCostStep as any) });
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'reveal') {
          const revealableHandCards = getRevealAdditionalCostCards(hand, castSourceZone, cardId, additionalCost);
          if (revealableHandCards.length < additionalCost.amount) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: You need to reveal ${additionalCost.amount} ${additionalCost.filter || ''} card(s) from your hand.`,
            });
            return;
          }

          const revealCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `As an additional cost to cast ${cardName}, reveal ${additionalCost.amount} ${additionalCost.filter || ''} card${additionalCost.amount > 1 ? 's' : ''} from your hand.`,
            mandatory: true,
            cardId,
            cardName,
            costType: 'reveal',
            amount: additionalCost.amount,
            filter: additionalCost.filter,
            title: `Reveal ${additionalCost.amount} ${additionalCost.filter || ''} card${additionalCost.amount > 1 ? 's' : ''} to cast ${cardName}`,
            imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableCards: revealableHandCards.map((c: any) => ({
              id: c.id,
              name: c.name,
              imageUrl: c.image_uris?.small || c.image_uris?.normal,
              typeLine: c.type_line,
            })),
            castSpellFromHandArgs: {
              cardId,
              faceIndex: selectedFaceIndex,
              fromZone: castSourceZone,
              xValue: chosenXValue,
              alternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              ignoreTimingRestrictions,
              skipPriorityCheck: true,
            },
          } as any);
          preTargetQueuedSteps.push({ ...(revealCostStep as any) });
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'sacrifice') {
          const validSacrificeTargets = (game.state?.battlefield || []).filter((p: any) => {
            if (String(p?.controller || '') !== String(playerId)) return false;
            const typeLine = String(p?.card?.type_line || '').toLowerCase();
            if (!additionalCost.filter) return true;
            return typeLine.includes(String(additionalCost.filter).toLowerCase());
          });

          if (validSacrificeTargets.length < additionalCost.amount) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: You need to sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) but don't control enough.`,
            });
            return;
          }

          const sacrificeCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `As an additional cost to cast ${cardName}, sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''}.`,
            mandatory: true,
            cardId,
            cardName,
            costType: 'sacrifice',
            amount: additionalCost.amount,
            filter: additionalCost.filter,
            title: `Sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''} to cast ${cardName}`,
            imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableTargets: validSacrificeTargets.map((p: any) => ({
              id: p.id,
              name: p.card?.name || 'Unknown',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              typeLine: p.card?.type_line,
              isCommander: Boolean(p.isCommander || p.commander || p?.card?.isCommander || p?.card?.commander),
              ...getLeaveBattlefieldReplacementHint(p, 'graveyard', game.state),
            })),
            castSpellFromHandArgs: {
              cardId,
              faceIndex: selectedFaceIndex,
              fromZone: castSourceZone,
              xValue: chosenXValue,
              alternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              ignoreTimingRestrictions,
              skipPriorityCheck: true,
            },
          } as any);
          preTargetQueuedSteps.push({ ...(sacrificeCostStep as any) });
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'remove_counters') {
          const availableCounters = buildCounterRemovalCostOptions(game.state, String(playerId), {
            amount: additionalCost.amount,
            filter: additionalCost.filter || 'creature',
            counterType: additionalCost.counterType,
            distributed: true,
          });

          if (availableCounters.length < additionalCost.amount) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot cast ${cardName}: You need to remove ${additionalCost.amount} counter${additionalCost.amount === 1 ? '' : 's'} from among ${additionalCost.filter || 'creature'}s you control.`,
            });
            return;
          }

          const counterRemovalCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `As an additional cost to cast ${cardName}, remove ${additionalCost.amount} counter${additionalCost.amount === 1 ? '' : 's'} from among ${additionalCost.filter || 'creature'}s you control.`,
            mandatory: true,
            cardId,
            cardName,
            costType: 'remove_counters',
            amount: additionalCost.amount,
            filter: additionalCost.filter || 'creature',
            counterType: additionalCost.counterType,
            title: `Remove ${additionalCost.amount} counter${additionalCost.amount === 1 ? '' : 's'} to cast ${cardName}`,
            imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableCounters,
            castSpellFromHandArgs: {
              cardId,
              faceIndex: selectedFaceIndex,
              fromZone: castSourceZone,
              xValue: chosenXValue,
              alternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              ignoreTimingRestrictions,
              skipPriorityCheck: true,
            },
          } as any);
          preTargetQueuedSteps.push({ ...(counterRemovalCostStep as any) });
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'teamwork') {
          const minPower = Math.max(0, Number((additionalCost as any).teamworkMinPower || 0));
          const teamworkCreatures = (game.state?.battlefield || []).filter((p: any) => {
            if (!p || String(p.controller || '') !== String(playerId)) return false;
            if ((p as any).tapped) return false;
            const typeLine = String(p?.card?.type_line || '').toLowerCase();
            return typeLine.includes('creature');
          });
          const totalUntappedPower = teamworkCreatures.reduce(
            (sum: number, permanent: any) => sum + getEffectivePower(permanent),
            0,
          );

          if (minPower > 0 && totalUntappedPower >= minPower) {
            const teamworkCostStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: effectId,
              sourceName: cardName,
              sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Teamwork (optional): Tap creatures with total power ${minPower} or more to cast ${cardName}. Submit with no selections to decline.`,
              mandatory: false,
              cardId,
              cardName,
              costType: 'teamwork',
              amount: 0,
              teamworkMinPower: minPower,
              title: `Teamwork � ${cardName}`,
              imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: teamworkCreatures.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Creature',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
                power: getEffectivePower(p),
              })),
              castSpellFromHandArgs: {
                cardId,
                faceIndex: selectedFaceIndex,
                fromZone: castSourceZone,
                xValue: chosenXValue,
                alternateCostId: options?.forcedAlternateCostId,
                castWithoutPayingManaCost: isFreeCast,
                bypassExilePermissionCheck,
                ignoreTimingRestrictions,
                skipPriorityCheck: true,
              },
            } as any);
            preTargetQueuedSteps.push({ ...(teamworkCostStep as any) });
          } else {
            (cardInHand as any).teamworkResolved = true;
            (cardInHand as any).teamworkWasPaid = false;
            const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
            if (pendingCast) {
              pendingCast.teamworkResolved = true;
              pendingCast.teamworkWasPaid = false;
            }
          }
        } else if (!requestCastAdditionalCostPaid && additionalCost?.type === 'squad') {
          const squadCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.SQUAD_COST_PAYMENT,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `Choose how many times to pay Squad for ${cardName}.`,
            mandatory: true,
            cardId,
            cardName,
            squadCost: getSquadDisplayedCost(String(cardInHand?.oracle_text || oracleTextRaw || ''), additionalCost.cost),
            imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            castSpellFromHandArgs: {
              cardId,
              faceIndex: selectedFaceIndex,
              fromZone: castSourceZone,
              xValue: chosenXValue,
              alternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              ignoreTimingRestrictions,
              skipPriorityCheck: true,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            effectId,
            pendingSpellCast: {
              ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
            },
            queuedResolutionStep: {
              ...(squadCostStep as any),
            },
          });

          debug(2, `[requestCastSpell] Queued squad additional-cost step for ${cardName} (cost: ${additionalCost.cost})`);
          return;
        } else if (additionalCost?.type === 'blight') {
          const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
          if (!pendingCast) {
            debugWarn(1, `[requestCastSpell] Missing pendingSpellCasts for effectId ${effectId} (blight additional cost)`);
          } else {
            const blightIsX = Boolean((additionalCost as any).blightIsX);
            const blightN = Number((additionalCost as any).blightN || 0);
            const blightOrPayCost = String((additionalCost as any).blightOrPayCost || '').trim() || undefined;
            const blightIsOptional = Boolean((additionalCost as any).blightIsOptional);

            if (blightIsX) {
              delete (game.state as any).pendingSpellCasts[effectId];
              socket.emit('error', {
                code: 'UNSUPPORTED_ADDITIONAL_COST',
                message: `Additional cost "Blight X" is not supported yet for ${cardName}.`,
              });
              return;
            }

            const battlefieldNow = game.state?.battlefield || [];
            const validBlightTargets = battlefieldNow
              .filter((p: any) => p && String(p.controller || '') === String(playerId))
              .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
              .map((p: any) => ({
                id: p.id,
                label: p.card?.name || 'Creature',
                description: p.card?.type_line || 'creature',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              }));

            pendingCast.additionalCostPaid = false;
            pendingCast.additionalCostMethod = 'none';

            if (blightOrPayCost) {
              const blightChoiceStep = ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.OPTION_CHOICE,
                playerId: playerId as PlayerID,
                description: `Additional cost for ${cardName}: Choose how to pay`,
                mandatory: true,
                sourceId: effectId,
                sourceName: cardName,
                sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                options: [
                  {
                    id: 'blight_cost',
                    label: `Blight ${blightN}`,
                    description: `Put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on a creature you control.`,
                  },
                  {
                    id: 'pay_mana_cost',
                    label: `Pay ${blightOrPayCost}`,
                    description: `Pay ${blightOrPayCost} as the additional cost.`,
                  },
                ],
                minSelections: 1,
                maxSelections: 1,
                spellAdditionalCostBlightOrPay: true,
                spellAdditionalCostEffectId: effectId,
                spellAdditionalCostCardName: cardName,
                spellAdditionalCostBlightN: blightN,
                spellAdditionalCostOrPay: blightOrPayCost,
              } as any);
              preTargetQueuedSteps.push({ ...(blightChoiceStep as any) });
            } else {
              if (validBlightTargets.length === 0) {
                if (blightIsOptional) {
                  pendingCast.additionalCostPaid = false;
                  pendingCast.additionalCostMethod = 'none';
                } else {
                  delete (game.state as any).pendingSpellCasts[effectId];
                  socket.emit('error', {
                    code: 'CANNOT_PAY_COST',
                    message: `Cannot cast ${cardName}: You must blight ${blightN}, but you control no creatures.`,
                  });
                  return;
                }
              } else {
                const blightTargetStep = ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.TARGET_SELECTION,
                  playerId: playerId as PlayerID,
                  description: `Additional cost for ${cardName}: Blight ${blightN}${blightIsOptional ? ' (optional)' : ''}`,
                  mandatory: !blightIsOptional,
                  sourceId: effectId,
                  sourceName: cardName,
                  sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                  validTargets: validBlightTargets,
                  targetTypes: ['creature'],
                  minTargets: 1,
                  maxTargets: 1,
                  targetDescription: 'creature you control',
                  keywordBlight: true,
                  keywordBlightStage: 'cast_additional_cost',
                  keywordBlightController: playerId,
                  keywordBlightN: blightN,
                  keywordBlightSourceName: `${cardName} � Additional Cost (Blight ${blightN})`,
                  keywordBlightEffectId: effectId,
                  keywordBlightOptional: blightIsOptional,
                } as any);
                preTargetQueuedSteps.push({ ...(blightTargetStep as any) });
              }
            }
          }
        }

        if (multiTargetClauses.length > 1) {
          const targetSteps: any[] = [];
          for (const clause of multiTargetClauses) {
            const targetStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: playerId as PlayerID,
              description: `Choose ${clause.targetDescription} for ${cardName}`,
              mandatory: clause.minTargets > 0,
              sourceId: effectId,
              sourceName: cardName,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              validTargets: clause.validTargetList.map((t: any) => ({
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
                type: t.kind === 'player' ? 'player' : (t.kind === 'stack' ? 'stack' : 'permanent'),
                controller: t.controller,
                typeLine: t.typeLine,
                life: t.life,
                isOpponent: t.isOpponent,
              })),
              targetTypes: ['spell_target'],
              minTargets: clause.minTargets,
              maxTargets: clause.maxTargets,
              targetDescription: clause.targetDescription,
              spellCastContext: {
                cardId,
                cardName,
                manaCost: resolvedManaCost,
                rawManaCost: manaCost,
                entwineCost,
                playerId,
                faceIndex: selectedFaceIndex,
                effectId,
                oracleText,
                imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                forcedAlternateCostId: options?.forcedAlternateCostId,
                castWithoutPayingManaCost: isFreeCast,
                bypassExilePermissionCheck,
                xValue: chosenXValue,
              },
            });
            targetSteps.push({ ...(targetStep as any) });
          }

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            effectId,
            pendingSpellCast: {
              ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
            },
            queuedResolutionSteps: [...preTargetQueuedSteps, ...targetSteps],
          });

          debug(2, `[requestCastSpell] Added ${multiTargetClauses.length} TARGET_SELECTION steps to Resolution Queue for ${cardName} (effectId: ${effectId})`);
        } else {
          const auraMatchForDescription = isAura
            ? oracleText.match(/enchant\s+(creature|permanent|player|artifact|land|opponent|enchantment)/i)
            : null;
          const auraTargetTypeForDescription = auraMatchForDescription
            ? String(auraMatchForDescription[1] || 'creature').toLowerCase()
            : null;
          const targetDescription = isAura && auraTargetTypeForDescription
            ? `Enchant ${auraTargetTypeForDescription}`
            : preferParsedTargetReqs
              ? targetReqs?.targetDescription || spellSpec?.targetDescription || 'target'
              : spellSpec?.targetDescription || targetReqs?.targetDescription || 'target';

          const targetStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: playerId as PlayerID,
            description: `Choose ${targetDescription} for ${cardName}`,
            mandatory: true,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            validTargets: validTargetList.map((t: any) => {
              const isPlayerTarget = t.kind === 'player';
              const isStackTarget = t.kind === 'stack';
              return {
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
                type: isPlayerTarget ? 'player' : (isStackTarget ? 'stack' : 'permanent'),
                controller: t.controller,
                typeLine: t.typeLine,
                life: t.life,
                isOpponent: t.isOpponent,
              };
            }),
            targetTypes: [isAura ? 'aura_target' : 'spell_target'],
            minTargets: groupedMinTargets,
            maxTargets: groupedMaxTargets,
            targetDescription,
            ...(targetGrouping
              ? {
                  targetGrouping,
                  perOpponent: targetGrouping.groupPlayers === 'each_opponent',
                  targetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? Object.fromEntries(targetGrouping.groups.map((group: any) => [group.playerId, group.targets]))
                    : undefined,
                  minTargetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? targetGrouping.minTargetsPerGroup
                    : undefined,
                  maxTargetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? targetGrouping.maxTargetsPerGroup
                    : undefined,
                }
              : {}),
            spellCastContext: {
              cardId,
              cardName,
              manaCost: resolvedManaCost,
              rawManaCost: manaCost,
              entwineCost,
              playerId,
              faceIndex: selectedFaceIndex,
              effectId,
              oracleText,
              imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              forcedAlternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              xValue: chosenXValue,
              ...(targetGrouping ? { targetGrouping } : {}),
            },
          });

          const serializedTargetStep = {
            id: String((targetStep as any)?.id || ''),
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: playerId as PlayerID,
            description: `Choose ${targetDescription} for ${cardName}`,
            mandatory: true,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            validTargets: validTargetList.map((t: any) => {
              const isPlayerTarget = t.kind === 'player';
              const isStackTarget = t.kind === 'stack';
              return {
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
                type: isPlayerTarget ? 'player' : (isStackTarget ? 'stack' : 'permanent'),
                controller: t.controller,
                typeLine: t.typeLine,
                life: t.life,
                isOpponent: t.isOpponent,
              };
            }),
            targetTypes: [isAura ? 'aura_target' : 'spell_target'],
            minTargets: groupedMinTargets,
            maxTargets: groupedMaxTargets,
            targetDescription,
            ...(targetGrouping
              ? {
                  targetGrouping,
                  perOpponent: targetGrouping.groupPlayers === 'each_opponent',
                  targetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? Object.fromEntries(targetGrouping.groups.map((group: any) => [group.playerId, group.targets]))
                    : undefined,
                  minTargetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? targetGrouping.minTargetsPerGroup
                    : undefined,
                  maxTargetsPerOpponent: targetGrouping.groupPlayers === 'each_opponent'
                    ? targetGrouping.maxTargetsPerGroup
                    : undefined,
                }
              : {}),
            spellCastContext: {
              cardId,
              cardName,
              manaCost: resolvedManaCost,
              rawManaCost: manaCost,
              entwineCost,
              playerId,
              faceIndex: selectedFaceIndex,
              effectId,
              oracleText,
              imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              forcedAlternateCostId: options?.forcedAlternateCostId,
              castWithoutPayingManaCost: isFreeCast,
              bypassExilePermissionCheck,
              xValue: chosenXValue,
              ...(targetGrouping ? { targetGrouping } : {}),
            },
          };

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            effectId,
            pendingSpellCast: {
              ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
            },
            ...(preTargetQueuedSteps.length > 0
              ? { queuedResolutionSteps: [...preTargetQueuedSteps, serializedTargetStep] }
              : { queuedResolutionStep: serializedTargetStep }),
          });

          debug(2, `[requestCastSpell] Added TARGET_SELECTION step to Resolution Queue for ${cardName} (effectId: ${effectId}, ${validTargetList.length} valid targets)`);
        }
        debug(2, `[requestCastSpell] ======== REQUEST END (waiting for targets via Resolution Queue) ========`);
        return;
      }

  return { kind: "continue" };
}
