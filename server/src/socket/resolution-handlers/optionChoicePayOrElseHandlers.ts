/**
 * socket/resolution-handlers/optionChoicePayOrElseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three "pay this or something happens instead" OPTION_CHOICE prompts that sit
 * ahead of the land-entry ones - `sacrificeUnlessPayChoice` (pay the upkeep cost or sacrifice the
 * permanent), `forceOfWillExileChoice` (exile a blue card from hand, optionally pay 1 life, then
 * resume the cast for its alternate cost) and `opponentMayPayChoice` (the deciding player pays or
 * takes the decline effect, applied and persisted as opponentMayPayResolve).
 * Public entry symbols: handleSacrificeUnlessPayChoice, handleForceOfWillExileChoice,
 * handleOpponentMayPayChoice.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { cardIsBlueForPitchCost } from "../../state/modules/alternate-costs.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import {
  appendCastSpellContinuationEvent,
  resumePlayerCastSpellFromHand,
} from "../resolutionSyntheticCastSocketUtils.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  emitToPlayer,
  getOrInitManaPool,
  getPlayerName,
  payManaCostWithAvailableSources,
} from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** Sacrifice unless you pay (legacy raw step compatibility). */
export async function handleSacrificeUnlessPayChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const permanentId = String(stepData?.permanentId || '').trim();
  const manaCost = String(stepData?.manaCost || '{1}').trim();
  if (!permanentId) {
    debugWarn(1, `[Resolution] sacrificeUnlessPayChoice: missing permanentId`);
    return;
  }
  const normalized = String(choiceId || '').toLowerCase();
  const shouldPay = !response.cancelled && normalized === 'pay_cost';

  game.state = (game.state || {}) as any;
  game.state.battlefield = game.state.battlefield || [];

  const battlefield = game.state.battlefield as any[];
  const permIndex = battlefield.findIndex((p: any) => p && p.id === permanentId);
  if (permIndex === -1) {
    debugWarn(1, `[Resolution] sacrificeUnlessPayChoice: permanent not found (${permanentId})`);
    return;
  }

  const permanent = battlefield[permIndex];
  const cardName = String(stepData?.cardName || permanent?.card?.name || 'Permanent');

  let paid = false;
  let paymentFailed = false;
  let tappedPermanents: string[] = [];
  let sacrificedPaymentPermanents: string[] = [];
  let paymentManaDelta: Record<string, number> | undefined;
  if (shouldPay) {
    if (!/\{[^}]+\}/.test(manaCost)) {
      paymentFailed = true;
      emitToPlayer(io, playerId, 'error', {
        code: 'UNSUPPORTED_COST',
        message: `Unsupported cost (${manaCost || 'unknown'}) for ${cardName}.`,
      });
    } else {
      try {
        const payment = payManaCostWithAvailableSources(game.state, playerId, manaCost);
        if (!payment.ok) {
          paymentFailed = true;
          emitToPlayer(io, playerId, 'error', {
            code: 'INSUFFICIENT_MANA',
            message: payment.error || 'Insufficient mana.',
          });
        } else {
          paid = true;
          tappedPermanents = payment.tappedPermanents;
          sacrificedPaymentPermanents = payment.sacrificedPermanents;
          paymentManaDelta = payment.paymentManaDelta;
          broadcastManaPoolUpdate(io, gameId, playerId, getOrInitManaPool(game.state, playerId) as any, `Paid ${manaCost} for ${cardName}`, game);
        }

        if (paid) {
          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}`,
            gameId,
            from: 'system',
            message: `${getPlayerName(game, playerId)} pays ${manaCost} for ${cardName}.`,
            ts: Date.now(),
          });
        }
      } catch (err) {
        paymentFailed = true;
        debugError(1, `[Resolution] sacrificeUnlessPayChoice: failed to process mana payment`, err);
        emitToPlayer(io, playerId, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Failed to process payment (${manaCost || 'unknown'}) for ${cardName}.`,
        });
      }
    }
  }

  if (shouldPay && paymentFailed && !paid) {
    broadcastGame(io, game, gameId);
    return;
  }

  if (!paid) {
    sacrificePermanent(game as any, permanentId, playerId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} sacrifices ${cardName} (didn't pay ${manaCost}).`,
      ts: Date.now(),
    });
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'sacrificeUnlessPayChoice', {
      playerId,
      permanentId,
      payMana: paid,
      manaCost,
      cardName,
      tappedPermanents,
      sacrificedPaymentPermanents,
      paymentManaDelta,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist sacrificeUnlessPayChoice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/**
 * Force of Will / Force of Negation style alternate cost.
 * Exile a blue card from hand (and optionally pay 1 life), then resume the cast.
 */
export async function handleForceOfWillExileChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  if (response.cancelled) {
    emitToPlayer(io, playerId, 'error', {
      code: 'CANNOT_PAY_COST',
      message: 'Alternate cost payment was cancelled.',
    });
    return;
  }

  const exileCardId = extractOptionChoiceSelectionId(selectedOption);
  const spellCardId = String(stepData?.forceSpellCardId || step.sourceId || '').trim();
  const spellName = String(stepData?.forceSpellName || step.sourceName || 'spell');
  const requiresLifePayment = Boolean(stepData?.forceRequiresLifePayment === true);
  const lifeAmount = Number(stepData?.forceLifePaymentAmount || (requiresLifePayment ? 1 : 0));

  if (!spellCardId) {
    debugWarn(1, `[Resolution] forceOfWillExileChoice: missing spellCardId/sourceId`);
    emitToPlayer(io, playerId, 'error', { code: 'CANNOT_PAY_COST', message: 'Missing spell context for alternate cost.' });
    return;
  }

  if (!exileCardId) {
    emitToPlayer(io, playerId, 'error', { code: 'CANNOT_PAY_COST', message: 'No card selected to exile.' });
    return;
  }

  const zones = (game.state as any).zones = (game.state as any).zones || {};
  zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
  const playerZones = zones[playerId] as any;
  playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
  playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];

  const handIndex = (playerZones.hand as any[]).findIndex((c: any) => c && String(c.id) === String(exileCardId));
  if (handIndex < 0) {
    emitToPlayer(io, playerId, 'error', { code: 'CANNOT_PAY_COST', message: 'Selected card not found in hand.' });
    return;
  }

  const chosenCard = (playerZones.hand as any[])[handIndex];
  if (!cardIsBlueForPitchCost(chosenCard)) {
    emitToPlayer(io, playerId, 'error', { code: 'CANNOT_PAY_COST', message: 'Selected card is not blue.' });
    return;
  }

  // Pay life if required.
  if (requiresLifePayment && lifeAmount > 0) {
    (game.state as any).life = (game.state as any).life || {};
    const startingLife = (game.state as any)?.startingLife || 40;
    const currentLife = (game.state as any).life[playerId] ?? startingLife;
    if (typeof currentLife !== 'number' || currentLife < lifeAmount) {
      emitToPlayer(io, playerId, 'error', { code: 'CANNOT_PAY_COST', message: `Not enough life to pay ${lifeAmount}.` });
      return;
    }
    const newLife = currentLife - lifeAmount;
    (game.state as any).life[playerId] = newLife;
    const playerObj = ((game.state as any).players || []).find((p: any) => p?.id === playerId);
    if (playerObj) playerObj.life = newLife;
  }

  // Exile the chosen card.
  (playerZones.hand as any[]).splice(handIndex, 1);
  playerZones.handCount = (playerZones.hand as any[]).length;
  (playerZones.exile as any[]).push({
    ...chosenCard,
    zone: 'exile',
    exiledForAlternateCost: true,
    exiledForSpellCardId: spellCardId,
  });
  playerZones.exileCount = (playerZones.exile as any[]).length;

  // Mark the spell card so castSpellFromHand can skip mana payment and avoid re-prompting.
  const spellInHand = (playerZones.hand as any[]).find((c: any) => c && String(c.id) === String(spellCardId));
  if (spellInHand) {
    (spellInHand as any).forceAltCostPaid = true;
    (spellInHand as any).forceAltCostExiledCardId = String(exileCardId);
    if (requiresLifePayment && lifeAmount > 0) {
      (spellInHand as any).lifePaymentAmount = lifeAmount;
    }
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'forceOfWillExileChoiceResolve', {
      playerId,
      sourceId: spellCardId,
      sourceName: spellName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      spellCardId,
      spellName,
      exileCardId: String(exileCardId),
      exiledCard: { ...chosenCard, zone: 'exile', exiledForAlternateCost: true, exiledForSpellCardId: spellCardId },
      requiresLifePayment,
      lifePaid: requiresLifePayment && lifeAmount > 0 ? lifeAmount : 0,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(forceOfWillExileChoiceResolve) failed:', err);
  }

  appendCastSpellContinuationEvent(gameId, game, {
    playerId,
    cardId: spellCardId,
    lifePaid: requiresLifePayment && lifeAmount > 0 ? lifeAmount : 0,
    moveHandCards: [
      {
        cardId: String(exileCardId),
        destination: 'exile',
        cardUpdates: {
          exiledForAlternateCost: true,
          exiledForSpellCardId: spellCardId,
        },
      },
    ],
    cardUpdates: {
      forceAltCostPaid: true,
      forceAltCostExiledCardId: String(exileCardId),
      ...(requiresLifePayment && lifeAmount > 0 ? { lifePaymentAmount: lifeAmount } : {}),
    },
  });

  const exileName = String((chosenCard as any)?.name || 'a blue card');
  const paidLifeText = requiresLifePayment && lifeAmount > 0 ? ` and pays ${lifeAmount} life` : '';
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} exiles ${exileName}${paidLifeText} to cast ${spellName} for its alternate cost.`,
    ts: Date.now(),
  });

  const castArgs = (stepData?.forceCastArgs || {}) as any;
  await resumePlayerCastSpellFromHand(io, gameId, String(playerId), {
    cardId: spellCardId,
    payment: castArgs.payment,
    targets: castArgs.targets,
    xValue: castArgs.xValue,
    alternateCostId: castArgs.alternateCostId || 'force_of_will',
    convokeTappedCreatures: castArgs.convokeTappedCreatures,
    skipInteractivePrompts: true,
    skipPriorityCheck: true,
  });
}

/** Opponent may pay: the deciding player pays or takes the decline effect. */
export function handleOpponentMayPayChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const promptId = String(stepData?.promptId || '').trim();
  const normalized = String(choiceId || '').toLowerCase();
  const willPay = !response.cancelled && normalized === 'pay';

  if (!promptId) {
    debugWarn(1, `[Resolution] opponentMayPayChoice: missing promptId`);
    return;
  }

  game.applyEvent({
    type: 'opponentMayPayResolve',
    playerId,
    resolvedStepId: String((step as any).id || '').trim(),
    decidingPlayer: playerId,
    promptId,
    willPay,
    sourceName: stepData?.sourceName,
    sourceController: stepData?.sourceController,
    manaCost: stepData?.manaCost,
    declineEffect: stepData?.declineEffect,
    triggerText: stepData?.triggerText,
    declineDrawCount: stepData?.declineDrawCount,
    declineTreasureCount: stepData?.declineTreasureCount,
  });

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'opponentMayPayResolve', {
      playerId,
      resolvedStepId: String((step as any).id || '').trim(),
      decidingPlayer: playerId,
      promptId,
      willPay,
      sourceName: stepData?.sourceName,
      sourceController: stepData?.sourceController,
      manaCost: stepData?.manaCost,
      declineEffect: stepData?.declineEffect,
      triggerText: stepData?.triggerText,
      declineDrawCount: stepData?.declineDrawCount,
      declineTreasureCount: stepData?.declineTreasureCount,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist opponentMayPayResolve event:', e);
  }

  broadcastGame(io, game, gameId);
}
