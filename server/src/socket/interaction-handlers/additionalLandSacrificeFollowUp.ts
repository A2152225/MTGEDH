// server/src/socket/interaction-handlers/additionalLandSacrificeFollowUp.ts
// Brutal Suppression leftover: after the printed non-land sacrifice cost is
// paid, queue a second sacrifice-a-land prompt for the additional land cost.
// Public: maybeQueueAdditionalLandSacrificeFollowUp, landSacrificeCandidatesForPlayer.

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { broadcastGame, emitToPlayer } from "../util.js";

export function landSacrificeCandidatesForPlayer(
  state: any,
  playerId: string,
  excludeIds: readonly string[] = [],
): any[] {
  const exclude = new Set(excludeIds.map(String));
  return (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((permanent: any) =>
    permanent
    && String(permanent.controller || '') === String(playerId)
    && !exclude.has(String(permanent.id || ''))
    && /\bland\b/i.test(String(permanent.card?.type_line || permanent.type_line || ''))
  );
}

/** Returns true when a follow-up land sacrifice prompt was queued (or the cost could not be paid). */
export function maybeQueueAdditionalLandSacrificeFollowUp(args: {
  io: Server;
  game: any;
  gameId: string;
  step: any;
  controllerId: string;
  permanentId: string;
  sacrificedIds: string[];
  sacrificedPermanentSnapshots?: any[];
  allTappedPermanentsForCost?: string[];
  prePaidLifeForCost?: number;
}): boolean {
  const step = args.step || {};
  if (step.additionalLandSacrifice !== true) return false;
  if (step.additionalLandSacrificeStage === true) return false;
  if (String(step.sacrificeType || '') === 'land') return false;

  const candidates = landSacrificeCandidatesForPlayer(
    args.game?.state,
    args.controllerId,
    [args.permanentId, ...(args.sacrificedIds || [])],
  );
  if (candidates.length < 1) {
    emitToPlayer(args.io, args.controllerId as any, 'error', {
      code: 'INSUFFICIENT_SACRIFICE_TARGETS',
      message: "You don't control a land to sacrifice for the additional cost.",
    });
    return true;
  }

  const cardName = String(step.cardName || step.sourceName || 'Ability');
  ResolutionQueueManager.addStep(args.gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: args.controllerId as PlayerID,
    sourceId: args.permanentId,
    sourceName: cardName,
    sourceImage: step.sourceImage,
    description: `Sacrifice a land (additional cost from Brutal Suppression).`,
    mandatory: false,
    validTargets: candidates.map((permanent: any) => ({
      id: permanent.id,
      label: String(permanent.card?.name || 'Land'),
      description: String(permanent.card?.type_line || 'Land'),
      imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
    })),
    targetTypes: ['sacrifice_cost'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'lands you control',
    sacrificeAbilityAsCost: true,
    additionalLandSacrifice: false,
    additionalLandSacrificeStage: true,
    sacrificeType: 'land',
    sacrificeCount: 1,
    mustBeOther: true,
    permanentId: args.permanentId,
    abilityId: step.abilityId,
    cardName,
    abilityText: step.abilityText,
    activatedAbilityText: step.activatedAbilityText,
    manaCost: '',
    oracleText: step.oracleText,
    requiresTap: false,
    lifeToPayForCost: 0,
    prePaidLifeForCost: Number(args.prePaidLifeForCost || 0) || undefined,
    prePaidTappedPermanentsForCost: args.allTappedPermanentsForCost || [],
    prePaidSacrificedPermanentsForCost: args.sacrificedIds || [],
    lastSacrificedPermanents: args.sacrificedPermanentSnapshots,
    discardedCardIdsForCost: step.discardedCardIdsForCost,
    exiledCardIdsFromHandForCost: step.exiledCardIdsFromHandForCost,
    requiresSelfExertForCost: step.requiresSelfExertForCost,
    manaFromTreasureSpentKnown: step.manaFromTreasureSpentKnown,
    manaFromTreasureSpent: step.manaFromTreasureSpent,
  } as any);

  if (typeof args.game.bumpSeq === 'function') args.game.bumpSeq();
  broadcastGame(args.io, args.game, args.gameId);
  return true;
}
