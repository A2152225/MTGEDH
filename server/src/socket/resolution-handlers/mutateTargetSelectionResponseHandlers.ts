/**
 * socket/resolution-handlers/mutateTargetSelectionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: handleMutateTargetSelectionResponse (choose mutate target, then
 * resume the gated cast or enqueue payment).
 * Public entry symbols: handleMutateTargetSelectionResponse.
 *
 * Terminal for the case: the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { formatManaCostWithCostAdjustment, resolveEffectiveSpellBaseManaCost } from "../game-actions.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import {
  buildPendingCastPaymentStepCostFields,
  buildSpellPaymentPresentationFields,
  ensurePendingCastCostMetadata,
} from "./resolutionPendingCastPaymentPrompt.js";
import { resumePlayerSpellCastAfterPayment } from "./spellCastPaymentResumeHandlers.js";

/** MUTATE_TARGET_SELECTION: record the mutate target and resume the pending cast. */
export async function handleMutateTargetSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  const effectId = String(stepData.effectId || step.sourceId || '').trim();
  const cardId = String(stepData.cardId || '').trim();
  const cardName = String(stepData.cardName || step.sourceName || 'Mutate');

  if (!effectId) {
    debugWarn(1, '[Resolution] MUTATE_TARGET_SELECTION missing effectId');
    return;
  }

  if (response.cancelled) {
    if ((game.state as any)?.pendingSpellCasts?.[effectId]) delete (game.state as any).pendingSpellCasts[effectId];
    if ((game.state as any)?.pendingTargets?.[effectId]) delete (game.state as any).pendingTargets[effectId];

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} cancelled casting ${cardName} for its mutate cost.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const sel = (response.selections || {}) as any;
  const targetPermanentId = String(sel.targetPermanentId || sel.targetId || '').trim();
  const onTop = Boolean(sel.onTop);

  const validTargets: any[] = Array.isArray(stepData.validTargets) ? stepData.validTargets : [];
  let pendingCast = (game.state as any)?.pendingSpellCasts?.[effectId];
  if (!pendingCast) {
    const casts = ((game.state as any)?.pendingSpellCasts || {}) as Record<string, any>;
    pendingCast = Object.values(casts).find((cast: any) =>
      String(cast?.cardId || '') === cardId && String(cast?.playerId || '') === String(pid),
    );
  }
  const validTargetIds = new Set<string>([
    ...validTargets.map((entry: any) => String(entry?.id || '')).filter(Boolean),
    ...((pendingCast as any)?.validTargetIds || []).map((id: any) => String(id || '')).filter(Boolean),
  ]);
  if (!targetPermanentId || (validTargetIds.size > 0 && !validTargetIds.has(targetPermanentId))) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Invalid mutate target selection',
    });
    return;
  }

  if (!pendingCast) {
    (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
    pendingCast = {
      cardId,
      cardName,
      playerId: pid,
      validTargetIds: [targetPermanentId],
      targets: [],
      manaCost: String(stepData.mutateCost || ''),
    };
    (game.state as any).pendingSpellCasts[effectId] = pendingCast;
  }

  pendingCast.targets = [targetPermanentId];
  pendingCast.mutateTarget = targetPermanentId;
  pendingCast.mutateOnTop = onTop;
  pendingCast.forcedAlternateCostId = 'mutate';
  pendingCast.mutateCost = String(stepData.mutateCost || pendingCast.mutateCost || pendingCast.manaCost || '');

  const deferredPayment = pendingCast.deferredSpellPaymentCompletion as {
    payment?: any[];
    xValue?: number;
    convokeTappedCreatures?: string[];
    harmonizeTappedCreatureId?: string;
    sneakReturnedCreatureId?: string;
  } | undefined;

  if (deferredPayment) {
    delete pendingCast.deferredSpellPaymentCompletion;

    const castCompleted = await resumePlayerSpellCastAfterPayment(io, gameId, String(pid), {
      cardId: String(pendingCast.cardId || cardId),
      effectId,
      payment: deferredPayment.payment,
      targets: [targetPermanentId],
      xValue: deferredPayment.xValue,
      alternateCostId: 'mutate',
      convokeTappedCreatures: deferredPayment.convokeTappedCreatures,
      harmonizeTappedCreatureId: deferredPayment.harmonizeTappedCreatureId,
      sneakReturnedCreatureId: deferredPayment.sneakReturnedCreatureId,
    });

    if (castCompleted) {
      debug(2, `[Resolution] Deferred mutate payment complete for ${cardName}; completed cast (effectId='${effectId}')`);
    } else {
      debugWarn(1, `[Resolution] Deferred mutate payment applied for ${cardName} but cast did not complete (effectId='${effectId}')`);
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const existingPaymentStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, pid as any)
    .find((s: any) =>
      s?.type === ResolutionStepType.MANA_PAYMENT_CHOICE &&
      (s as any)?.spellPaymentRequired === true &&
      String((s as any)?.effectId || '') === String(effectId)
    );

  if (!existingPaymentStep) {
    const mutateManaCost = resolveEffectiveSpellBaseManaCost(pendingCast);
    const costMetadata = ensurePendingCastCostMetadata(pendingCast);
    const adjustedMutateManaCost = formatManaCostWithCostAdjustment(
      mutateManaCost,
      costMetadata.costReduction,
      undefined,
      costMetadata.genericCostTax,
    );
    const paymentCostFields = buildPendingCastPaymentStepCostFields(pendingCast, mutateManaCost, adjustedMutateManaCost);
    const paymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: pid as any,
      sourceId: cardId,
      sourceName: cardName,
      sourceImage: stepData.imageUrl || step.sourceImage,
      description: `Pay costs to cast ${cardName} (Mutate).`,
      mandatory: true,

      spellPaymentRequired: true,
      cardId,
      cardName,
      manaCost: paymentCostFields.manaCost,
      effectId,
      targets: [targetPermanentId],
      imageUrl: stepData.imageUrl || step.sourceImage,
      costAdjustment: paymentCostFields.costAdjustment,
      costReduction: paymentCostFields.costReduction,
      convokeOptions: pendingCast.convokeOptions,
      forcedAlternateCostId: 'mutate',
      ...buildSpellPaymentPresentationFields(pendingCast, { game, playerId: pid }),
    } as any);

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      effectId,
      pendingSpellCast: {
        ...(pendingCast || {}),
      },
      queuedResolutionStep: {
        ...(paymentStep as any),
      },
    });
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
