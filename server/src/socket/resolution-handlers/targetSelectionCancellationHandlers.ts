/**
 * socket/resolution-handlers/targetSelectionCancellationHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the whole `if (response.cancelled)` pass that runs before any target validation -
 * declining a ward payment (counter the spell/ability), the three Blight N stages (ward, spell
 * additional cost, ability activation cost), the three activated-ability cost selections whose
 * cancellation just aborts the activation (sacrifice, remove counters, return to hand), and the
 * up-to-N triggered ability where cancelling means "zero targets, resolve anyway".
 * Public entry symbols: handleCancelledTargetSelectionResponse.
 *
 * The original block ended in a bare `return`, so every path here is terminal and the call site is
 * `handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { executeTriggerEffect } from "../../state/modules/stackExecuteTriggerEffectUtils.js";
import { resolveTriggerStackItemEffectText } from "../../state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { emitWardCounterOutcome, tryCounterByWard } from "../resolutionWardUtils.js";
import { broadcastGame, getPlayerName } from "../util.js";
import { emitPendingCastPaymentIfNeeded } from "./resolutionPendingCastPaymentPrompt.js";

/** Cancellation-aware handling for special TARGET_SELECTION steps. */
export function handleCancelledTargetSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepAny = step as any;

  if (stepAny?.wardPayment === true) {
    const triggeredBy = String(stepAny?.wardTriggeredBy || step.sourceId || '').trim();
    const wardController = String(stepAny?.wardPermanentController || 'system');
    const wardName = String(stepAny?.wardPermanentName || step.sourceName || 'Ward');
    if (triggeredBy) {
      const outcome = tryCounterByWard(game, gameId, triggeredBy, wardController);
      emitWardCounterOutcome(io, game, gameId, wardName, pid, outcome, 'declined to pay ward');
    }

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (stepAny?.keywordBlight === true) {
    const stage = String(stepAny?.keywordBlightStage || '');
    const controllerId = String(stepAny?.keywordBlightController || pid);
    const n = Number(stepAny?.keywordBlightN || 0);
    const sourceName = String(stepAny?.keywordBlightSourceName || step.sourceName || 'Blight');

    // Ward—Blight N cancellation means ward wasn't paid and the spell/ability is countered.
    if (stage === 'ward_payment') {
      const sourceId = step.sourceId;
      const wardController = String(stepAny?.keywordBlightWardController || '');

      if (sourceId) {
        const outcome = tryCounterByWard(game, gameId, String(sourceId), wardController || 'system');
        emitWardCounterOutcome(io, game, gameId, sourceName, controllerId, outcome, 'declined to pay ward');
      }

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    // Spell additional-cost blight cancellation = additional cost not paid.
    if (stage === 'cast_additional_cost') {
      const effectId = String(stepAny?.keywordBlightEffectId || '');
      if (effectId && (game.state as any)?.pendingSpellCasts?.[effectId]) {
        (game.state as any).pendingSpellCasts[effectId].additionalCostPaid = false;
        (game.state as any).pendingSpellCasts[effectId].additionalCostMethod = 'none';
      }
      emitPendingCastPaymentIfNeeded(game, gameId, effectId, controllerId);
      return;
    }

    // Activated-ability blight-cost cancellation = activation cancelled.
    if (stage === 'ability_activation_cost') {
      const activationId = String(stepAny?.keywordBlightActivationId || '');
      if (activationId && (game.state as any)?.pendingBlightAbilityActivations?.[activationId]) {
        delete (game.state as any).pendingBlightAbilityActivations[activationId];
      }
      // No-op: the activation never proceeds.
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} cancelled the activation.`,
        ts: Date.now(),
      });
      return;
    }
  }

  // Activated-ability additional-cost: sacrifice selection cancellation = activation cancelled.
  if (stepAny?.sacrificeAbilityAsCost === true) {
    const controllerId = String(stepAny?.playerId || pid);
    const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${cardName}: ${getPlayerName(game, controllerId)} cancelled the activation.`,
      ts: Date.now(),
    });
    return;
  }

  // Activated-ability additional-cost: remove-counters selection cancellation = activation cancelled.
  if (stepAny?.removeCountersAbilityAsCost === true) {
    const controllerId = String(stepAny?.playerId || pid);
    const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${cardName}: ${getPlayerName(game, controllerId)} cancelled the activation.`,
      ts: Date.now(),
    });
    return;
  }

  // Activated-ability additional-cost: return-to-hand selection cancellation = activation cancelled.
  if (stepAny?.returnToHandAbilityAsCost === true) {
    const controllerId = String(stepAny?.playerId || pid);
    const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${cardName}: ${getPlayerName(game, controllerId)} cancelled the activation.`,
      ts: Date.now(),
    });
    return;
  }

  // Up-to-N triggered abilities: cancel == choose zero targets, then resolve.
  if (stepAny?.targetedTriggeredAbility === true && Number(stepAny?.minTargets ?? 1) === 0) {
    const sourceName = String(stepAny?.targetedTriggeredAbilitySourceName || step.sourceName || stepAny?.triggerItem?.sourceName || 'Triggered ability');
    const description = String(stepAny?.targetedTriggeredAbilityDescription || stepAny?.triggerItem?.description || '');
    const controller = String(stepAny?.targetedTriggeredAbilityController || stepAny?.triggerItem?.controller || pid);
    const triggerStackItemId = String(step.sourceId || stepAny?.triggerItem?.id || '').trim();
    if (triggerStackItemId && Array.isArray(game.state?.stack)) {
      const stackItem = game.state.stack.find((item: any) => item && String(item.id || '') === triggerStackItemId);
      if (stackItem) stackItem.targets = [];
    }
    const triggerItem = {
      ...(stepAny.triggerItem || {}),
      sourceName,
      description,
      controller,
      targets: [],
      triggerType: stepAny?.triggerItem?.triggerType || stepAny?.targetedTriggeredAbilityTriggerType,
    };
    const effectText = resolveTriggerStackItemEffectText(triggerItem, { state: game.state });
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = ctx.gameId || gameId;
    ctx.io = ctx.io || io;
    ctx.state = game.state;
    executeTriggerEffect(ctx as any, controller as PlayerID, sourceName, effectText, triggerItem);
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Default cancelled TARGET_SELECTION: no-op.
}
