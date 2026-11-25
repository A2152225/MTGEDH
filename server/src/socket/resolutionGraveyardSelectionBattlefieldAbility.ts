/**
 * socket/resolutionGraveyardSelectionBattlefieldAbility.ts
 *
 * Origin parent: resolutionGraveyardSelectionApplyHandlers.ts (handleGraveyardSelectionResponse).
 * Cluster moved: the `battlefieldAbilityTargetSelection` GRAVEYARD_SELECTION branch - an activated
 * battlefield ability whose graveyard-card targets are picked with a total-power cap. Pays any
 * deferred self-source cost (CR 602.2b) once targets are chosen, then stacks the ability.
 * Public entry symbols: handleGraveyardSelectionBattlefieldAbility.
 */

import type { Server } from "socket.io";
import type { ResolutionStep } from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { parsePT } from "../state/utils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
  getSelectedGraveyardCardsForStep,
} from "./resolutionActivatedAbilityTargetingUtils.js";
import { finalizeBattlefieldAbilitySelfExertCost } from "./resolutionGraveyardSelectionHelperUtils.js";
import { payDeferredStepActivationCosts } from "./interaction-handlers/activationSelfSourceCost.js";

export async function handleGraveyardSelectionBattlefieldAbility(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  pid: any,
  selectedCardIds: string[],
  validTargets: any[],
  minTargets: number,
  maxTargets: number,
  totalPowerLimit: number,
): Promise<void> {
  const stepData = step as any;
  const controllerId = String(step.playerId || pid);
  const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
  const abilityId = String(stepData?.abilityId || '').trim();
  const cardName = String(stepData?.cardName || step.sourceName || 'Ability');
  const abilityText = String(stepData?.abilityText || step.description || '').trim();
  const activatedAbilityText = String(stepData?.activatedAbilityText || '').trim();
  const tappedPermanentsForCost = Array.isArray(stepData?.tappedPermanentsForCost)
    ? stepData.tappedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
    : [];

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sourcePerm = battlefield.find((perm: any) => perm && String(perm.id) === permanentId);
  if (!sourcePerm) {
    emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
    return;
  }
  if (String(sourcePerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
    return;
  }

  const selectedEntries = getSelectedGraveyardCardsForStep(game, stepData, selectedCardIds);
  if (selectedEntries.length !== selectedCardIds.length) {
    emitToPlayer(io, controllerId, 'error', { code: 'INVALID_TARGET', message: 'Selected card not found in graveyard' });
    return;
  }

  if (Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 && selectedCardIds.length > 0) {
    const selectedTotalPower = selectedEntries.reduce((sum: number, entry: any) => {
      const card = entry?.card;
      const typeLine = String(card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return sum;
      }
      return sum + parsePT(card?.power);
    }, 0);

    if (selectedTotalPower > totalPowerLimit) {
      emitToPlayer(io, controllerId, 'error', {
        code: 'INVALID_TOTAL_POWER',
        message: `Selected cards have total power ${selectedTotalPower} (need ${totalPowerLimit} or less).`,
      });
      return;
    }
  }

  // CR 602.2b: "Sacrifice/Exile this" and deferred life are paid now that targets are chosen.
  const deferredCostError = payDeferredStepActivationCosts(game, gameId, controllerId, permanentId, stepData, cardName);
  if (deferredCostError) {
    emitToPlayer(io, controllerId, 'error', deferredCostError);
    return;
  }

  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: controllerId,
    source: permanentId,
    sourceName: cardName,
    description: abilityText,
    activatedAbilityText: activatedAbilityText || undefined,
    targets: selectedCardIds,
    copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
    copyRetargetTargetTypes: Array.isArray(stepData.targetTypes) ? [...stepData.targetTypes] : [],
    copyRetargetMinTargets: minTargets,
    copyRetargetMaxTargets: maxTargets,
    copyRetargetTargetDescription: String(stepData.targetDescription || 'target'),
    ...(Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 ? { targetTotalPowerLimit: totalPowerLimit } : null),
    ...(Array.isArray(stepData?.sacrificedPermanentsForCost) ? { sacrificedPermanents: [...stepData.sacrificedPermanentsForCost] } : null),
    ...(Array.isArray(stepData?.lastSacrificedPermanents) ? { lastSacrificedPermanents: stepData.lastSacrificedPermanents.map((entry: any) => ({ ...entry })) } : null),
    ...(stepData?.sourceLastKnown ? { sourceLastKnown: { ...stepData.sourceLastKnown } } : null),
  } as any;

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  const exertedPermanentIdForCost = finalizeBattlefieldAbilitySelfExertCost(
    game,
    gameId,
    controllerId,
    permanentId,
    stepData?.requiresSelfExertForCost === true,
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
        targets: selectedCardIds,
        copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
        copyRetargetTargetTypes: Array.isArray(stepData.targetTypes) ? [...stepData.targetTypes] : [],
        copyRetargetMinTargets: minTargets,
        copyRetargetMaxTargets: maxTargets,
        copyRetargetTargetDescription: String(stepData.targetDescription || 'target'),
        targetTotalPowerLimit: Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 ? totalPowerLimit : undefined,
        tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
        discardedCardIds: Array.isArray(stepData?.discardedCardIdsForCost) && stepData.discardedCardIdsForCost.length > 0
          ? stepData.discardedCardIdsForCost.map((id: any) => String(id))
          : undefined,
        lifePaidForCost: Number(stepData?.lifePaidForCost || 0) > 0 ? Number(stepData.lifePaidForCost) : undefined,
        energyPaidForCost: Number(stepData?.energyPaidForCost || 0) > 0 ? Number(stepData.energyPaidForCost) : undefined,
        sacrificedPermanents: Array.isArray(stepData?.sacrificedPermanentsForCost) && stepData.sacrificedPermanentsForCost.length > 0 ? [...stepData.sacrificedPermanentsForCost] : undefined,
        lastSacrificedPermanents: Array.isArray(stepData?.lastSacrificedPermanents) && stepData.lastSacrificedPermanents.length > 0 ? stepData.lastSacrificedPermanents.map((entry: any) => ({ ...entry })) : undefined,
        exiledSelfForCost: stepData?.exiledSelfForCost ? String(stepData.exiledSelfForCost) : undefined,
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
    message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}'s ability: ${abilityText}`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return;
}
