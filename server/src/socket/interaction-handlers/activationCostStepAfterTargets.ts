/**
 * socket/interaction-handlers/activationCostStepAfterTargets.ts
 *
 * CR 602.2b: choose an activated ability's targets before paying its costs. Used by cost prompts
 * that are themselves resolution steps (e.g. "Tap N untapped <type> you control"): the target
 * prompt is queued first and carries the cost step; answering it queues the cost step with the
 * chosen targets, and once the cost is paid the ability goes on the stack with those targets.
 * Public entry symbols: queueCostStepAfterAbilityTargets, handlePreCostAbilityTargetSelection,
 * completePreselectedAbilityTargets.
 */

import type { Server } from "socket.io";
import { parseTargetRequirements } from "../../rules-engine/targeting";
import { ResolutionQueueManager, ResolutionStepType, type ResolutionStep, type ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { addTargetStepWithChooser, chooserControlsTargets, opponentChoosesAllTargets } from "../opponentChosenTargets.js";
import { buildActivatedAbilityValidTargets } from "../resolutionActivatedAbilityTargetingUtils.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import { broadcastGame } from "../util.js";

/** Queue `costStep`, preceded by the ability's target prompt when the ability targets. */
export function queueCostStepAfterAbilityTargets(
  args: { gameId: string; game: any; pid: string; permanent: any; cardName: string; abilityText: string },
  costStep: any,
): any {
  const { gameId, game, pid, permanent, cardName, abilityText } = args;
  const targetReqs: any = parseTargetRequirements(abilityText, {
    gameState: game.state,
    controllerId: pid,
    sourceName: cardName,
    sourcePermanent: permanent,
  } as any);
  const targetTypes: string[] = Array.isArray(targetReqs?.targetTypes) ? targetReqs.targetTypes.map(String) : [];
  const graveyardOnly = targetTypes.length > 0 && targetTypes.every((t) => t.toLowerCase().startsWith('graveyard_'));
  if (!targetReqs?.needsTargets || graveyardOnly) return ResolutionQueueManager.addStep(gameId, costStep);

  const validTargets = buildActivatedAbilityValidTargets(game, pid, targetReqs, {
    sourcePermanentId: String(permanent?.id || costStep.permanentId || ''),
    abilityText,
  } as any);
  const minTargets = Number(targetReqs.minTargets ?? 1);
  const maxTargets = Number(targetReqs.maxTargets ?? minTargets);
  if (validTargets.length < minTargets) return ResolutionQueueManager.addStep(gameId, costStep);

  debug(2, `[activationCostStepAfterTargets] ${cardName}: targets first, then the cost prompt (CR 602.2b)`);
  return addTargetStepWithChooser(gameId, game, pid, {
    chosenByOpponent: opponentChoosesAllTargets(abilityText),
    restrictToChooserControlled: chooserControlsTargets(abilityText),
  }, undefined, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: costStep.sourceId,
    sourceName: cardName,
    sourceImage: costStep.sourceImage,
    description: `Choose ${targetReqs.targetDescription || 'target'} for ${cardName}`,
    mandatory: minTargets > 0,
    validTargets,
    targetTypes,
    minTargets,
    maxTargets,
    targetDescription: targetReqs.targetDescription || 'target',
    permanentId: costStep.permanentId,
    preCostAbilityTargetSelection: true,
    deferredCostStep: costStep,
  });
}

/** Targets chosen: now queue the cost prompt, carrying the targets. */
export function handlePreCostAbilityTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepAny = step as any;
  const selections = (Array.isArray(response.selections) ? response.selections : []).map((id: any) => String(id));
  const costStep = stepAny.deferredCostStep;
  if (costStep) {
    ResolutionQueueManager.addStep(gameId, { ...costStep, preselectedAbilityTargets: selections });
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}

/**
 * After the cost step paid its cost and queued the ability's target prompt: answer that prompt with
 * the targets chosen up front. Returns true when the ability was put on the stack this way.
 */
export async function completePreselectedAbilityTargets(
  io: Server,
  game: any,
  gameId: string,
  costStepAny: any,
  queuedTargetStep: any,
): Promise<boolean> {
  const preselected: string[] | undefined = Array.isArray(costStepAny?.preselectedAbilityTargets)
    ? costStepAny.preselectedAbilityTargets.map((id: any) => String(id))
    : undefined;
  if (!preselected || !queuedTargetStep || queuedTargetStep.type !== ResolutionStepType.TARGET_SELECTION) return false;
  const legal = new Set((queuedTargetStep.validTargets || []).map((t: any) => String(t?.id || '')));
  if (!preselected.every((id) => legal.has(id))) return false;

  const response: ResolutionStepResponse = {
    stepId: String(queuedTargetStep.id),
    playerId: queuedTargetStep.playerId,
    selections: preselected,
    cancelled: false,
    timestamp: Date.now(),
  } as any;
  const completed = ResolutionQueueManager.completeStep(gameId, String(queuedTargetStep.id), response);
  if (!completed) return false;
  await getResolutionHandlerDeps().handleBattlefieldAbilityTargetSelection(io, game, gameId, completed, response);
  return true;
}
