// server/src/state/modules/transformAttachPlayerChoice.ts
// When a permanent transforms with "attach it to a player" and no player
// was chosen, queue a player TARGET_SELECTION. Public:
// maybeQueueTransformAttachPlayerChoice, applyTransformAttachPlayerChoiceOnContext,
// queuePendingTransformAttachPlayerChoices.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from './context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import { applyTransformAttachToPlayer } from './batch94TransformAttach.js';

export function maybeQueueTransformAttachPlayerChoice(ctx: GameContext, permanent: any): boolean {
  if (!ctx || !permanent) return false;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    (permanent as any).pendingTransformAttachPlayerChoice = true;
    return false;
  }
  const playerId = String(permanent.controller || permanent.controllerId || permanent.owner || '').trim();
  if (!playerId) return false;

  const already = ResolutionQueueManager.getQueue(gameId).steps.some((step: any) =>
    step?.transformAttachToPlayerChoice === true
    && String(step?.sourceId || step?.permanentId || '').trim() === String(permanent.id || '').trim(),
  );
  if (already) return false;

  const state: any = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const validTargets = players
    .map((player: any) => {
      const id = String(player?.id || '').trim();
      if (!id) return null;
      return { id, label: String(player?.name || id), description: 'Player', type: 'player' };
    })
    .filter(Boolean) as Array<{ id: string; label: string; description: string; type: string }>;
  if (!validTargets.length) return false;

  const sourceName = String(permanent?.card?.name || 'Permanent');
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as PlayerID,
    description: `As ${sourceName} transforms, attach it to a player.`,
    mandatory: true,
    sourceId: String(permanent.id || ''),
    sourceName,
    sourceImage: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
    validTargets,
    targetTypes: ['player'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'a player',
    transformAttachToPlayerChoice: true,
    permanentId: String(permanent.id || ''),
  } as any);
  delete (permanent as any).pendingTransformAttachPlayerChoice;
  return true;
}

export function queuePendingTransformAttachPlayerChoices(ctx: GameContext): number {
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  let queued = 0;
  for (const permanent of battlefield) {
    if (permanent?.pendingTransformAttachPlayerChoice === true) {
      if (maybeQueueTransformAttachPlayerChoice(ctx, permanent)) queued += 1;
    }
  }
  return queued;
}

export function applyTransformAttachPlayerChoiceOnContext(
  ctx: GameContext,
  event: { permanentId?: string; playerId?: string },
): { applied: boolean } {
  const permanentId = String(event?.permanentId || '').trim();
  const playerId = String(event?.playerId || '').trim();
  if (!permanentId || !playerId || !ctx) return { applied: false };
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  const permanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === permanentId);
  if (!permanent) return { applied: false };
  const result = applyTransformAttachToPlayer(permanent, playerId);
  delete (permanent as any).pendingTransformAttachPlayerChoice;
  return { applied: result.applied };
}
