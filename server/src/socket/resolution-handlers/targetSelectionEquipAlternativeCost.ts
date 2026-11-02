// server/src/socket/resolution-handlers/targetSelectionEquipAlternativeCost.ts
// B39: "Equip\u2014Pay {3} or discard a card." (Bloodthorn Flail) and any other "X or Y" equip cost.
// After the equip target is chosen, an OPTION_CHOICE asks which cost to pay; the response handler
// (optionChoiceEquipAlternativeCost.ts) re-enters handleBattlefieldAbilityTargetSelection with the chosen
// single cost, which then runs the existing sacrifice/discard/life/mana stages.
// B40: only payable options are offered. One payable option skips the prompt (chosenCost is returned and
// written to the step); none payable rejects the activation with CANNOT_PAY_COST.
// Origin parent: targetSelectionBattlefieldAbilityHandlers.ts (handleBattlefieldAbilityTargetSelection).
// Public entry symbols: handleEquipAlternativeCostStage.

import type { Server } from "socket.io";
import { ResolutionQueueManager, ResolutionStepType, type ResolutionStep } from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseAlternativeCostOptions, payableAlternativeCostOptions } from "../../state/modules/alternativeCostOptions.js";
import { broadcastGame, emitToPlayer, canPayManaCostStringWithAvailableSources } from "../util.js";

/** B41: the step field holding the cost for this attach-style ability (equip, fortify, reconfigure). */
export function altCostField(s: any): 'equipCost' | 'fortifyCost' | 'reconfigureCost' {
  const t = String(s?.abilityType || s?.battlefieldAbilityType || '');
  return t === 'reconfigure_attach' ? 'reconfigureCost' : t === 'fortify' ? 'fortifyCost' : 'equipCost';
}
function altCostLabel(s: any): string {
  const f = altCostField(s);
  return f === 'reconfigureCost' ? 'Reconfigure' : f === 'fortifyCost' ? 'Fortify' : 'Equip';
}

export function handleEquipAlternativeCostStage(
  io: Server, game: any, gameId: string, step: ResolutionStep, controllerId: string, permanentId: string,
  cost: string, selectedIds: string[], validTargets: any[],
): { done: boolean; chosenCost?: string } {
  const stepAny = step as any;
  if (stepAny.equipChosenCost) return { done: false };
  const allOptions = parseAlternativeCostOptions(cost);
  if (!allOptions) return { done: false };
  const cardName = String(stepAny.cardName || step.sourceName || 'Equipment');
  const options = payableAlternativeCostOptions(game?.state, controllerId, allOptions, [permanentId, ...selectedIds], (s, p, c) => canPayManaCostStringWithAvailableSources(s, p as any, c));
  if (options.length === 0) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: `You can't pay ${cardName}'s ${altCostLabel(stepAny)} cost (${cost}).` });
    return { done: true };
  }
  if (options.length === 1) {
    stepAny[altCostField(stepAny)] = options[0];
    stepAny.equipChosenCost = options[0];
    return { done: false, chosenCost: options[0] };
  }
  const continuation: any = { ...stepAny };
  delete continuation.id;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId as PlayerID,
    sourceId: permanentId,
    sourceName: cardName,
    sourceImage: step.sourceImage,
    description: `Choose how to pay ${cardName}'s ${altCostLabel(stepAny)} cost.`,
    mandatory: false,
    options: options.map((label, i) => ({ id: `alt_${i}`, label })),
    minSelections: 1,
    maxSelections: 1,
    equipAlternativeCostChoice: true,
    equipAlternativeCostOptions: options,
    equipAltContinuation: { ...continuation, validTargets },
    equipTargetIds: [...selectedIds],
  } as any);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return { done: true };
}
