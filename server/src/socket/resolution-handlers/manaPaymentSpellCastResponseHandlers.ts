/**
 * socket/resolution-handlers/manaPaymentSpellCastResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse,
 * `case ResolutionStepType.MANA_PAYMENT_CHOICE`).
 * Cluster moved: the whole `stepData.spellPaymentRequired === true` body - the cancel path (drop the
 * pending cast and targets, restore a suspended library search, un-flag a Miracle draw, log the
 * cancel), the graveyard-cast payment path (apply the selected mana, then resume
 * continueCastFromGraveyardAbility), the mutate detour (stash the payment on the pending cast and
 * queue MUTATE_TARGET_SELECTION before finishing), and the normal completion path with its three
 * did-not-complete outcomes: deferred to a follow-up prompt, re-queue the payment step, or report
 * that the cast failed.
 * Public entry symbol: handleSpellPaymentChoiceResponse.
 *
 * Every exit in the original was a `break` out of the switch case, so the call site is
 * `await handleSpellPaymentChoiceResponse(...); break;`.
 *
 * `restoreLibrarySearchStep`, `resumePlayerSpellCastAfterPayment` and
 * `emitNextPendingResolutionStep` still live in the parent, so they arrive through the `helpers`
 * argument rather than an import. Wired through resolutionHandlerDeps. Must not import
 * resolution.ts.
 */

import type { Server } from "socket.io";
import { getValidMutateTargets, parseMutateCost } from "../../state/modules/alternate-costs.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { isAIPlayer, rememberAIFailedSpellCast } from "../ai.js";
import { continueCastFromGraveyardAbility } from "../interaction.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { applySelectedManaPaymentForResolutionCost } from "./resolutionManaPaymentApplication.js";
import { buildSpellPaymentPresentationFields } from "./resolutionPendingCastPaymentPrompt.js";

/** Parent-owned helpers this handler still needs; see the module header. */
export type SpellPaymentChoiceHelpers = {
  restoreLibrarySearchStep: (gameId: string, step: any) => void;
  resumePlayerSpellCastAfterPayment: (
    io: Server,
    gameId: string,
    playerId: string,
    options: any,
  ) => Promise<boolean>;
  emitNextPendingResolutionStep: (io: Server, gameId: string, playerId: string) => void;
};

