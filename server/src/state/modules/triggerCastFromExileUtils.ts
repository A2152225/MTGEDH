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
  extras?: {
    declineDestination?: string;
    declineLabel?: string;
    castLabel?: string;
    description?: string;
    mandatory?: boolean;
  },
): void {
  const stateAny = (ctx as any)?.state as any;
  const exiledCardId = String(exiledCard?.id || '').trim();
  const cardName = String(exiledCard?.name || 'that card');
  const declineDestination = String(
    extras?.declineDestination
    || (exiledCard as any)?.castFromExileDeclineDestination
    || 'library_bottom_random',
  );
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
    description: extras?.description || `${sourceName}: You may cast ${cardName} from exile without paying its mana cost.`,
    mandatory: extras?.mandatory === true,
    sourceName,
    sourceId,
    sourceImage,
    options: [
      { id: 'cast', label: extras?.castLabel || `Cast ${cardName}` },
      { id: 'decline', label: extras?.declineLabel || 'Decline' },
    ],
    minSelections: 1,
    maxSelections: 1,
    castFromExileCardId: exiledCard?.id,
    castFromExileCard: exiledCard,
    castFromExileDeclineDestination: declineDestination,
  } as any);
}
