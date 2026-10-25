/**
 * socket/resolution-handlers/targetSelectionBattlefieldAbilityHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the `battlefieldAbilityTargetSelection` branch - the continuation for an activated
 * battlefield ability once its interactive costs are paid and its targets are chosen. Equip /
 * fortify / reconfigure first detour through a MANA_PAYMENT_CHOICE prompt when their targeting cost
 * still has mana in it; otherwise the ability (with equip/fortify/reconfigure params) goes on the
 * stack, self-exert is finalized, and tap triggers fire for permanents tapped to pay the cost.
 * Public entry symbols: handleBattlefieldAbilityTargetSelection.
 *
 * The branch always returned, so the caller does `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import { equipLifeCostError, payEquipLifeCost } from "../../state/modules/equipNonManaCosts.js";
import { handleEquipSacrificeCostStage } from "./targetSelectionEquipSacrificeCost.js"; // UI34
import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { applyPowerUpDiscountsToActivationManaCost } from "../../state/modules/marvelMechanicsHelpers.js";
import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { finalizeBattlefieldAbilitySelfExertCost } from "../resolutionGraveyardSelectionHelperUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName, parseManaCost } from "../util.js";

/** TARGET_SELECTION with `battlefieldAbilityTargetSelection`: finish activating the ability. */
export async function handleBattlefieldAbilityTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;
  const targetStepData = stepAny as TargetSelectionStep;
  let validTargets: any[] = [...(targetStepData.validTargets || [])];
  const minTargets = targetStepData.minTargets || 0;
  const maxTargets = targetStepData.maxTargets || Infinity;

  const controllerId = String(step.playerId || pid);
  const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
  const abilityId = String(stepAny?.abilityId || '').trim();
  const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
  const abilityText = String(stepAny?.abilityText || step.description || '').trim();
  const activatedAbilityText = String(stepAny?.activatedAbilityText || '').trim();
  const tappedPermanentsForCost = Array.isArray(stepAny?.tappedPermanentsForCost)
    ? stepAny.tappedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
    : [];

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sourcePerm = battlefield.find((perm: any) => perm && String(perm.id) === permanentId);
  if (!sourcePerm) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
    return;
  }
  if (String(sourcePerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
    return;
  }

  let selectedTargetIds = selections.map((value: any) => String(value)).filter(Boolean);
  if (selectedTargetIds.length < minTargets || selectedTargetIds.length > maxTargets) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'INVALID_TARGET_COUNT',
      message: `Select ${minTargets === maxTargets ? minTargets : `${minTargets}-${maxTargets}`} target(s).`,
    });
    return;
  }

  const validIds = new Set(validTargets.map((target: any) => String(target?.id || '')).filter(Boolean));
  for (const id of selectedTargetIds) {
    if (!validIds.has(id)) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_TARGET', message: 'Invalid target selection' });
      return;
    }
  }

  const battlefieldAbilityType = String(stepAny?.abilityType || abilityId || '');

  if (battlefieldAbilityType === 'equip' || battlefieldAbilityType === 'fortify' || battlefieldAbilityType === 'reconfigure_attach') {
    const targetingCost = battlefieldAbilityType === 'equip'
      ? String(stepAny?.equipCost || '').trim()
      : battlefieldAbilityType === 'fortify'
        ? String(stepAny?.fortifyCost || '').trim()
        : String(stepAny?.reconfigureCost || '').trim();
    if (battlefieldAbilityType === 'equip') {
      const sac = handleEquipSacrificeCostStage(io, game, gameId, step, controllerId, permanentId, targetingCost, selectedTargetIds, validTargets);
      if (sac.done) return;
      selectedTargetIds = sac.targetIds;
      validTargets = sac.validTargets;
    }
    const b33LifeError = equipLifeCostError(game.state, String(controllerId), targetingCost);
    if (b33LifeError) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: b33LifeError });
      return;
    }
    const b33LifePaid = payEquipLifeCost(game.state, String(controllerId), targetingCost);
    const parsedTargetingCost = targetingCost && !b33LifePaid ? parseManaCost(targetingCost) : undefined;
    const hasTargetingManaCost = Boolean(
      parsedTargetingCost && (
        Number(parsedTargetingCost.generic || 0) > 0 ||
        Object.values(parsedTargetingCost.colors || {}).some((amount) => Number(amount || 0) > 0) ||
        (Array.isArray(parsedTargetingCost.hybrids) && parsedTargetingCost.hybrids.length > 0)
      )
    );
    if (hasTargetingManaCost) {
      const discountedTargetingCost = applyPowerUpDiscountsToActivationManaCost(
        targetingCost,
        sourcePerm,
        game.state,
        controllerId,
        { activatedAbilityText, abilityId },
      );
      const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: controllerId as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: step.sourceImage,
        description: `Choose how to pay ${discountedTargetingCost} for ${cardName}.`,
        mandatory: true,
        activationPaymentChoice: true,
        activationPaymentContext: 'battlefield_targeted',
        confirmLabel: 'Pay and Activate',
        permanentId,
        abilityId,
        cardName,
        manaCost: discountedTargetingCost,
        abilityText,
        activatedAbilityText,
        targetIds: selectedTargetIds,
        validTargets,
        targetTypes: Array.isArray(targetStepData.targetTypes) ? [...targetStepData.targetTypes] : [],
        minTargets,
        maxTargets,
        targetDescription: String(targetStepData.targetDescription || 'target'),
        abilityType: battlefieldAbilityType,
        equipCost: stepAny?.equipCost,
        fortifyCost: stepAny?.fortifyCost,
        reconfigureCost: stepAny?.reconfigureCost,
        tappedPermanentsForCost,
      } as any);

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: controllerId,
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          activatedAbilityText: activatedAbilityText || undefined,
          tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
          queuedResolutionStep,
        });
      } catch {
        // ignore persistence failures
      }

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
  }

  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: controllerId,
    source: permanentId,
    sourceName: cardName,
    description: abilityText,
    activatedAbilityText: activatedAbilityText || undefined,
    targets: selectedTargetIds,
    copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
    copyRetargetTargetTypes: Array.isArray(targetStepData.targetTypes) ? [...targetStepData.targetTypes] : [],
    copyRetargetMinTargets: minTargets,
    copyRetargetMaxTargets: maxTargets,
    copyRetargetTargetDescription: String(targetStepData.targetDescription || 'target'),
    sacrificedPermanents: Array.isArray(stepAny?.sacrificedPermanentsForCost)
      ? stepAny.sacrificedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : undefined,
    lastSacrificedPermanents: Array.isArray(stepAny?.lastSacrificedPermanents)
      ? stepAny.lastSacrificedPermanents.map((entry: any) => ({ ...entry }))
      : undefined,
  } as any;

  if (battlefieldAbilityType === 'equip') {
    const targetCreatureId = String(selectedTargetIds[0] || '');
    const targetCreature = battlefield.find((perm: any) => perm && String(perm.id) === targetCreatureId);
    stackItem.abilityType = 'equip';
    stackItem.equipParams = {
      equipmentId: permanentId,
      targetCreatureId,
      equipmentName: cardName,
      targetCreatureName: String(targetCreature?.card?.name || 'Creature'),
    };
  } else if (battlefieldAbilityType === 'fortify') {
    const targetLandId = String(selectedTargetIds[0] || '');
    const targetLand = battlefield.find((perm: any) => perm && String(perm.id) === targetLandId);
    stackItem.abilityType = 'fortify';
    stackItem.fortifyParams = {
      fortificationId: permanentId,
      targetLandId,
      fortificationName: cardName,
      targetLandName: String(targetLand?.card?.name || 'Land'),
    };
  } else if (battlefieldAbilityType === 'reconfigure_attach') {
    const targetCreatureId = String(selectedTargetIds[0] || '');
    const targetCreature = battlefield.find((perm: any) => perm && String(perm.id) === targetCreatureId);
    stackItem.abilityType = 'reconfigure_attach';
    stackItem.reconfigureParams = {
      reconfigureId: permanentId,
      targetCreatureId,
      reconfigureName: cardName,
      targetCreatureName: String(targetCreature?.card?.name || 'Creature'),
    };
  }

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);

  const exertedPermanentIdForCost = finalizeBattlefieldAbilitySelfExertCost(
    game,
    gameId,
    controllerId,
    permanentId,
    stepAny?.requiresSelfExertForCost === true,
  );

  fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        ...battlefieldAbilityStackReplayEvidence(stackItem.id),
        playerId: controllerId,
        permanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        activatedAbilityText: activatedAbilityText || undefined,
        targets: selectedTargetIds,
        copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
        copyRetargetTargetTypes: Array.isArray(targetStepData.targetTypes) ? [...targetStepData.targetTypes] : [],
        copyRetargetMinTargets: minTargets,
        copyRetargetMaxTargets: maxTargets,
        copyRetargetTargetDescription: String(targetStepData.targetDescription || 'target'),
        abilityType: stackItem.abilityType || undefined,
        equipParams: stackItem.equipParams || undefined,
        fortifyParams: stackItem.fortifyParams || undefined,
        reconfigureParams: stackItem.reconfigureParams || undefined,
        tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
        tapCostTargetFilter: stepAny?.tapCostTargetFilter ? { ...stepAny.tapCostTargetFilter } : undefined,
        tapCostTargetCount: Number.isFinite(Number(stepAny?.tapCostTargetCount)) ? Number(stepAny.tapCostTargetCount) : undefined,
        tapCostPreferTokens: stepAny?.tapCostPreferTokens === true ? true : undefined,
        tapCostPreferNonTokens: stepAny?.tapCostPreferNonTokens === true ? true : undefined,
        discardedCardIds: Array.isArray(stepAny?.discardedCardIdsForCost) && stepAny.discardedCardIdsForCost.length > 0
          ? stepAny.discardedCardIdsForCost.map((id: any) => String(id))
          : undefined,
        exiledCardIdsFromHandForCost: Array.isArray(stepAny?.exiledCardIdsFromHandForCost) && stepAny.exiledCardIdsFromHandForCost.length > 0
          ? stepAny.exiledCardIdsFromHandForCost.map((id: any) => String(id))
          : undefined,
        sacrificedPermanents: Array.isArray(stepAny?.sacrificedPermanentsForCost) && stepAny.sacrificedPermanentsForCost.length > 0
          ? stepAny.sacrificedPermanentsForCost.map((id: any) => String(id))
          : undefined,
        lastSacrificedPermanents: Array.isArray(stepAny?.lastSacrificedPermanents) && stepAny.lastSacrificedPermanents.length > 0
          ? stepAny.lastSacrificedPermanents.map((entry: any) => ({ ...entry }))
          : undefined,
        lifePaidForCost: Number(stepAny?.lifePaidForCost || 0) > 0 ? Number(stepAny.lifePaidForCost) : undefined,
        exertedPermanentIdForCost,
      });
    } catch {
      // ignore persistence failures
    }
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s ability: ${abilityText}`,
    ts: Date.now(),
  });

  if (tappedPermanentsForCost.length > 0) {
    queueTapTriggersForTappedPermanents(io, game, gameId, tappedPermanentsForCost, controllerId as any);
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
