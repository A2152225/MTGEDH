import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { getExploreActionCount } from './keywordActionRepetition.js';

export function queueExploreDecisionStep(
  ctx: GameContext,
  controller: PlayerID,
  permanentId: string,
  remainingPermanentIds: string[] = [],
  options?: { skipExploreReplacement?: boolean },
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
  const actionCount = getExploreActionCount(battlefield, String(controller), {
    skipReplacement: options?.skipExploreReplacement === true,
  });

  for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
    // Second+ explores re-read the current top after prior explore resolution.
    const topCard = actionIndex === 0 ? revealedCard : (ctx.libraries.get(controller) || [])[0];
    if (!topCard) break;
    const topTypeLine = String(topCard.type_line || '').toLowerCase();

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: controller as any,
      mandatory: true,
      sourceId: permanentId,
      sourceName: exploringName,
      description: actionCount > 1
        ? `${exploringName} explores (${actionIndex + 1}/${actionCount})`
        : `${exploringName} explores`,
      permanentId,
      permanentName: exploringName,
      revealedCard: topCard,
      isLand: topTypeLine.includes('land'),
      remainingPermanentIds,
      skipExploreReplacement: true,
    } as any);
  }

  return true;
}
