// server/src/socket/resolution-handlers/targetSelectionEquipSacrificeCost.ts
// UI34: "Equip\u2014Sacrifice a creature." After the equip target is chosen, a second TARGET_SELECTION
// (same battlefieldAbilityTargetSelection continuation) asks which permanent to sacrifice; the answer
// sacrifices it and the equip continues with the original target.
// Origin parent: targetSelectionBattlefieldAbilityHandlers.ts (handleBattlefieldAbilityTargetSelection).
// Public entry symbols: handleEquipSacrificeCostStage.

import type { Server } from "socket.io";
import { ResolutionQueueManager, ResolutionStepType, type ResolutionStep } from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { equipSacrificeCandidates, parseEquipSacrificeCost } from "../../state/modules/equipNonManaCosts.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import { broadcastGame, emitToPlayer } from "../util.js";

export interface EquipSacrificeStageResult { done: boolean; targetIds: string[]; validTargets: any[] }

export function handleEquipSacrificeCostStage(
  io: Server, game: any, gameId: string, step: ResolutionStep, controllerId: string, permanentId: string,
  cost: string, selectedIds: string[], validTargets: any[],
): EquipSacrificeStageResult {
  const stepAny = step as any;
  const pass = { done: false, targetIds: selectedIds, validTargets };
  if (!parseEquipSacrificeCost(cost)) return pass;
  if (!stepAny.equipSacrificeStage) {
    const candidates = equipSacrificeCandidates(game.state, controllerId, cost, [permanentId, ...selectedIds]);
    if (candidates.length === 0) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: `You have nothing else to sacrifice (${cost}).` });
      return { ...pass, done: true };
    }
    const cardName = String(stepAny.cardName || step.sourceName || 'Equipment');
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: step.sourceImage,
      description: `${cost} to pay ${cardName}'s Equip cost.`,
      mandatory: false,
      validTargets: candidates.map((c: any) => ({
        id: c.id,
        label: String(c.card?.name || 'Permanent'),
        description: String(c.card?.type_line || 'Permanent'),
        imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
      })),
      targetTypes: [String(parseEquipSacrificeCost(cost))],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: `${parseEquipSacrificeCost(cost)} to sacrifice`,
      battlefieldAbilityTargetSelection: true,
      equipmentId: permanentId,
      permanentId,
      equipmentName: cardName,
      cardName,
      abilityId: stepAny.abilityId,
      abilityText: stepAny.abilityText,
      activatedAbilityText: stepAny.activatedAbilityText,
      abilityType: 'equip',
      equipCost: cost,
      equipType: stepAny.equipType,
      equipQualifierKind: stepAny.equipQualifierKind,
      targetsOpponentCreatures: false,
      tappedPermanentsForCost: stepAny.tappedPermanentsForCost,
      equipSacrificeStage: true,
      equipTargetIds: [...selectedIds],
      equipTargetValidTargets: validTargets,
    } as any);
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return { ...pass, done: true };
  }
  const sacId = String(selectedIds[0] || '');
  const targetIds = Array.isArray(stepAny.equipTargetIds) ? stepAny.equipTargetIds.map(String) : [];
  const stillLegal = equipSacrificeCandidates(game.state, controllerId, cost, [permanentId, ...targetIds]).some((p: any) => String(p.id) === sacId);
  const sacrificedName = stillLegal ? sacrificePermanent(game as any, sacId, controllerId) : null;
  if (!sacrificedName) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: `That permanent can't be sacrificed (${cost}).` });
    return { ...pass, done: true };
  }
  stepAny.sacrificedPermanentsForCost = [...(Array.isArray(stepAny.sacrificedPermanentsForCost) ? stepAny.sacrificedPermanentsForCost : []), sacId];
  return { done: false, targetIds, validTargets: Array.isArray(stepAny.equipTargetValidTargets) ? stepAny.equipTargetValidTargets : validTargets };
}