/** MANA_PAYMENT_CHOICE for a spell being cast: cancel, graveyard cast, mutate detour, or finish. */
export async function handleSpellPaymentChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  helpers: SpellPaymentChoiceHelpers,
): Promise<void> {
  const stepData = step as any;
  const pid = response.playerId;

  const effectId = String(stepData.effectId || '');
  const cardId = String(stepData.cardId || stepData.sourceId || '');
  const cardName = String(stepData.cardName || stepData.sourceName || 'Spell');
  const forcedAlternateCostId = stepData.forcedAlternateCostId != null ? String(stepData.forcedAlternateCostId) : undefined;

  if (response.cancelled) {
    if (isAIPlayer(gameId, pid as any)) {
      rememberAIFailedSpellCast(game, String(pid), String(cardId || ''));
    }
    const suspendedLibrarySearchStep = effectId && (game.state as any)?.pendingSpellCasts?.[effectId]?.librarySearchStepToResume;
    if (effectId && (game.state as any)?.pendingSpellCasts?.[effectId]) {
      delete (game.state as any).pendingSpellCasts[effectId];
    }
    if (effectId && (game.state as any)?.pendingTargets?.[effectId]) {
      delete (game.state as any).pendingTargets[effectId];
    }
    if (suspendedLibrarySearchStep) {
      helpers.restoreLibrarySearchStep(gameId, suspendedLibrarySearchStep);
    }

    // If this was a Miracle-initiated cast, clear the first-drawn flags so it can't be re-offered.
    if (forcedAlternateCostId === 'miracle' && cardId) {
      const zones = (game.state as any)?.zones?.[pid];
      const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
      const cardInHand = hand.find((c: any) => c && String(c.id) === String(cardId));
      if (cardInHand) {
        delete (cardInHand as any).isFirstDrawnThisTurn;
        delete (cardInHand as any).drawnAt;
        appendCastSpellContinuationEvent(gameId, game, {
          playerId: pid,
          cardId,
          cardUpdates: {
            isFirstDrawnThisTurn: null,
            drawnAt: null,
          },
        });
      }
    }

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      effectId: effectId || undefined,
      resolvedStepId: String((step as any).id || '').trim(),
      resolvedStepType: String((step as any).type || ''),
      cancelled: true,
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} cancelled casting ${cardName}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const selections = (response.selections || {}) as any;
  const payment = Array.isArray(selections.payment) ? selections.payment : (Array.isArray(response.selections) ? response.selections : undefined);
  const targets = Array.isArray(stepData.targets) ? stepData.targets : undefined;
  const xValue = selections.xValue != null ? Number(selections.xValue) : undefined;
  const alternateCostId = forcedAlternateCostId || (selections.alternateCostId != null ? String(selections.alternateCostId) : undefined);
  const convokeTappedCreatures = Array.isArray(selections.convokeTappedCreatures)
    ? selections.convokeTappedCreatures.map((x: any) => String(x))
    : undefined;
  const harmonizeTappedCreatureId = typeof selections.harmonizeTappedCreatureId === 'string'
    ? String(selections.harmonizeTappedCreatureId)
    : undefined;
  const sneakReturnedCreatureId = typeof selections.sneakReturnedCreatureId === 'string'
    ? String(selections.sneakReturnedCreatureId)
    : undefined;


  // Graveyard spell cast payment (flashback, jump-start, etc.) queued by
  // continueCastFromGraveyardAbility when floating mana was insufficient but available
  // sources (untapped lands) could cover the cost. The regular completeCastSpell path
  // does NOT apply here because there is no pendingSpellCasts entry for graveyard casts.
  if (stepData.graveyardSpellCastManaPayment === true) {
    const manaCostText = String(stepData.manaCost || '').trim();
    const applied = applySelectedManaPaymentForResolutionCost(game, String(pid), manaCostText, payment);
    if (!applied.ok) {
      const appliedError = applied as { ok: false; code: string; message: string };
      emitToPlayer(io, pid as any, 'error', { code: appliedError.code, message: appliedError.message });
      return;
    }
    const result = continueCastFromGraveyardAbility({
      gameId,
      game,
      io,
      playerId: String(pid),
      cardId: String(stepData.cardId || stepData.sourceId || '').trim(),
      abilityId: String(stepData.abilityId || '').trim(),
      targets: Array.isArray(stepData.targetsForCast) ? stepData.targetsForCast : undefined,
      discardedCardIds: Array.isArray(stepData.discardedCardIdsForCost)
        ? stepData.discardedCardIdsForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      exiledCardIdsFromHandForCost: Array.isArray(stepData.exiledCardIdsFromHandForCost)
        ? stepData.exiledCardIdsFromHandForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      exiledCardIdsFromGraveyardForCost: Array.isArray(stepData.exiledCardIdsFromGraveyardForCost)
        ? stepData.exiledCardIdsFromGraveyardForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      sacrificedPermanentIdsForCost: Array.isArray(stepData.sacrificedPermanentIdsForCost)
        ? stepData.sacrificedPermanentIdsForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      xValue: Number.isFinite(Number(stepData.xValue)) ? Math.max(0, Math.floor(Number(stepData.xValue))) : undefined,
      manaCostAlreadyPaid: true,
      // Payment taps/mana already persisted by applySelectedManaPaymentForResolutionCost.
      sacrificedPermanentsForManaCost: applied.sacrificedPermanents.length > 0 ? applied.sacrificedPermanents : undefined,
      emitError: (payload) => emitToPlayer(io, pid as any, 'error', payload),
    });
    debug(2, `[Resolution] Graveyard spell payment complete for ${cardName}; resumed cast (result='${result}')`);
    if (result !== 'error') {
      broadcastGame(io, game, gameId);
    }
    return;
  }

  // Unified payment step: mutate target is chosen after paying when alternateCostId is mutate.
  if (alternateCostId === 'mutate') {
    const pendingCast = effectId ? (game.state as any)?.pendingSpellCasts?.[effectId] : undefined;
    const existingMutateTarget = String(
      pendingCast?.mutateTarget
      || pendingCast?.targets?.[0]
      || targets?.[0]
      || '',
    ).trim();

    if (!existingMutateTarget) {
      const mutateCtx: any = { state: game.state };
      const validMutateTargets = getValidMutateTargets(mutateCtx, pid as PlayerID);
      if (validMutateTargets.length === 0) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'NO_VALID_TARGETS',
          message: `No valid mutate targets for ${cardName}`,
        });
        return;
      }

      const oracleTextForMutate = String(
        pendingCast?.oracleText
        || pendingCast?.card?.oracle_text
        || stepData.oracleText
        || '',
      );
      const rawMutateCost = parseMutateCost(oracleTextForMutate) || String(
        (Array.isArray(pendingCast?.extraAlternateCosts) ? pendingCast.extraAlternateCosts : [])
          .find((entry: any) => String(entry?.id || '') === 'mutate')
          ?.rawCost
        || (Array.isArray(pendingCast?.extraAlternateCosts) ? pendingCast.extraAlternateCosts : [])
          .find((entry: any) => String(entry?.id || '') === 'mutate')
          ?.manaCost
        || '',
      ).trim();

      if (pendingCast) {
        pendingCast.forcedAlternateCostId = 'mutate';
        pendingCast.alternateCostId = 'mutate';
        if (rawMutateCost) pendingCast.mutateCost = rawMutateCost;
        pendingCast.deferredSpellPaymentCompletion = {
          payment,
          xValue,
          convokeTappedCreatures,
          harmonizeTappedCreatureId,
          sneakReturnedCreatureId,
        };
      }

      const mutateTargetStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MUTATE_TARGET_SELECTION,
        playerId: pid as any,
        sourceId: effectId,
        sourceName: cardName,
        sourceImage: stepData.imageUrl || step.sourceImage,
        description: `Choose a creature to mutate onto for ${cardName}.`,
        mandatory: true,
        effectId,
        cardId,
        cardName,
        mutateCost: rawMutateCost,
        imageUrl: stepData.imageUrl || step.sourceImage,
        validTargets: validMutateTargets.map((target: any) => {
          const perm: any = (game.state.battlefield || []).find((entry: any) => entry && String(entry.id) === String(target.permanentId));
          return {
            id: String(target.permanentId),
            name: String(target.cardName || 'Creature'),
            typeLine: String(target.typeLine || ''),
            power: target.power,
            toughness: target.toughness,
            imageUrl: target.imageUrl,
            controller: String(target.controller || ''),
            owner: String(target.owner || ''),
            isAlreadyMutated: Boolean((perm as any)?.mutatedStack),
            mutationCount: Number((perm as any)?.mutatedStack?.length || 0),
          };
        }),
      } as any);

      appendCastSpellContinuationEvent(gameId, game, {
        playerId: pid,
        cardId,
        effectId,
        pendingSpellCast: {
          ...(pendingCast || {}),
        },
        queuedResolutionStep: {
          ...(mutateTargetStep as any),
        },
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
  }

  const castCompleted = await helpers.resumePlayerSpellCastAfterPayment(io, gameId, String(pid), {
    cardId,
    effectId,
    payment,
    targets,
    xValue,
    alternateCostId,
    convokeTappedCreatures,
    harmonizeTappedCreatureId,
    sneakReturnedCreatureId,
  });

  // Persist that this payment prompt was resolved so replay clears it even when
  // older event logs lack prune-friendly stack evidence.
  appendCastSpellContinuationEvent(gameId, game, {
    playerId: pid,
    cardId,
    effectId: effectId || undefined,
    resolvedStepId: String((step as any).id || '').trim(),
    resolvedStepType: String((step as any).type || ''),
  });

  if (castCompleted) {
    debug(2, `[Resolution] Spell payment complete for ${cardName}; completed cast server-side (effectId='${effectId}')`);
  } else {
    // Alternate-cost / additional prompts may still be pending for this cast — not a failure.
    const stillPendingCast = Boolean(effectId && (game.state as any)?.pendingSpellCasts?.[effectId]);
    const relatedPendingSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .filter((queued: any) => {
        const queuedEffectId = String(queued?.effectId || '');
        const queuedCardId = String(queued?.cardId || queued?.sourceId || '');
        return (
          (effectId && queuedEffectId === String(effectId)) ||
          (cardId && queuedCardId === String(cardId))
        );
      });

    if (relatedPendingSteps.length > 0) {
      debug(2, `[Resolution] Spell payment for ${cardName} deferred to follow-up prompt(s) (effectId='${effectId}')`);
    } else if (stillPendingCast) {
      // Payment step was consumed but cast did not finish and no follow-up prompt exists.
      // Re-queue so the player can pay again instead of being stuck.
      const pendingCast = (game.state as any).pendingSpellCasts[effectId];
      if (isAIPlayer(gameId, pid as any)) {
        const retries = Number(pendingCast?._aiSpellPaymentRetryCount || 0);
        if (retries >= 1) {
          debugWarn(1, `[Resolution] AI spell payment for ${cardName} failed repeatedly; abandoning cast (effectId='${effectId}')`);
          rememberAIFailedSpellCast(game, String(pid), String(cardId || ''));
          delete (game.state as any).pendingSpellCasts[effectId];
          if (effectId && (game.state as any)?.pendingTargets?.[effectId]) {
            delete (game.state as any).pendingTargets[effectId];
          }
          appendCastSpellContinuationEvent(gameId, game, {
            playerId: pid,
            cardId,
            effectId: effectId || undefined,
            resolvedStepId: String((step as any).id || '').trim(),
            resolvedStepType: String((step as any).type || ''),
            cancelled: true,
          });
          if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
          broadcastGame(io, game, gameId);
          helpers.emitNextPendingResolutionStep(io, gameId, String(pid));
          return;
        }
        if (pendingCast) {
          pendingCast._aiSpellPaymentRetryCount = retries + 1;
        }
      }
      debugWarn(1, `[Resolution] Spell payment for ${cardName} did not complete; re-queuing payment step (effectId='${effectId}')`);
      const requeued = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: pid as any,
        sourceId: cardId,
        sourceName: cardName,
        sourceImage: stepData.imageUrl || step.sourceImage,
        description: `Pay costs to cast ${cardName}.`,
        mandatory: true,
        spellPaymentRequired: true,
        cardId,
        cardName,
        manaCost: stepData.manaCost,
        xValue: stepData.xValue,
        effectId,
        targets: stepData.targets,
        imageUrl: stepData.imageUrl || step.sourceImage,
        costAdjustment: stepData.costAdjustment,
        costReduction: stepData.costReduction,
        convokeOptions: stepData.convokeOptions,
        harmonizeOptions: stepData.harmonizeOptions,
        sneakOptions: stepData.sneakOptions,
        forcedAlternateCostId: stepData.forcedAlternateCostId,
        preferredAlternateCostId: stepData.preferredAlternateCostId,
        oracleText: stepData.oracleText,
        extraAlternateCosts: stepData.extraAlternateCosts,
        fromZone: stepData.fromZone,
        ...buildSpellPaymentPresentationFields(pendingCast, { game, playerId: String(pid) }),
      } as any);
      debug(2, `[Resolution] Re-queued spell payment step ${String((requeued as any)?.id || '')} for ${cardName}`);
      emitToPlayer(io, pid as any, 'error', {
        code: 'CAST_PAYMENT_RETRY',
        message: `Payment for ${cardName} did not finish casting — please pay again.`,
      });
      helpers.emitNextPendingResolutionStep(io, gameId, String(pid));
    } else {
      debugWarn(1, `[Resolution] Spell payment applied for ${cardName} but cast did not complete (effectId='${effectId}')`);
      if (isAIPlayer(gameId, pid as any)) {
        rememberAIFailedSpellCast(game, String(pid), String(cardId || ''));
      }
      emitToPlayer(io, pid as any, 'error', {
        code: 'CAST_DID_NOT_COMPLETE',
        message: `Payment for ${cardName} did not finish casting — try casting again.`,
      });
    }
  }
}
