/**
 * socket/resolution-handlers/optionChoiceCostPlanPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two OPTION_CHOICE prompts that ask *how* a cost will be paid rather than
 * whether to pay it - `spellAdditionalCostBlightOrPay` (the cast's additional cost is "Blight N or
 * pay {X}": paying tags the pending cast and asks for mana, blighting queues the Blight
 * TARGET_SELECTION or aborts the cast when the player controls no creatures) and
 * `chooseDiscardPlanChoice` (discard the preferred card type when the player has one, otherwise fall
 * back to the generic discard, or report an empty hand).
 * Public entry symbols: handleSpellAdditionalCostBlightOrPayChoice, handleChooseDiscardPlanChoice.
 *
 * The blight branch's inline payment-prompt closure is now the shared
 * `emitPendingCastPaymentIfNeeded` from `resolutionPendingCastPaymentPrompt.ts`, which is the same
 * logic; only its debug(2) wording differs ("Additional-cost flow complete" vs "choice complete").
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { emitPendingCastPaymentIfNeeded } from "./resolutionPendingCastPaymentPrompt.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** Cast-time additional cost "Blight N or pay {X}": route to mana payment or to the blight prompt. */
export async function handleSpellAdditionalCostBlightOrPayChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const effectId = String(stepData?.spellAdditionalCostEffectId || stepData?.sourceId || '');
  const blightN = Number(stepData?.spellAdditionalCostBlightN || 0) || 0;
  const orPay = String(stepData?.spellAdditionalCostOrPay || '').trim();

  if (!choiceId) {
    debugWarn(1, `[Resolution] spellAdditionalCostBlightOrPay: missing choice id`);
    return;
  }

  const pendingCast = effectId ? (game.state as any)?.pendingSpellCasts?.[effectId] : undefined;
  if (!pendingCast) {
    debugWarn(1, `[Resolution] spellAdditionalCostBlightOrPay: pendingSpellCasts missing for effectId ${effectId}`);
    return;
  }

  if (choiceId === 'pay_mana_cost') {
    pendingCast.additionalCostPaid = true;
    pendingCast.additionalCostMethod = 'pay_mana';
    pendingCast.additionalCostTax = orPay;
    emitPendingCastPaymentIfNeeded(game, gameId, effectId, playerId);
    return;
  }

  if (choiceId !== 'blight_cost') {
    debugWarn(1, `[Resolution] spellAdditionalCostBlightOrPay: unexpected choice '${choiceId}'`);
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const validTargets = battlefield
    .filter((p: any) => p && String(p.controller || '') === String(playerId))
    .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
    .map((p: any) => ({
      id: p.id,
      label: p.card?.name || 'Creature',
      description: p.card?.type_line || 'creature',
      imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
    }));

  if (validTargets.length === 0) {
    delete (game.state as any).pendingSpellCasts[effectId];
    emitToPlayer(io, playerId, 'error', {
      code: 'CANNOT_PAY_COST',
      message: `Cannot cast ${pendingCast.cardName}: You must blight ${blightN}, but you control no creatures.`,
    });
    broadcastGame(io, game, gameId);
    return;
  }

  pendingCast.additionalCostPaid = false;
  pendingCast.additionalCostMethod = 'blight';

  const blightTargetStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as any,
    description: `Additional cost for ${pendingCast.cardName}: Blight ${blightN}`,
    mandatory: true,
    sourceId: effectId,
    sourceName: pendingCast.cardName,
    sourceImage: pendingCast.card?.image_uris?.small || pendingCast.card?.image_uris?.normal,
    validTargets,
    targetTypes: ['creature'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'creature you control',
    priority: -1,

    keywordBlight: true,
    keywordBlightStage: 'cast_additional_cost',
    keywordBlightController: playerId,
    keywordBlightN: blightN,
    keywordBlightSourceName: `${pendingCast.cardName} — Additional Cost (Blight ${blightN})`,
    keywordBlightEffectId: effectId,
    keywordBlightOptional: false,
  } as any);

  appendCastSpellContinuationEvent(gameId, game, {
    playerId,
    cardId: pendingCast.cardId,
    effectId,
    pendingSpellCast: {
      ...(pendingCast || {}),
    },
    queuedResolutionStep: {
      ...(blightTargetStep as any),
    },
  });

  debug(2, `[Resolution] Enqueued blight payment step for additional-cost choice (effectId=${effectId})`);
}

/** "Discard a <type> card. If you can't / choose not to, discard N cards instead." */
export async function handleChooseDiscardPlanChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'fallback';
  const controllerId = String(stepData.chooseDiscardPlanPlayerId || response.playerId);
  const sourceName = String(stepData.chooseDiscardPlanSourceName || step.sourceName || 'Ability');
  const preferredOptionId = String(stepData.chooseDiscardPlanPreferredOptionId || 'preferred');
  const preferredType = String(stepData.chooseDiscardPlanPreferredType || '').toLowerCase();
  const preferredCount = Math.max(1, Number(stepData.chooseDiscardPlanPreferredCount || 1));
  const fallbackCount = Math.max(1, Number(stepData.chooseDiscardPlanFallbackCount || 1));

  const state = game.state || {};
  const zones = (state.zones = state.zones || {});
  const z = (zones[controllerId] = zones[controllerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  const hand: any[] = Array.isArray(z.hand) ? z.hand : (z.hand = []);

  const preferredHand = preferredType
    ? hand.filter((c: any) => String(c?.type_line || '').toLowerCase().includes(preferredType))
    : hand;
  const toHandCards = (cards: any[]) =>
    cards.map((c: any) => ({
      id: c.id,
      name: c.name,
      type_line: c.type_line,
      oracle_text: c.oracle_text,
      image_uris: c.image_uris,
      mana_cost: c.mana_cost,
      cmc: c.cmc,
      colors: c.colors,
    }));

  if (choiceId === preferredOptionId && preferredHand.length > 0) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: controllerId as any,
      description: `${sourceName}: Discard ${preferredCount} ${preferredType || ''} card${preferredCount === 1 ? '' : 's'}`.replace('  ', ' '),
      mandatory: true,
      sourceName,
      discardCount: Math.min(preferredCount, preferredHand.length),
      hand: toHandCards(preferredHand),
    } as any);

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'chooseDiscardPlanChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(step.sourceId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choice: choiceId,
        branch: 'preferred',
        preferredOptionId,
        preferredType,
        preferredCount,
        fallbackCount,
        queuedResolutionStep,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(chooseDiscardPlanChoiceResolve) failed:', err);
    }
  } else {
    const discardCount = Math.min(fallbackCount, hand.length);
    if (discardCount <= 0) {
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'chooseDiscardPlanChoiceResolve', {
          playerId,
          controllerId,
          sourceId: String(step.sourceId || '').trim() || undefined,
          sourceName,
          resolvedStepId: String(step.id || '').trim() || undefined,
          choice: choiceId,
          branch: 'no_cards',
          preferredOptionId,
          preferredType,
          preferredCount,
          fallbackCount,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(chooseDiscardPlanChoiceResolve) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} had no cards to discard.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: controllerId as any,
      description: `${sourceName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'}`,
      mandatory: true,
      sourceName,
      discardCount,
      hand: toHandCards(hand),
    } as any);

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'chooseDiscardPlanChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(step.sourceId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choice: choiceId,
        branch: 'fallback',
        preferredOptionId,
        preferredType,
        preferredCount,
        fallbackCount,
        queuedResolutionStep,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(chooseDiscardPlanChoiceResolve) failed:', err);
    }
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}
