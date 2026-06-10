import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

export function queueExploreDecisionStep(
  ctx: GameContext,
  controller: PlayerID,
  permanentId: string,
  remainingPermanentIds: string[] = [],
): boolean {
  const gameId = String((ctx as any)?.gameId || '').trim();
  if (!gameId || !permanentId) return false;

  const library = ctx.libraries.get(controller) || [];
  if (library.length === 0) return false;

  const revealedCard = library[0];
  if (!revealedCard) return false;

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const exploringPerm = battlefield.find(
    (p: any) => p?.id === permanentId && String(p?.controller || '') === String(controller),
  );
  if (!exploringPerm) return false;

  const typeLine = String(revealedCard.type_line || '').toLowerCase();
  const exploringName = exploringPerm?.card?.name || 'Creature';

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.EXPLORE_DECISION,
    playerId: controller as any,
    mandatory: true,
    sourceId: permanentId,
    sourceName: exploringName,
    description: `${exploringName} explores`,
    permanentId,
    permanentName: exploringName,
    revealedCard,
    isLand: typeLine.includes('land'),
    remainingPermanentIds,
  } as any);

  return true;
}
