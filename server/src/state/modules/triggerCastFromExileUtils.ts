import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from './durable-permissions.js';

export function queueCastFromExileResolutionPrompt(
  ctx: GameContext,
  gameId: string,
  playerId: PlayerID,
  sourceName: string,
  sourceId: string | undefined,
  sourceImage: string | undefined,
  exiledCard: any,
): void {
  const stateAny = (ctx as any)?.state as any;
  const exiledCardId = String(exiledCard?.id || '').trim();
  if (stateAny && exiledCardId) {
    upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
      playerId,
      cardIds: [exiledCardId],
      action: 'cast',
      duration: 'one_shot',
      turnApplied: Number(stateAny.turnNumber ?? 0),
      expiresAtTurn: Number(stateAny.turnNumber ?? 0),
      sourceId,
      sourceName,
      costMode: 'without_paying_mana_cost',
      usageLimit: { type: 'one_shot', maxUses: 1 },
    }));
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as any,
    description: `${sourceName}: You may cast ${exiledCard?.name || 'that card'} from exile without paying its mana cost.`,
    mandatory: false,
    sourceName,
    sourceId,
    sourceImage,
    options: [
      { id: 'cast', label: `Cast ${exiledCard?.name || 'that card'}` },
      { id: 'decline', label: 'Decline' },
    ],
    minSelections: 1,
    maxSelections: 1,
    castFromExileCardId: exiledCard?.id,
    castFromExileCard: exiledCard,
    castFromExileDeclineDestination: String((exiledCard as any)?.castFromExileDeclineDestination || 'library_bottom_random'),
  } as any);
}
