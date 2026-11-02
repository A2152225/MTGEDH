// server/src/socket/resolution-handlers/targetSelectionEquipDiscardCost.ts
// B37: "Equip\u2014Discard a card." Same two-stage pattern as targetSelectionEquipSacrificeCost.ts (UI34):
// after the equip target is chosen, a second TARGET_SELECTION lists the hand; the chosen card is discarded
// (graveyard replacements + discard triggers) and the equip continues with the original target.
// Origin parent: targetSelectionBattlefieldAbilityHandlers.ts (handleBattlefieldAbilityTargetSelection).
// Public entry symbols: handleEquipDiscardCostStage.

import type { Server } from "socket.io";
import { ResolutionQueueManager, ResolutionStepType, type ResolutionStep } from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { equipDiscardCandidates, parseEquipDiscardCost } from "../../state/modules/equipNonManaCosts.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { queueDiscardTriggeredAbilities } from "../../state/modules/triggers/discard.js";
import { broadcastGame, emitToPlayer } from "../util.js";
import { appendEvent } from "../../db/index.js";

export interface EquipDiscardStageResult { done: boolean; targetIds: string[]; validTargets: any[] }

export function handleEquipDiscardCostStage(
  io: Server, game: any, gameId: string, step: ResolutionStep, controllerId: string, permanentId: string,
  cost: string, selectedIds: string[], validTargets: any[],
): EquipDiscardStageResult {
  const stepAny = step as any;
  const pass = { done: false, targetIds: selectedIds, validTargets };
  if (!parseEquipDiscardCost(cost)) return pass;
  if (!stepAny.equipDiscardStage) {
    const candidates = equipDiscardCandidates(game.state, controllerId, cost);
    if (candidates.length === 0) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: `You have no card to discard (${cost}).` });
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
        label: String(c.name || c.card?.name || 'Card'),
        description: String(c.type_line || c.card?.type_line || 'Card in hand'),
        // UI35: explicit card type + typeLine so the client tile groups it as a hand card and shows its type line.
        type: 'card',
        zone: 'hand',
        typeLine: c.type_line || c.card?.type_line || undefined,
        controller: controllerId,
        imageUrl: c.image_uris?.small || c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.small || c.card_faces?.[0]?.image_uris?.normal || c.card?.image_uris?.small || c.card?.image_uris?.normal,
      })),
      targetTypes: ['card'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'card to discard',
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
      equipDiscardStage: true,
      equipTargetIds: [...selectedIds],
      equipTargetValidTargets: validTargets,
    } as any);
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return { ...pass, done: true };
  }
  const cardId = String(selectedIds[0] || '');
  const targetIds = Array.isArray(stepAny.equipTargetIds) ? stepAny.equipTargetIds.map(String) : [];
  const zones = game.state?.zones?.[controllerId];
  const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
  const idx = hand.findIndex((c: any) => String(c?.id) === cardId);
  if (idx < 0) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: `That card can't be discarded (${cost}).` });
    return { ...pass, done: true };
  }
  const [card] = hand.splice(idx, 1);
  zones.graveyard = zones.graveyard || [];
  const ctx = {
    state: game.state,
    libraries: game.libraries,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
    rng: game.rng,
    gameId,
  } as any;
  pushCardToPlayerGraveyardWithReplacements(ctx, controllerId, card, zones.graveyard);
  zones.handCount = hand.length;
  zones.graveyardCount = zones.graveyard.length;
  queueDiscardTriggeredAbilities(ctx, controllerId, [{ ...card }], {});
  stepAny.discardedCardsForCost = [...(Array.isArray(stepAny.discardedCardsForCost) ? stepAny.discardedCardsForCost : []), cardId];
  try { appendEvent(gameId, (game as any).seq ?? 0, 'equipDiscardCostPaid', { playerId: controllerId, permanentId, cardId }); } catch { /* replay log best-effort */ }
  return { done: false, targetIds, validTargets: Array.isArray(stepAny.equipTargetValidTargets) ? stepAny.equipTargetValidTargets : validTargets };
}
