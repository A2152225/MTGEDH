/**
 * Origin parent: server/src/socket/game-actions-handlers/gameActionsRequestCastSpellModes.ts
 * Cluster: replicate count prompt before targets (CR 601.2b / 702.56).
 * Public entry symbols: queueReplicateCastCountPrompt.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../state/resolution/index.js';
import {
  getMaxAffordableReplicateTimes,
  parseReplicateManaCost,
} from '../../state/modules/replicateCastUtils.js';
import { debug } from '../../utils/debug.js';
import { persistQueuedSpellCastStepContinuation } from './gameActionsSpellCopyHeroicTriggers.js';

export function queueReplicateCastCountPrompt(params: {
  socket: { emit: (event: string, payload: any) => void };
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  cardInHand: any;
  cardForCast: any;
  oracleTextRaw: string;
  baseManaCost: string;
  selectedFaceIndex: number | undefined;
  castSourceZone: string;
  isFreeCast: boolean;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  forcedAlternateCostId?: string;
  chosenXValue: number | undefined;
  chosenTimesKicked: number | undefined;
}): boolean {
  const replicateCost = parseReplicateManaCost(String(
    params.cardInHand?.oracle_text || params.oracleTextRaw || '',
  ));
  if (!replicateCost) return false;

  const maxTimes = getMaxAffordableReplicateTimes(
    params.game,
    params.playerId as PlayerID,
    params.baseManaCost,
    replicateCost,
    {
      minValue: 0,
      maxValue: 20,
      excludedHandCardIds: [String(params.cardId)],
    },
  );
  if (maxTimes < 1) return false;

  const existing = ResolutionQueueManager
    .getStepsForPlayer(params.gameId, params.playerId as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.X_VALUE_SELECTION
      && step?.spellCastReplicateSelection === true
      && String(step?.spellCardId || '') === String(params.cardId),
    );
  if (existing) return true;

  const image = params.cardForCast?.image_uris?.small
    || params.cardForCast?.image_uris?.normal
    || params.cardInHand?.image_uris?.small
    || params.cardInHand?.image_uris?.normal;
  const replicateStep = ResolutionQueueManager.addStep(params.gameId, {
    type: ResolutionStepType.X_VALUE_SELECTION,
    playerId: params.playerId as any,
    description: `Choose how many times to pay Replicate ${replicateCost} for ${params.cardName}. Each payment copies the spell. You may choose new targets for the copies.`,
    mandatory: true,
    sourceId: String(params.cardId),
    sourceName: params.cardName,
    sourceImage: image,
    minValue: 0,
    maxValue: maxTimes,
    xCount: 1,
    costPerX: replicateCost,
    spellCastReplicateSelection: true,
    spellCardId: String(params.cardId),
    spellFaceIndex: params.selectedFaceIndex,
    spellFromZone: params.castSourceZone,
    spellForcedAlternateCostId: params.forcedAlternateCostId,
    spellCastWithoutPayingManaCost: params.isFreeCast,
    spellBypassExilePermissionCheck: params.bypassExilePermissionCheck,
    spellIgnoreTimingRestrictions: params.ignoreTimingRestrictions,
    spellXValue: params.chosenXValue,
    spellTimesKicked: params.chosenTimesKicked,
  } as any);

  persistQueuedSpellCastStepContinuation(params.gameId, params.game, {
    playerId: params.playerId,
    cardId: params.cardId,
    queuedResolutionStep: {
      ...(replicateStep as any),
    },
  });

  debug(2, `[requestCastSpell] Queued replicate count selection for ${params.cardName} (max ${maxTimes})`);
  return true;
}
