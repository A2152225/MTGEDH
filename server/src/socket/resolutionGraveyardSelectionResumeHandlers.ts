/**
 * socket/resolutionGraveyardSelectionResumeHandlers.ts
 *
 * Post-move graveyard-selection work: turn-tracking / persist, reflexive +
 * triggered followups, and graveyard-exile / graveyard-cast as-cost resumes.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
} from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { parseTargetRequirements } from "../rules-engine/targeting";
import { applyTriggeredReanimationEntryRiders } from "../state/modules/triggerReanimationRiders.js";
import { triggerETBEffectsForPermanent } from "../state/modules/triggerEtbPermanentEffects.js";
import { materializeReflexiveSourceText } from "../state/modules/reflexive-triggers.js";
import { uid } from "../state/utils.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";
import { continueCastFromGraveyardAbility } from "./interaction.js";
import {
  battlefieldAbilityStackReplayEvidence,
  buildActivatedAbilityValidTargets,
  fireBattlefieldAbilityActivatedTriggers,
} from "./resolutionActivatedAbilityTargetingUtils.js";
import { inferFollowupTargetMetadata } from "./resolutionDiscardTriggerUtils.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "./resolutionKeywordChoiceHandlers.js";
import { resumePlayerCastSpellFromHand } from "./resolutionSyntheticCastSocketUtils.js";
import { resolveGraveyardExileSourcePermanentId } from "../state/modules/exileWithSourceStamp.js";

export type GraveyardSelectionApplyResult = {
  io: Server;
  game: any;
  gameId: string;
  step: ResolutionStep;
  pid: any;
  stepData: any;
  cardName: string;
  title: string;
  destination: 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | 'exile' | string;
  purpose: string;
  collectEvidenceMinManaValue: number;
  effectId: string;
  targetPlayerId: string;
  minTargets: number;
  maxTargets: number;
  totalPowerLimit: number;
  validTargets: any[];
  zones: any;
  selectedCardIds: string[];
  movedCards: string[];
  movedCardIds: string[];
  movedCardSnapshots: any[];
  createdBattlefieldEntries: Array<{ permanent: any; controllerId: string }>;
  createdPermanentIds: string[];
  evidenceCollected: boolean;
};

export async function finishGraveyardSelectionAfterApply(
  ctx: GraveyardSelectionApplyResult,
): Promise<void> {
  const {
    io,
    game,
    gameId,
    step,
    pid,
    stepData,
    cardName,
    title,
    destination,
    purpose,
    collectEvidenceMinManaValue,
    effectId,
    targetPlayerId,
    minTargets,
    maxTargets,
    totalPowerLimit,
    validTargets,
    zones,
    selectedCardIds,
    movedCards,
    movedCardIds,
    movedCardSnapshots,
    createdBattlefieldEntries,
    createdPermanentIds,
    evidenceCollected,
  } = ctx;

  // Turn-tracking for intervening-if: evidence was collected this turn.
  if (evidenceCollected) {
    try {
      const stateAny = game.state as any;
      stateAny.evidenceCollectedThisTurn = stateAny.evidenceCollectedThisTurn || {};
      stateAny.evidenceCollectedThisTurnByPlayer = stateAny.evidenceCollectedThisTurnByPlayer || {};
      stateAny.evidenceCollectedThisTurnByPlayerCounts = stateAny.evidenceCollectedThisTurnByPlayerCounts || {};
      stateAny.evidenceCollectedThisTurn[String(pid)] = true;
      stateAny.evidenceCollectedThisTurnByPlayer[String(pid)] = true;
      stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] = (stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] || 0) + 1;
    } catch {
      // best-effort only
    }
  }

  // Persist event for replay (legacy name retained).
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'confirmGraveyardTargets', {
      playerId: pid,
      effectId,
      selectedCardIds: movedCardIds,
      createdPermanentIds: createdPermanentIds.length > 0 ? createdPermanentIds : undefined,
      destination,
      targetPlayerId: targetPlayerId || undefined,
      destinationUsesSelectedCardOwner: stepData.destinationUsesSelectedCardOwner === true ? true : undefined,
      battlefieldControllerMode: String(stepData.battlefieldControllerMode || '').trim() || undefined,
      battlefieldControllerId: String(stepData.battlefieldControllerId || '').trim() || undefined,
      battlefieldTapped: stepData.battlefieldTapped === true ? true : undefined,
      battlefieldCounters: stepData.battlefieldCounters && typeof stepData.battlefieldCounters === 'object'
        ? { ...(stepData.battlefieldCounters as Record<string, number>) }
        : undefined,
      battlefieldFaceDown: stepData.battlefieldFaceDown === true ? true : undefined,
      battlefieldSuspected: stepData.battlefieldSuspected === true ? true : undefined,
      movedCards,
      purpose: purpose || undefined,
      collectEvidenceMinManaValue: Number.isFinite(collectEvidenceMinManaValue) ? collectEvidenceMinManaValue : undefined,
      evidenceCollected: evidenceCollected || undefined,
      ...(destination === 'exile'
        ? { exiledWithSourceId: resolveGraveyardExileSourcePermanentId(stepData) || undefined }
        : {}),
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(confirmGraveyardTargets) failed:', e);
  }

  if ((step as any)?.reflexiveGraveyardExileWhenYouDo === true && destination === 'exile' && movedCardIds.length > 0) {
    const controllerId = String((step as any)?.reflexiveGraveyardExileWhenYouDoController || pid);
    const sourceName = String((step as any)?.reflexiveGraveyardExileWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String((step as any)?.reflexiveGraveyardExileWhenYouDoSourcePermanentId || step.sourceId || '').trim();
    const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, step as any, sourcePermanentId || undefined);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const followupText = String((step as any)?.reflexiveGraveyardExileWhenYouDoFollowupDescription || '').trim();
    const effectText = materializeReflexiveSourceText(followupText, sourceName);
    const triggerId = uid('trigger');
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const effectData = {
      exiledCardIds: movedCardIds.slice(),
      exiledCards: movedCardSnapshots.map((card: any) => ({ ...(card as any) })),
      exileCount: movedCardIds.length,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_graveyard_exile',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveGraveyardExileResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        cardIds: movedCardIds.slice(),
        followupText,
        effect: effectText,
        triggerId,
        ...targetMetadata,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveGraveyardExileResolve) failed:', err);
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_graveyard_exile',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive graveyard exile) failed:', err);
    }
  }

  const triggeredAbilityEffectText = String((step as any)?.triggeredAbilityEffectText || '').trim();

  for (const entry of createdBattlefieldEntries) {
    const ctx = {
      state: game.state,
      gameId,
      libraries: (game as any).libraries,
      commandZone: (game as any).commandZone,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
      },
    } as any;
    if (
      destination === 'battlefield'
      && triggeredAbilityEffectText
      && ((step as any)?.triggeredAbilityGraveyardSelection === true || (step as any)?.triggeredAbilityGraveyardChoice === true)
    ) {
      applyTriggeredReanimationEntryRiders(
        ctx,
        entry.permanent,
        String(step.sourceName || cardName || 'Ability'),
        entry.controllerId as PlayerID,
        triggeredAbilityEffectText,
        String(entry.permanent?.card?.name || entry.permanent?.id || ''),
      );
    }
    triggerETBEffectsForPermanent(ctx, entry.permanent, entry.controllerId as PlayerID);
  }

  if (movedCards.length > 0) {
    const destName = destination === 'hand'
      ? 'hand'
      : destination === 'battlefield'
        ? 'battlefield'
        : destination === 'library_top'
          ? 'top of library'
          : destination === 'library_bottom'
            ? 'bottom of library'
            : 'exile';

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} moves ${movedCards.join(', ')} from graveyard to ${destName} (${cardName}).`,
      ts: Date.now(),
    });
  }

  if ((step as any)?.graveyardCastExileAsCost === true) {
    try {
      const stepAny = step as any;
      const controllerId = String(pid);
      const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();

      const playerZones = (game.state as any)?.zones?.[controllerId];
      const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
      const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === cardId);
      if (cardIndex === -1) {
        emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
        return;
      }

      const result = continueCastFromGraveyardAbility({
        gameId,
        game,
        io,
        playerId: controllerId,
        cardId,
        abilityId,
        exiledCardIdsFromGraveyardForCost: movedCardIds,
        targets: Array.isArray(stepAny?.targetsForCast) ? stepAny.targetsForCast : undefined,
        xValue: stepAny?.exileCountIsX === true
          ? movedCardIds.length
          : (Number.isFinite(Number(stepAny?.xValue)) ? Math.max(0, Math.floor(Number(stepAny.xValue))) : undefined),
        emitError: (payload) => emitToPlayer(io, controllerId as any, 'error', payload),
      });

      if (result !== 'error') {
        broadcastGame(io, game, gameId);
      }
      return;
    } catch (err) {
      debugError(1, '[Resolution] Failed to resume graveyard exile-cost cast', err);
    }
  }

  // Activated-ability exile-from-graveyard-cost flow: resume the activation after the exile is applied.
  if ((step as any)?.graveyardExileAbilityAsCost === true) {
    try {
      const stepAny = step as any;
      const controllerId = String(pid);
      const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();
      const sourceName = String(stepAny?.cardName || step.sourceName || 'Ability');
      const abilityText = String(stepAny?.abilityText || step.description || '');
      const manaCost = String(stepAny?.manaCost || '');
      const requiresTap = Boolean(stepAny?.requiresTap);
      const activatedAbilityText = String(stepAny?.activatedAbilityText || '') || `${manaCost}: ${abilityText}`;

      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
      if (!sourcePerm) {
        emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(sourcePerm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (sourcePerm as any).tapped) {
        emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: `${sourceName} is already tapped` });
        return;
      }

      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the exile-from-graveyard clause.
      const remainingNonManaCostText = manaCost
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        .replace(
          /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|legendary|nonland|noncreature)\s+)?cards?\s+from\s+your\s+graveyard\b/gi,
          ' '
        )
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostText.length > 0) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost (${remainingNonManaCostText}).`,
        });
        return;
      }

      // Pay mana portion of the activation cost (conservative: no Phyrexian and no X).
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
      const manaOnly = manaSymbols
        .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
        .join('');
      if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
        emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
        return;
      }

      if (manaOnly) {
        const { payAbilityManaCostFromPool } = await import('./util.js');
        const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[graveyardExileAbilityAsCost]');
        if (!paid.ok) {
          emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (paid as any).error || 'Insufficient mana.' });
          return;
        }
      }

      // Optional deferred life payment (validated at activation time; applied now so cancel doesn't charge life)
      const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);
      if (lifeToPayForCost > 0) {
        const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
        if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
          emitToPlayer(io, controllerId, 'error', {
            code: 'INSUFFICIENT_LIFE',
            message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
          });
          return;
        }
        (game.state as any).life[controllerId] = currentLife - lifeToPayForCost;
      }

      const tappedPermanentsForCost: string[] = [];
      if (requiresTap && !(sourcePerm as any).tapped) {
        (sourcePerm as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      const targetReqs = parseTargetRequirements(abilityText, {
        gameState: game.state,
        controllerId: String(controllerId),
        sourceName: cardName,
        sourcePermanent: sourcePerm,
      });
      if (targetReqs.needsTargets) {
        const validTargets = buildActivatedAbilityValidTargets(game, controllerId, targetReqs);
        const minTargets = Number(targetReqs.minTargets ?? 1);
        const maxTargets = Number(targetReqs.maxTargets ?? minTargets);
        if (validTargets.length < minTargets) {
          emitToPlayer(io, controllerId, 'error', {
            code: 'NO_VALID_TARGETS',
            message: `${cardName}'s ability requires at least ${minTargets} target(s), but only ${validTargets.length} are available.`,
          });
          return;
        }

        const useGraveyardSelection = Array.isArray(targetReqs.targetTypes)
          && targetReqs.targetTypes.length > 0
          && targetReqs.targetTypes.every((targetType) => String(targetType || '').toLowerCase().startsWith('graveyard_'))
          && typeof targetReqs.targetTotalPowerLimit === 'number'
          && Number.isFinite(targetReqs.targetTotalPowerLimit)
          && targetReqs.targetTotalPowerLimit > 0;
        const graveyardSelectionTargetPlayerId = useGraveyardSelection
          ? (() => {
              const ownerIds = Array.from(new Set(validTargets.map((target: any) => String(target?.zoneOwnerId || target?.controller || '')).filter(Boolean)));
              return ownerIds.length === 1 ? ownerIds[0] : undefined;
            })()
          : undefined;
        const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, (useGraveyardSelection
          ? {
              type: ResolutionStepType.GRAVEYARD_SELECTION,
              playerId: controllerId as any,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
              title: cardName,
              description: `Choose ${targetReqs.targetDescription || 'target'} for ${cardName}`,
              mandatory: minTargets > 0,
              validTargets,
              targetTypes: targetReqs.targetTypes,
              minTargets,
              maxTargets,
              targetDescription: targetReqs.targetDescription || 'target',
              targetPlayerId: graveyardSelectionTargetPlayerId,
              destination: 'battlefield',
              totalPowerLimit: Number(targetReqs.targetTotalPowerLimit),
              battlefieldAbilityTargetSelection: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
              tappedPermanentsForCost,
              discardedCardIdsForCost: Array.isArray(stepAny?.discardedCardIdsForCost)
                ? stepAny.discardedCardIdsForCost.map((id: any) => String(id)).filter(Boolean)
                : undefined,
              lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            }
          : {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: controllerId as any,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
              description: abilityText,
              mandatory: minTargets > 0,
              validTargets,
              targetTypes: targetReqs.targetTypes,
              minTargets,
              maxTargets,
              targetDescription: targetReqs.targetDescription || 'target',
              battlefieldAbilityTargetSelection: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
              tappedPermanentsForCost,
              discardedCardIdsForCost: Array.isArray(stepAny?.discardedCardIdsForCost)
                ? stepAny.discardedCardIdsForCost.map((id: any) => String(id)).filter(Boolean)
                : undefined,
              lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            }) as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName: sourceName,
            abilityText,
            activatedAbilityText,
            tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
            exiledCardIdsFromGraveyardForCost: movedCardIds,
            lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            queuedResolutionStep,
          });
        } catch {
          // ignore persistence failures
        }

        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }

      // Put the ability on the stack.
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: controllerId,
        source: permanentId,
        sourceName,
        description: abilityText,
        activatedAbilityText,
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            ...battlefieldAbilityStackReplayEvidence(stackItem.id),
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName: sourceName,
            abilityText,
            activatedAbilityText,
            tappedPermanents: tappedPermanentsForCost,
            exiledCardIdsFromGraveyardForCost: movedCardIds,
            lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
          });
        } catch {
          // ignore persistence failures
        }
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, controllerId)} activated ${sourceName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });
    } catch (err) {
      debugError(1, '[Resolution] Failed to resume exile-from-graveyard-cost activation', err);
    }
  }

  // Optional cast continuation (used for additional-cost flows like collect evidence).
  const castArgs = stepData.castSpellFromHandArgs as any;
  if (castArgs && typeof castArgs === 'object' && castArgs.cardId) {
    const basePayment = Array.isArray(castArgs?.payment) ? castArgs.payment : [];
    const alreadyMarked = basePayment.some((p: any) => p && p.collectEvidenceResolved === true);
    const evidenceMarker = {
      collectEvidenceResolved: true,
      evidenceCollected: evidenceCollected === true,
      evidenceWasCollected: evidenceCollected === true,
      collectedEvidence: evidenceCollected === true,
    };
    const paymentWithMarker = alreadyMarked ? basePayment : [...basePayment, evidenceMarker];

    await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
      cardId: String(castArgs.cardId),
      targets: castArgs.targets,
      payment: paymentWithMarker,
      xValue: castArgs.xValue,
      alternateCostId: castArgs.alternateCostId,
      convokeTappedCreatures: castArgs.convokeTappedCreatures,
    });
    return;
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
