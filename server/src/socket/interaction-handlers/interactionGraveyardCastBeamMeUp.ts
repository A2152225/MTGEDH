// server/src/socket/interaction-handlers/interactionGraveyardCastBeamMeUp.ts
// B42: queues the "return a creature you control to its owner's hand" additional cost of a beam me up cast.
// Reuses the graveyard-cast sacrifice picker (TARGET_SELECTION + graveyardCastSacrificeAsCost) with
// returnToHandForCost: true; targetSelectionGraveyardBeamMeUpHandler.ts bounces the pick and resumes the cast.
// B43: commitBeamMeUpReturnCost pays the chosen return at cast commit (finalizeGraveyardSpellCast), not at pick time.
// Public entry symbols: queueBeamMeUpReturnStep, commitBeamMeUpReturnCost.

import type { PlayerID } from "../../../../shared/src/index.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { getCastFromGraveyardResourceValidationError, getEligibleCreaturesForBeamMeUp } from "./interactionGraveyardCastCostAndTimingRules.js";
import { movePermanentToHand } from "../../state/modules/zones-handlers/zonesMovePermanentToHand.js";
import { persistQueuedGraveyardAbilityStepActivation } from "./interactionActivationEventPersistence.js";

export function queueBeamMeUpReturnStep(params: {
  gameId: string; game: any; playerId: string; cardId: string; abilityId: string; card: any;
  paymentManaCost?: string; recordedLifeCost: number; targets: string[];
  discardedCardIds?: string[]; exiledCardIdsFromHandForCost?: string[]; exiledCardIdsFromGraveyardForCost?: string[];
  sacrificedPermanentIdsForCost?: string[]; xValue?: number;
  emitError: (payload: { code: string; message: string }) => void;
}): 'queued' | 'error' {
  const cardName = String(params.card?.name || 'Spell');
  const resourceError = getCastFromGraveyardResourceValidationError(params.game, params.playerId, params.paymentManaCost || undefined, params.recordedLifeCost > 0 ? params.recordedLifeCost : undefined);
  if (resourceError) { params.emitError(resourceError); return 'error'; }
  const eligible = getEligibleCreaturesForBeamMeUp(params.game.state, params.playerId);
  if (eligible.length < 1) {
    params.emitError({ code: 'CANNOT_PAY_COST', message: `Cannot cast ${cardName} using beam me up: you need a creature you control that can be beamed up.` });
    return 'error';
  }
  const existing = ResolutionQueueManager.getStepsForPlayer(params.gameId, params.playerId as any)
    .find((step: any) => step?.type === ResolutionStepType.TARGET_SELECTION && step?.returnToHandForCost === true && String(step?.cardId || '') === String(params.cardId));
  if (existing) return 'queued';
  const arr = (v?: string[]) => (Array.isArray(v) && v.length > 0 ? v.slice() : undefined);
  const step = ResolutionQueueManager.addStep(params.gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: params.playerId as PlayerID,
    sourceId: params.cardId,
    sourceName: cardName,
    sourceImage: params.card?.image_uris?.small || params.card?.image_uris?.normal,
    description: `${cardName}: Return a creature you control to its owner's hand to cast it using beam me up.`,
    mandatory: false,
    validTargets: eligible.map((perm: any) => ({
      id: perm.id,
      label: perm.card?.name || 'Creature',
      description: perm.card?.type_line || 'Creature',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
    })),
    targetTypes: ['return_to_hand_cost'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'creature you control',
    graveyardCastSacrificeAsCost: true,
    returnToHandForCost: true,
    cardId: params.cardId,
    abilityId: params.abilityId,
    cardName,
    manaCost: params.paymentManaCost || undefined,
    lifeToPayForCost: params.recordedLifeCost > 0 ? params.recordedLifeCost : undefined,
    targetsForCast: params.targets.length > 0 ? params.targets : undefined,
    discardedCardIdsForCost: arr(params.discardedCardIds),
    exiledCardIdsFromHandForCost: arr(params.exiledCardIdsFromHandForCost),
    exiledCardIdsFromGraveyardForCost: arr(params.exiledCardIdsFromGraveyardForCost),
    sacrificedPermanentIdsForCost: arr(params.sacrificedPermanentIdsForCost),
    xValue: Number.isFinite(Number(params.xValue)) ? Math.max(0, Math.floor(Number(params.xValue))) : undefined,
  } as any);
  persistQueuedGraveyardAbilityStepActivation({
    gameId: params.gameId, game: params.game, playerId: String(params.playerId), cardId: String(params.cardId),
    abilityId: String(params.abilityId), queuedStep: { ...(step as any) },
  });
  return 'queued';
}

export function commitBeamMeUpReturnCost(game: any, gameId: string, playerId: string, ids: string[] | undefined,
  emitError: (payload: { code: string; message: string }) => void): boolean {
  const list = Array.isArray(ids) ? ids.map((id) => String(id)).filter(Boolean) : [];
  if (list.length === 0) return true;
  const eligible = new Set(getEligibleCreaturesForBeamMeUp(game.state, playerId).map((p: any) => String(p.id)));
  const bad = list.find((id) => !eligible.has(id));
  if (bad) { emitError({ code: 'INVALID_SELECTION', message: 'That creature can no longer be beamed up.' }); return false; }
  const ctx: any = {
    state: game.state, libraries: game.libraries, rng: game.rng, gameId,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
  };
  for (const id of list) {
    if (!movePermanentToHand(ctx, id)) { emitError({ code: 'COST_FAILED', message: 'Failed to return that creature to hand' }); return false; }
  }
  return true;
}
